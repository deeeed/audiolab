/**
 * Handler for Text-to-Speech functionality
 */
package net.siteed.sherpaonnx.handlers

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import com.facebook.react.bridge.*
import com.k2fsa.sherpa.onnx.*
import net.siteed.sherpaonnx.SherpaOnnxImpl
import net.siteed.sherpaonnx.utils.AssetUtils
import net.siteed.sherpaonnx.utils.AudioUtils
import java.io.File
import java.util.concurrent.Executors

class TtsHandler(private val reactContext: ReactApplicationContext) {
    
    private val executor = Executors.newSingleThreadExecutor()
    private var tts: OfflineTts? = null
    // Read on the generation thread, written by stop()/release(). Volatile so the
    // write is visible if either ever runs off the shared single-thread executor.
    @Volatile private var isGenerating = false

    /**
     * Monotonic id of the newest generation request (#440).
     *
     * A boolean alone loses a cancellation that arrives while generation is queued but not
     * yet running: stop() clears an already-false flag, then the queued task sets it true
     * and runs to completion, and stop() reports success having interrupted nothing.
     *
     * generate() claims an id before queueing. stop()/release() raise [cancelledThrough] to
     * the newest claimed id, so every request outstanding at that moment is cancelled
     * whether it had started or not. A request runs only while its own id is above the bar,
     * so a generation started after the cancel is unaffected.
     */
    private val requestCounter = java.util.concurrent.atomic.AtomicLong(0)

    /** Highest request id that has been cancelled. See [requestCounter]. */
    private val cancelledThrough = java.util.concurrent.atomic.AtomicLong(0)

    /**
     * Guards the cancel-versus-complete transition.
     *
     * A recheck before writing the file narrows that race but cannot close it: the WAV
     * write is synchronous and a stop can land partway through, leaving the request
     * cancelled and resolved at once. Holding this across both decisions makes exactly one
     * of them win (#440).
     *
     * A plain lock rather than a set of completed ids: nothing ever read those entries, so
     * the set only grew, one boxed Long per successful synthesis.
     */
    private val completionLock = Any()

    /** The request that owns [audioTrack], or 0 when nothing does. */
    @Volatile
    private var audioTrackOwner: Long = 0

    /**
     * Claim completion for [requestId], or report that a cancel got there first.
     *
     * Returns false if the request was already cancelled, in which case the caller must
     * not resolve.
     */
    private fun tryCompleteRequest(requestId: Long): Boolean =
        synchronized(completionLock) { isActive(requestId) }

    /** Whether [requestId] may keep generating, or has been cancelled out from under it. */
    private fun isActive(requestId: Long): Boolean =
        requestId > cancelledThrough.get()

    /** Cancel every request claimed so far. Safe to call from any thread. */
    private fun cancelOutstandingRequests() {
        val newest = requestCounter.get()
        // Under the same lock as tryCompleteRequest, so cancel and complete cannot
        // interleave: whichever takes it first decides that request's fate.
        synchronized(completionLock) {
            // Raise the bar rather than assigning: a concurrent cancel must not lower it.
            while (true) {
                val current = cancelledThrough.get()
                if (current >= newest || cancelledThrough.compareAndSet(current, newest)) break
            }
        }
        // isGenerating is deliberately NOT cleared here. It is a coarse "something is
        // running" flag shared by every request, and clearing it aborted the callback of a
        // request that claimed its id after the snapshot above — one this cancel does not
        // cover. cancelledThrough already names exactly which requests are cancelled; the
        // generation that owns the flag clears it in its own finally (#440).
    }
    private var audioTrack: AudioTrack? = null
    private var ttsModelConfig: OfflineTtsModelConfig? = null
    private var currentSampleRate: Int = 22050 // Default to 22050 Hz (common for speech)
    
    companion object {
        private const val TAG = "SherpaOnnxTTS"

        private fun prefillFrames(sampleRate: Int) = PrefillPolicy.prefillFrames(sampleRate)

        /** True when startThresholdInFrames can be lowered on this device (API 31+). */
        private fun canLowerThreshold() =
            android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S
    }
    
    /**
     * Initialize the TTS engine with the provided model configuration
     */
    fun init(modelConfig: ReadableMap, promise: Promise) {
        if (!SherpaOnnxImpl.isLibraryLoaded) {
            promise.reject("ERR_LIBRARY_NOT_LOADED", "Sherpa ONNX library is not loaded")
            return
        }

        // Execute initialization in a background thread
        executor.execute {
            try {
                // Initialize the Sherpa ONNX TTS model
                Log.i(TAG, "===== TTS INITIALIZATION START =====")
                Log.i(TAG, "Initializing TTS with config: ${modelConfig.toHashMap()}")
                
                // Extract model config options
                val modelDir = AssetUtils.cleanFilePath(modelConfig.getString("modelDir").orEmpty())
                val modelFileName = modelConfig.getString("modelFile") ?: "model.onnx"
                val tokensFileName = modelConfig.getString("tokensFile") ?: "tokens.txt"
                val voicesFile = modelConfig.getString("voicesFile")
                val lexiconFile = modelConfig.getString("lexiconFile")
                val vocoderFile = modelConfig.getString("vocoderFile")
                val dataDirInput = modelConfig.getString("dataDir")
                val lang = modelConfig.getString("lang")
                val modelType = modelConfig.getString("ttsModelType") ?: "vits"
                val sampleRate = if (modelConfig.hasKey("sampleRate")) modelConfig.getInt("sampleRate") else 16000
                val numThreads = if (modelConfig.hasKey("numThreads")) modelConfig.getInt("numThreads") else 1
                val debug = if (modelConfig.hasKey("debug")) modelConfig.getBoolean("debug") else false
                
                // Log configuration for debugging
                Log.i(TAG, "Model dir: $modelDir")
                Log.i(TAG, "Model file: $modelFileName")
                Log.i(TAG, "Tokens file: $tokensFileName")
                Log.i(TAG, "Voices file (from 'voices' param): $voicesFile")
                Log.i(TAG, "Lexicon file: $lexiconFile")
                Log.i(TAG, "Data dir (input): $dataDirInput")
                Log.i(TAG, "Model type: $modelType")
                Log.i(TAG, "Sample rate: $sampleRate")
                Log.i(TAG, "Num threads: $numThreads")
                Log.i(TAG, "Debug: $debug")
                
                // --- Start Refined Path Adjustment Logic ---
                var assetBasePath = modelDir // Start with the base directory provided
                var modelFound = false

                // 1. Check directly in modelDir
                val directModelPath = File(assetBasePath, modelFileName).absolutePath
                Log.i(TAG, "Initial check for model at: $directModelPath")
                if (File(directModelPath).exists()) {
                    modelFound = true
                    Log.i(TAG, "Model found directly in modelDir.")
                }

                // 2. If not found directly, search immediate subdirectories
                if (!modelFound) {
                    Log.w(TAG, "Model not found directly in modelDir. Searching immediate subdirectories...")
                    try {
                        val modelDirFile = File(modelDir)
                        // Ensure the base directory exists and is a directory before listing
                        if (modelDirFile.exists() && modelDirFile.isDirectory) {
                            val subdirectories = modelDirFile.listFiles()?.filter { it.isDirectory }

                            if (subdirectories.isNullOrEmpty()) {
                                Log.w(TAG, "No subdirectories found in $modelDir")
                            } else {
                                Log.i(TAG, "Found subdirectories: ${subdirectories.joinToString { it.name }}")
                                for (subDir in subdirectories) {
                                    val subDirModelPath = File(subDir, modelFileName).absolutePath
                                    Log.i(TAG, "Checking for model in subdirectory: $subDirModelPath")
                                    if (File(subDirModelPath).exists()) {
                                        assetBasePath = subDir.absolutePath // IMPORTANT: Update base path to the subdirectory where files were found
                                        modelFound = true
                                        Log.i(TAG, "Model found in subdirectory. Updated assetBasePath to: $assetBasePath")
                                        break // Found it, stop searching subdirectories
                                    }
                                }
                            }
                        } else {
                             Log.w(TAG, "Base model directory does not exist or is not a directory: $modelDir")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error searching subdirectories: ${e.message}")
                        // Continue, the final check below will handle the 'not found' case
                    }
                }

                // 3. Final check: If model still not found, throw an error
                if (!modelFound) {
                    Log.e(TAG, "Model file '$modelFileName' not found directly in '$modelDir' or in any immediate subdirectories.")
                    // Log directory contents for debugging before throwing
                    try {
                        val dirContents = File(modelDir).listFiles()?.joinToString { it.name } ?: "Unable to list contents or directory doesn't exist"
                        Log.e(TAG, "Contents of '$modelDir': $dirContents")
                    } catch (e: Exception) {
                        Log.e(TAG, "Error listing directory contents for '$modelDir': ${e.message}")
                    }
                    throw Exception("Model file '$modelFileName' not found in '$modelDir' or its immediate subdirectories.")
                }
                // --- End Refined Path Adjustment Logic ---
                
                // Build file paths using the determined assetBasePath
                val modelAbsPath = File(assetBasePath, modelFileName).absolutePath
                val tokensAbsPath = File(assetBasePath, tokensFileName).absolutePath
                val voicesAbsPath = voicesFile?.let { File(assetBasePath, it).absolutePath }
                // Kokoro takes a comma-separated lexicon list; join each entry with the base path.
                val lexiconAbsPaths = lexiconFile?.split(",")?.map { File(assetBasePath, it.trim()).absolutePath }
                // Determine absolute data dir path based on input, relative to the final assetBasePath
                val dataDirAbsPath = when {
                    dataDirInput == null || dataDirInput.isEmpty() -> {
                        Log.i(TAG, "No dataDir provided or empty.")
                        "" // Default to empty
                    }
                    dataDirInput.startsWith("/") -> {
                        Log.i(TAG, "Treating dataDir as absolute.")
                        dataDirInput // Use absolute path directly
                    }
                    else -> {
                        Log.i(TAG, "Treating dataDir as relative, joining with final assetBasePath.")
                        File(assetBasePath, dataDirInput).absolutePath // Join relative path with final assetBasePath
                    }
                }
                
                // Log final paths being used
                Log.i(TAG, "Using Model path: $modelAbsPath")
                Log.i(TAG, "Using Tokens path: $tokensAbsPath")
                Log.i(TAG, "Using Voices path: $voicesAbsPath")
                Log.i(TAG, "Using Lexicon path: $lexiconAbsPaths")
                Log.i(TAG, "Using Data path: $dataDirAbsPath")
                
                // Check if files exist (using the potentially adjusted paths)
                val modelFileObj = File(modelAbsPath)
                val tokensFileObj = File(tokensAbsPath)
                
                if (!modelFileObj.exists()) {
                    throw Exception("Model file not found: $modelAbsPath")
                }
                
                if (!tokensFileObj.exists()) {
                    throw Exception("Tokens file not found: $tokensAbsPath")
                }
                
                voicesAbsPath?.let {
                    val file = File(it)
                    if (!file.exists()) {
                        Log.w(TAG, "Voices file not found: $it")
                    }
                }
                
                // Validate optional files — clear path if file is missing to avoid native protobuf parse failures
                val effectiveLexiconAbsPath = lexiconAbsPaths?.filter {
                    val file = File(it)
                    if (!file.exists()) {
                        Log.w(TAG, "Lexicon file not found, ignoring: $it")
                    }
                    file.exists()
                }?.joinToString(",")?.ifEmpty { null }
                val effectiveVoicesAbsPath = voicesAbsPath?.let {
                    val file = File(it)
                    if (!file.exists()) {
                        Log.w(TAG, "Voices file not found, ignoring: $it")
                        null
                    } else it
                }
                
                // Create TTS model config and main config objects
                val ttsModelConfig = OfflineTtsModelConfig()
                
                // Configure specific model type
                when (modelType) {
                    "vits" -> {
                        Log.i(TAG, "Configuring VITS model")
                        // Create VITS config
                        val vitsConfig = OfflineTtsVitsModelConfig(
                            model = modelAbsPath,
                            lexicon = effectiveLexiconAbsPath ?: "",
                            tokens = tokensAbsPath
                        )
                        
                        // Set data directory and noise scale settings
                        vitsConfig.dataDir = dataDirAbsPath
                        vitsConfig.noiseScale = 0.667f
                        vitsConfig.noiseScaleW = 0.8f
                        vitsConfig.lengthScale = 1.0f
                        
                        // Set in the model config
                        ttsModelConfig.vits = vitsConfig
                    }
                    "kokoro" -> {
                        Log.i(TAG, "Configuring Kokoro model")
                        // Create Kokoro config
                        val kokoroConfig = OfflineTtsKokoroModelConfig(
                            model = modelAbsPath,
                            voices = effectiveVoicesAbsPath ?: "",
                            tokens = tokensAbsPath
                        )
                        
                        // Set data directory and other properties
                        kokoroConfig.dataDir = dataDirAbsPath
                        kokoroConfig.lexicon = effectiveLexiconAbsPath ?: ""
                        kokoroConfig.lengthScale = 1.0f
                        if (!lang.isNullOrEmpty()) {
                            kokoroConfig.lang = lang
                        }
                        
                        // Set in the model config
                        ttsModelConfig.kokoro = kokoroConfig
                    }
                    "matcha" -> {
                        Log.i(TAG, "Configuring Matcha model")
                        // Create Matcha config
                        val matchaConfig = OfflineTtsMatchaModelConfig()
                        
                        // Set properties - Important: use modelAbsPath as acousticModel
                        matchaConfig.acousticModel = modelAbsPath
                        matchaConfig.tokens = tokensAbsPath
                        
                        // Set vocoder if provided (from vocoderFile parameter)
                        if (vocoderFile != null) {
                            val vocoderAbsPath = File(assetBasePath, vocoderFile).absolutePath
                            matchaConfig.vocoder = vocoderAbsPath
                        }
                        // Fall back to voicesFile for backward compatibility
                        else if (effectiveVoicesAbsPath != null) {
                            matchaConfig.vocoder = effectiveVoicesAbsPath
                        }

                        // Set lexicon if provided and exists
                        if (effectiveLexiconAbsPath != null) {
                            matchaConfig.lexicon = effectiveLexiconAbsPath
                        }
                        
                        // Set data directory
                        matchaConfig.dataDir = dataDirAbsPath
                        
                        // Set in the model config
                        ttsModelConfig.matcha = matchaConfig
                    }
                    else -> throw Exception("Unsupported model type: $modelType")
                }
                
                // Set common model config properties
                ttsModelConfig.numThreads = numThreads
                ttsModelConfig.debug = debug
                ttsModelConfig.provider = "cpu"
                
                // Create main TTS config
                val ttsConfig = OfflineTtsConfig()
                ttsConfig.model = ttsModelConfig
                
                // Save reference to model config for parameter overrides
                this.ttsModelConfig = ttsModelConfig
                
                // Initialize the TTS instance
                Log.i(TAG, "Creating TTS instance")
                
                // Log the configuration for debugging
                Log.i(TAG, "TTS Config: $ttsConfig")
                
                // Create TTS instance using absolute file paths (downloaded models only)
                tts = OfflineTts(config = ttsConfig)
                Log.i(TAG, "Successfully created TTS instance using file paths")
                
                // Check if initialization was successful
                if (tts == null) {
                    throw Exception("Failed to initialize TTS engine")
                }

                // Read actual sample rate from native model (overrides JS config value)
                currentSampleRate = tts!!.sampleRate()
                Log.i(TAG, "Native model sample rate: $currentSampleRate Hz")

                // Return success result
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putInt("sampleRate", currentSampleRate)
                resultMap.putInt("numSpeakers", tts!!.numSpeakers())
                
                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
                
                Log.i(TAG, "===== TTS INITIALIZATION COMPLETE =====")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize TTS: ${e.message}")
                e.printStackTrace()
                
                // Release any partially initialized resources
                releaseTtsResources()
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_TTS_INIT", "Failed to initialize TTS: ${e.message}")
                }
                
                Log.i(TAG, "===== TTS INITIALIZATION FAILED =====")
            }
        }
    }
    
    /**
     * Generate speech from text using a config map
     */
    fun generate(config: ReadableMap, promise: Promise) {
        if (!SherpaOnnxImpl.isLibraryLoaded) {
            promise.reject("ERR_LIBRARY_NOT_LOADED", "Sherpa ONNX library is not loaded")
            return
        }

        // Extract parameters from config with proper defaults
        val text = config.getString("text") ?: ""
        val speakerId = config.getInt("speakerId")
        val speakingRate = config.getDouble("speakingRate").toFloat()
        val playAudio = config.getBoolean("playAudio")
        val fileNamePrefix = config.getString("fileNamePrefix")
        // Pre-phonemized input (sherpa-onnx v2.0+); when present it replaces `text`.
        val phonemeCodepoints = if (config.hasKey("phonemeCodepoints")) {
            config.getArray("phonemeCodepoints")?.let { sentences ->
                Array(sentences.size()) { i ->
                    val sentence = sentences.getArray(i)
                    IntArray(sentence?.size() ?: 0) { j -> sentence!!.getInt(j) }
                }
            }
        } else null
        val generationConfig = GenerationConfig(
            sid = speakerId,
            speed = speakingRate,
            phonemeCodepoints = phonemeCodepoints
        )
        
        // Extract with validation and proper defaults
        val lengthScale = if (config.hasKey("lengthScale")) {
            val value = config.getDouble("lengthScale").toFloat()
            // Validate range - typical range is 0.5 to 2.0
            when {
                value < 0.5f -> 0.5f
                value > 2.0f -> 2.0f
                else -> value
            }
        } else {
            1.0f // Default is 1.0 (normal speed)
        }
        
        val noiseScale = if (config.hasKey("noiseScale")) {
            val value = config.getDouble("noiseScale").toFloat()
            // Validate range - typical range is 0.4 to 1.0
            when {
                value < 0.0f -> 0.667f // Use default if invalid
                value > 1.0f -> 1.0f
                else -> value
            }
        } else {
            0.667f // Default for VITS models
        }
        
        val noiseScaleW = if (config.hasKey("noiseScaleW")) {
            val value = config.getDouble("noiseScaleW").toFloat()
            // Validate range - typical range is 0.5 to 1.0
            when {
                value < 0.0f -> 0.8f // Use default if invalid
                value > 1.0f -> 1.0f
                else -> value
            }
        } else {
            0.8f // Default for VITS models
        }

        // Validate text is not empty
        if (text.isBlank() && phonemeCodepoints.isNullOrEmpty()) {
            promise.reject("ERR_INVALID_TEXT", "Text cannot be empty")
            return
        }

        // Log parameters for debugging - explicitly log playAudio value
        Log.d(TAG, "Generating TTS for text: '$text'")
        Log.d(TAG, "Parameters: speakerId=$speakerId, speakingRate=$speakingRate, playAudio=$playAudio")
        Log.d(TAG, "Style parameters: lengthScale=$lengthScale, noiseScale=$noiseScale, noiseScaleW=$noiseScaleW")
        Log.d(TAG, "Using sample rate: $currentSampleRate Hz")
        
        // Claimed here, not inside the executor: a cancel that arrives while this request is
        // still queued must be able to see it (#440).
        val requestId = requestCounter.incrementAndGet()

        executor.execute {
            try {
                if (tts == null) {
                    throw Exception("TTS not initialized")
                }

                if (isGenerating) {
                    throw Exception("TTS is already generating speech")
                }

                if (!isActive(requestId)) {
                    // Cancelled while queued. Reject rather than resolve: nothing was
                    // produced, and reporting success here is the bug this guards.
                    throw Exception("TTS generation was cancelled before it started")
                }

                isGenerating = true

                // Apply parameters to the model config based on model type
                if (ttsModelConfig != null) {
                    when {
                        ttsModelConfig?.vits != null -> {
                            // Apply params to VITS model
                            ttsModelConfig?.vits?.lengthScale = lengthScale
                            ttsModelConfig?.vits?.noiseScale = noiseScale
                            ttsModelConfig?.vits?.noiseScaleW = noiseScaleW
                            Log.d(TAG, "Applied parameters to VITS model")
                        }
                        ttsModelConfig?.matcha != null -> {
                            // Apply params to Matcha model
                            ttsModelConfig?.matcha?.lengthScale = lengthScale
                            ttsModelConfig?.matcha?.noiseScale = noiseScale
                            Log.d(TAG, "Applied parameters to Matcha model")
                        }
                        ttsModelConfig?.kokoro != null -> {
                            // Apply params to Kokoro model (only supports lengthScale)
                            ttsModelConfig?.kokoro?.lengthScale = lengthScale
                            Log.d(TAG, "Applied parameters to Kokoro model")
                        }
                    }
                }

                // Initialize audio track if needed and playAudio is true
                if (playAudio) {
                    // Release any existing audio track first
                    releaseAudioTrack()
                    
                    // Prefill the track before starting playback. Starting an empty stream
                    // makes the first callback prone to an audible underrun.
                    initAudioTrack(currentSampleRate, startPlayback = false, ownerRequestId = requestId)
                    
                    if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                        Log.e(TAG, "Failed to initialize AudioTrack for playback!")
                        // We'll continue and at least generate the file
                    } else {
                        Log.d(TAG, "AudioTrack initialized successfully for playback")
                    }
                }

                val startTime = System.currentTimeMillis()
                var audio: FloatArray? = null

                if (playAudio) {
                    // Generate and play in real-time
                    Log.d(TAG, "Using generateWithConfigAndCallback for real-time playback")
                    
                    var totalSamplesWritten = 0
                    var totalCalls = 0
                    var playbackStarted = false
                    // Frames buffered into the CURRENT AudioTrack. Distinct from
                    // totalSamplesWritten, which is cumulative across the utterance: when a
                    // track is replaced mid-generation the new one starts empty, so a
                    // cumulative count would claim the prefill target was already met and
                    // start a track holding far less than that.
                    var framesInCurrentTrack = 0
                    
                    // Use explicit Function1 object instead of a lambda to prevent D8 from
                    // desugaring it into ExternalSyntheticLambda, which breaks the JNI lookup
                    // of invoke([F)Ljava/lang/Integer; in generateWithConfigImpl.
                    tts?.generateWithConfigAndCallback(text, generationConfig, object : Function1<FloatArray, Int> {
                        override fun invoke(samples: FloatArray): Int {
                        if (!isActive(requestId)) {
                            Log.i(TAG, "TTS generation interrupted by stop request")
                            return 0  // Stop generating
                        }
                        
                        totalCalls++
                        
                        // Check if AudioTrack is still valid and re-create if necessary
                        if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                            Log.e(TAG, "AudioTrack invalid during playback, reinitializing...")
                            try {
                                releaseAudioTrack()
                                // A replacement track is empty, so it must earn its own
                                // prefill before starting. Carrying playbackStarted over
                                // would start it immediately and let a remainder below the
                                // threshold play as silence — or not at all.
                                initAudioTrack(currentSampleRate, startPlayback = false, ownerRequestId = requestId)
                                PrefillPolicy.onTrackReplaced().let {
                                    framesInCurrentTrack = it.framesInCurrentTrack
                                    playbackStarted = it.playbackStarted
                                }
                                // Add a small delay to let AudioTrack initialize
                                Thread.sleep(50)
                            } catch (e: Exception) {
                                Log.e(TAG, "Failed to reinitialize AudioTrack: ${e.message}")
                                return 1 // Continue but skip playing this chunk
                            }
                        }

                        try {
                            // Convert float samples to short samples for PCM_16BIT encoding
                            val shortSamples = ShortArray(samples.size)
                            for (i in samples.indices) {
                                // Convert from float [-1.0,1.0] to short [−32,768, 32,767]
                                // IMPORTANT: Optimize conversion using direct multiplication
                                // and clamp values to prevent overflow
                                val sample = samples[i]
                                val clampedSample = if (sample < -1.0f) -1.0f else if (sample > 1.0f) 1.0f else sample
                                shortSamples[i] = (clampedSample * 32767.0f).toInt().toShort()
                            }

                            // Write in chunks to prevent underruns - use a chunk size that's not too small
                            // and not too large (1024 samples is a good compromise)
                            val chunkSize = 2048
                            var offset = 0

                            while (offset < shortSamples.size) {
                                // Checked every chunk, not just on callback entry. A stop
                                // landing mid-chunk otherwise kept issuing blocking writes
                                // and returned 1, so the engine carried on generating
                                // while stop()'s pause/flush sat queued behind it (#440).
                                if (!isActive(requestId)) {
                                    Log.i(TAG, "TTS generation interrupted mid-chunk by stop request")
                                    return 0
                                }
                                val remainingSize = shortSamples.size - offset
                                val currentChunkSize = kotlin.math.min(chunkSize, remainingSize)

                                // Check if the AudioTrack is still valid before writing
                                if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                                    Log.w(TAG, "AudioTrack disabled during chunk write, reinitializing...")
                                    releaseAudioTrack()
                                    initAudioTrack(currentSampleRate, startPlayback = false, ownerRequestId = requestId)
                                    PrefillPolicy.onTrackReplaced().let {
                                        framesInCurrentTrack = it.framesInCurrentTrack
                                        playbackStarted = it.playbackStarted
                                    }
                                    // If AudioTrack couldn't be reinitialized, continue to next chunk
                                    if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                                        offset += currentChunkSize
                                        continue
                                    }
                                }

                                val written = audioTrack?.write(shortSamples, offset, currentChunkSize, AudioTrack.WRITE_BLOCKING) ?: 0
                                if (written > 0) {
                                    totalSamplesWritten += written
                                    framesInCurrentTrack += written
                                    offset += written
                                    // isActive first: the AudioTrack.write() above blocks,
                                    // so a stop can land between the callback's entry check
                                    // and here. stop()'s pause/flush is queued behind this
                                    // generation and cannot undo a play() that already
                                    // ran (#440).
                                    if (isActive(requestId) && PrefillPolicy.shouldStart(
                                            playbackStarted,
                                            framesInCurrentTrack,
                                            currentSampleRate,
                                            canLowerThreshold(),
                                            audioTrack?.bufferSizeInFrames ?: 0
                                        )
                                    ) {
                                        audioTrack?.play()
                                        playbackStarted = true
                                        // Recheck after play(): a cancel landing between
                                        // the guard above and here would otherwise start
                                        // playback that stop() cannot undo, since its
                                        // pause/flush is queued behind this generation.
                                        // We are the only actor that can stop it now.
                                        if (!isActive(requestId)) {
                                            Log.i(TAG, "Cancelled during playback start; stopping the track")
                                            try {
                                                audioTrack?.pause()
                                                audioTrack?.flush()
                                            } catch (e: Exception) {
                                                Log.w(TAG, "Failed to stop playback after cancel: ${e.message}")
                                            }
                                            return 0
                                        }
                                        // Head is expected to still be 0 here — output advances
                                        // asynchronously. The value logged at generation end is
                                        // the one that shows whether playback actually ran.
                                        Log.d(TAG, "AudioTrack play() called after prefill: $framesInCurrentTrack frames buffered in current track")
                                    }
                                } else {
                                    // If write fails, skip this chunk and try the next one
                                    Log.w(TAG, "Failed to write chunk: error code $written")
                                    offset += currentChunkSize
                                }
                            }

                            if (totalCalls % 10 == 0) {
                                Log.d(TAG, "Playing audio: $totalSamplesWritten samples written so far in $totalCalls calls")
                            }

                            return 1  // Continue generating
                        } catch (e: Exception) {
                            Log.e(TAG, "Error during audio playback: ${e.message}")
                            e.printStackTrace() // Add stack trace for better debugging
                            return 1  // Continue but skip playing this chunk
                        }
                        } // end invoke
                    }) // end object / generateWithConfigAndCallback

                    // Short utterances can finish before reaching the prefill threshold.
                    //
                    // The cancellation check is load-bearing, not defensive. stop() and
                    // release() now cancel on the caller's thread rather than queueing
                    // behind this generation (#440), so they can and do flip this mid-flight.
                    // Without the guard, a stop during prefill would still play the buffered
                    // samples: stop() only pauses a track already in PLAYSTATE_PLAYING, and a
                    // prefilling track is still STOPPED.
                    if (isActive(requestId) && !playbackStarted && framesInCurrentTrack > 0) {
                        // The utterance ended below the prefill target, so the start
                        // threshold will never be reached on its own. On API 31+ lower it
                        // to what is actually buffered. Below API 31 the threshold is fixed
                        // at the buffer size, so pad with silence up to that size instead —
                        // otherwise play() waits on samples that never arrive and the
                        // utterance is silently dropped.
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                            try {
                                audioTrack?.startThresholdInFrames = framesInCurrentTrack
                            } catch (e: Exception) {
                                Log.w(TAG, "Could not lower start threshold for short utterance: ${e.message}")
                            }
                        } else {
                            val deficit = PrefillPolicy.tailPaddingFrames(
                                framesInCurrentTrack,
                                canLowerThreshold(),
                                audioTrack?.bufferSizeInFrames ?: 0
                            )
                            if (deficit > 0) {
                                val silence = ShortArray(minOf(deficit, currentSampleRate))
                                var padded = 0
                                while (padded < deficit) {
                                    val n = minOf(silence.size, deficit - padded)
                                    val w = audioTrack?.write(silence, 0, n, AudioTrack.WRITE_BLOCKING) ?: 0
                                    if (w <= 0) break
                                    padded += w
                                }
                                Log.d(TAG, "Padded short utterance with $padded silent frames to reach the pre-S start threshold")
                            }
                        }
                        // Re-checked immediately before play(): the padding writes above
                        // block, so a stop can land between the guard on this branch and
                        // here. stop()'s pause/flush is queued behind this generation, so
                        // audio started now would keep playing after the cancel (#440).
                        if (isActive(requestId)) {
                            audioTrack?.play()
                            playbackStarted = true
                            // Same recheck as the chunk-loop play() above.
                            if (!isActive(requestId)) {
                                Log.i(TAG, "Cancelled during short-utterance playback start; stopping the track")
                                try {
                                    audioTrack?.pause()
                                    audioTrack?.flush()
                                } catch (e: Exception) {
                                    Log.w(TAG, "Failed to stop playback after cancel: ${e.message}")
                                }
                            }
                            Log.d(TAG, "AudioTrack playback started after short utterance prefill: $framesInCurrentTrack samples")
                        } else {
                            Log.i(TAG, "Skipping playback start: generation was cancelled during prefill")
                        }
                    }

                    Log.d(TAG, "Completed callback generation. Total samples: $totalSamplesWritten in $totalCalls callback calls, head=${audioTrack?.playbackHeadPosition}, playState=${audioTrack?.playState}")
                } else {
                    // Generate without playback
                    Log.d(TAG, "Using generate method without callback")
                    val generatedAudio = tts?.generateWithConfig(text, generationConfig)
                    // tts.generate() blocks for the whole synthesis and cannot be
                    // interrupted, so a stop arriving during it is only observable here.
                    // Without this the cancelled request still saved a file and resolved
                    // success (#440).
                    if (!isActive(requestId)) {
                        throw Exception("TTS generation was cancelled")
                    }
                    audio = generatedAudio?.samples
                }

                // Both branches above can block for the whole synthesis — tts.generate()
                // cannot be interrupted at all — so a stop that arrives during one of them
                // is only observable here. Without this check the cancelled request still
                // fell through to promise.resolve({success: true}) below (#440).
                if (!isActive(requestId)) {
                    throw Exception("TTS generation was cancelled")
                }

                val endTime = System.currentTimeMillis()
                val duration = endTime - startTime
                Log.d(TAG, "Speech generation completed in ${duration}ms")

                // Save audio to file if needed. Empty audio (e.g. no lexicon since
                // sherpa-onnx v2.0) takes the retry path below and fails there.
                if (audio != null && audio.isNotEmpty()) {
                    val fileName = fileNamePrefix?.let { "${it}_${System.currentTimeMillis()}" }
                        ?: "generated_audio_${System.currentTimeMillis()}"
                    val filePath = "${reactContext.cacheDir.absolutePath}/$fileName.wav"
                    
                    // Claim completion before writing. The write is synchronous, so a
                    // recheck alone leaves a window where a stop lands partway through and
                    // the request is both cancelled and resolved (#440).
                    if (!tryCompleteRequest(requestId)) {
                        throw Exception("TTS generation was cancelled")
                    }

                    // Use the correct sample rate from the model
                    val saved = AudioUtils.saveAsWav(audio, currentSampleRate, filePath)
                    Log.d(TAG, "Audio saved: $saved, file path: $filePath")
                    
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", true)
                    resultMap.putString("filePath", filePath)
                    promise.resolve(resultMap)
                } else {
                    // A cancelled generation also lands here — generateWithCallback returns
                    // 0 and this path sees no audio — and tts.generate() cannot be
                    // interrupted, so falling through restarted synthesis and resolved it as
                    // success, undoing the stop entirely (#440).
                    if (!isActive(requestId)) {
                        throw Exception("TTS generation was cancelled")
                    }

                    // If no audio was generated, try again without callback
                    Log.w(TAG, "No audio generated with callback method, trying again without callback")
                    
                    // Fallback: try again without callback
                    val generatedAudio = tts?.generateWithConfig(text, generationConfig)
                    // Same recheck as the other fallback: this call blocks for the
                    // whole synthesis and cannot be interrupted, so a stop during it
                    // is only observable here. This is the common path, not the
                    // exceptional one — the callback's return is discarded above, so
                    // every uninterrupted playAudio=true request lands here (#440).
                    if (!isActive(requestId)) {
                        throw Exception("TTS generation was cancelled")
                    }
                    audio = generatedAudio?.samples
                    
                    if (audio == null || audio.isEmpty()) {
                        throw Exception("Failed to generate speech audio. Since sherpa-onnx v2.0 this model may need a lexicon file or phonemeCodepoints.")
                    }
                    
                    val fileName = fileNamePrefix?.let { "${it}_${System.currentTimeMillis()}" }
                        ?: "generated_audio_${System.currentTimeMillis()}"
                    val filePath = "${reactContext.cacheDir.absolutePath}/$fileName.wav"
                    
                    // Claim completion before writing. The write is synchronous, so a
                    // recheck alone leaves a window where a stop lands partway through and
                    // the request is both cancelled and resolved (#440).
                    if (!tryCompleteRequest(requestId)) {
                        throw Exception("TTS generation was cancelled")
                    }

                    // Use the correct sample rate from the model
                    val saved = AudioUtils.saveAsWav(audio, currentSampleRate, filePath)
                    Log.d(TAG, "Audio saved: $saved, file path: $filePath")
                    
                    val resultMap = Arguments.createMap()
                    resultMap.putBoolean("success", true)
                    resultMap.putString("filePath", filePath)
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error generating speech: ${e.message}")
                promise.reject("ERR_GENERATION_FAILED", e.message)
            } finally {
                isGenerating = false
                // Don't stop the AudioTrack here as it might still be playing
            }
        }
    }
    
    /**
     * Release AudioTrack resources
     */
    private fun releaseAudioTrack() {
        // No owner once the track is gone; a stale id here would make stop() skip cleanup
        // for a track that no longer exists.
        audioTrackOwner = 0
        try {
            // Release whenever the track is non-null, not only when it reached
            // STATE_INITIALIZED. A track whose build() succeeded but whose init
            // failed still owns a native track; gating release on STATE_INITIALIZED
            // dropped the reference without freeing it, and the reinit-on-failure
            // paths leak once per retry.
            audioTrack?.let { track ->
                if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    track.stop()
                }
                track.release()
            }
            audioTrack = null
            Log.d(TAG, "AudioTrack released")
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing AudioTrack: ${e.message}")
        }
    }
    
    /**
     * Initialize audio track for playback
     */
    private fun initAudioTrack(sampleRate: Int, startPlayback: Boolean = true, ownerRequestId: Long = 0) {
        try {
            // Release any existing AudioTrack first to prevent resource conflicts.
            // Same unconditional release as releaseAudioTrack(): an uninitialized
            // track still owns native resources.
            try {
                audioTrack?.let { track ->
                    if (track.playState == AudioTrack.PLAYSTATE_PLAYING) {
                        track.stop()
                    }
                    track.release()
                }
                audioTrack = null
                Log.d(TAG, "AudioTrack released")
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing AudioTrack: ${e.message}")
            }
            
            val sherpaModelSampleRate = sampleRate
            Log.d(TAG, "Using model sample rate: $sherpaModelSampleRate Hz for AudioTrack")
            
            // Calculate buffer size - use a MUCH larger multiplier to prevent underruns
            val minBufferSize = AudioTrack.getMinBufferSize(
                sherpaModelSampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            ) * 16  // Use 16x buffer (double previous value) for extremely reliable playback
            
            Log.d(TAG, "Creating AudioTrack with buffer size: $minBufferSize bytes, sample rate: $sherpaModelSampleRate Hz")

            // Create with explicit stream type for maximum compatibility
            // Claim ownership before building: stop() uses this to tell a track that
            // belongs to a newer generation from one left behind by a cancelled request.
            audioTrackOwner = ownerRequestId
            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .setLegacyStreamType(android.media.AudioManager.STREAM_MUSIC) // Explicitly use STREAM_MUSIC
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT) // Use 16-bit PCM
                        .setSampleRate(sherpaModelSampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(minBufferSize)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()

            // A MODE_STREAM track does not begin output when play() is called — it waits
            // until the buffer holds startThresholdInFrames, which defaults to the full
            // buffer capacity. With a 16x buffer that is well over a second, so prefilling
            // 200ms and calling play() would still stall, and utterances shorter than the
            // buffer would never start at all. Align the threshold with the prefill target.
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                try {
                    audioTrack?.startThresholdInFrames = prefillFrames(sherpaModelSampleRate)
                    Log.d(TAG, "AudioTrack start threshold set to ${prefillFrames(sherpaModelSampleRate)} frames")
                } catch (e: Exception) {
                    // Non-fatal: the track still plays, just with the default threshold.
                    Log.w(TAG, "Could not set AudioTrack start threshold: ${e.message}")
                }
            }

            // Check if the AudioTrack was created successfully
            if (audioTrack?.state != AudioTrack.STATE_INITIALIZED) {
                Log.e(TAG, "Failed to initialize AudioTrack - not in initialized state")
                // build() succeeded, so this track owns native resources even though init
                // failed. Free them now rather than leaving it parked in the field until
                // some later generate() or release() happens to clear it.
                releaseAudioTrack()
                return
            }

            // Set max volume and start playback
            audioTrack?.apply {
                // Set the playback rate to match the model's sample rate
                playbackRate = sherpaModelSampleRate
                
                // Make sure volume is at maximum
                setVolume(1.0f)
                
                // Check audio focus
                try {
                    val audioManager = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
                    if (audioManager.isMusicActive) {
                        Log.w(TAG, "Music is currently active on device, this may affect TTS playback")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error checking audio focus: ${e.message}")
                }
                
                if (startPlayback) {
                    play()
                    Log.d(TAG, "AudioTrack created and started. State: ${if (state == AudioTrack.STATE_INITIALIZED) "INITIALIZED" else "NOT INITIALIZED"}")
                } else {
                    Log.d(TAG, "AudioTrack created and waiting for prefill")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize AudioTrack: ${e.message}")
            e.printStackTrace()
        }
    }
    
    /**
     * Stop TTS generation
     */
    fun stop(promise: Promise) {
        // Cancel on the CALLING thread, not the executor. init/generate/stop/release share
        // one single-threaded executor, so queueing this behind an in-flight generate() meant
        // it could not run until that generation had already finished — the checks inside the
        // callback loop could never fire during the generation they exist to interrupt,
        // making stopTts() a no-op (#440). The fields are atomic/@Volatile, so the loop is
        // guaranteed to see this write rather than a cached value.
        cancelOutstandingRequests()
        // The cutoff this stop established. A generation that claims a later id is not
        // covered by it, so the queued cleanup below must not touch the shared AudioTrack
        // on its behalf — that would contradict the promise that post-cutoff requests are
        // unaffected (#440).
        val cutoff = cancelledThrough.get()

        executor.execute {
            try {
                Log.i(TAG, "Stopping TTS generation")

                // Already cleared above; the executor body handles the AudioTrack, which must
                // stay on this thread because the generation loop writes to it from here.

                // Stop audio playback, unless a newer generation now owns the track.
                // The owner, not the counter. A newer request existing does not mean it
                // owns the track: stopTts() followed immediately by a playAudio=false
                // generate bumps the counter while the cancelled request's track is still
                // playing, and nothing else would ever release it (#440).
                val owner = audioTrackOwner
                if (owner > cutoff) {
                    Log.d(TAG, "Skipping AudioTrack cleanup: request $owner owns the track and started after this stop")
                } else if (audioTrack?.playState == AudioTrack.PLAYSTATE_PLAYING) {
                    audioTrack?.pause()
                    audioTrack?.flush()
                    Log.d(TAG, "Paused and flushed AudioTrack")
                }
                
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("stopped", true)
                resultMap.putString("message", "TTS generation stopped successfully")
                
                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping TTS: ${e.message}")
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_TTS_STOP", "Failed to stop TTS: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Release TTS resources
     */
    fun release(promise: Promise) {
        // Same reason as stop(): cancel before queueing, so an in-flight generation stops
        // feeding the executor rather than blocking this call behind itself (#440).
        cancelOutstandingRequests()

        executor.execute {
            try {
                Log.i(TAG, "Releasing TTS resources")
                
                // Release TTS resources
                releaseTtsResources()
                
                val resultMap = Arguments.createMap()
                resultMap.putBoolean("released", true)
                
                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing TTS: ${e.message}")
                
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_TTS_RELEASE", "Failed to release TTS: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Clean up resources
     */
    private fun releaseTtsResources() {
        // Clean up AudioTrack
        releaseAudioTrack()
        
        // Release TTS engine
        try {
            tts?.release()
            tts = null
            Log.d(TAG, "TTS engine released")
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing TTS engine: ${e.message}")
        }
    }
} 
