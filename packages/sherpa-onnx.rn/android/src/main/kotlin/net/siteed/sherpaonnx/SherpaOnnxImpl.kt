package net.siteed.sherpaonnx

import android.app.ActivityManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.turbomodule.core.CallInvokerHolderImpl
import java.io.File

import com.k2fsa.sherpa.onnx.VersionInfo

// Import the handlers
import net.siteed.sherpaonnx.handlers.ASRHandler
import net.siteed.sherpaonnx.handlers.ArchiveHandler
import net.siteed.sherpaonnx.handlers.AudioTaggingHandler
import net.siteed.sherpaonnx.handlers.DiarizationHandler
import net.siteed.sherpaonnx.handlers.KWSHandler
import net.siteed.sherpaonnx.handlers.SpeakerIdHandler
import net.siteed.sherpaonnx.handlers.TtsHandler
import net.siteed.sherpaonnx.handlers.VadHandler
import net.siteed.sherpaonnx.handlers.LanguageIdHandler
import net.siteed.sherpaonnx.handlers.PunctuationHandler
import net.siteed.sherpaonnx.handlers.DenoisingHandler
import net.siteed.sherpaonnx.handlers.OnnxInferenceHandler

class SherpaOnnxImpl(private val reactContext: ReactApplicationContext) {
    // Feature handlers
    private val ttsHandler = TtsHandler(reactContext)
    private val audioTaggingHandler = AudioTaggingHandler(reactContext)
    private val archiveHandler = ArchiveHandler(reactContext)
    private val asrHandler = ASRHandler(reactContext)
    private val speakerIdHandler = SpeakerIdHandler(reactContext)
    private val diarizationHandler = DiarizationHandler(reactContext)
    private val kwsHandler = KWSHandler(reactContext)
    private val vadHandler = VadHandler(reactContext)
    private val languageIdHandler = LanguageIdHandler(reactContext)
    private val punctuationHandler = PunctuationHandler(reactContext)
    private val denoisingHandler = DenoisingHandler(reactContext)
    private val onnxInferenceHandler = OnnxInferenceHandler(reactContext)

    companion object {
        private const val TAG = "SherpaOnnxImpl"
        var isLibraryLoaded = false

        init {
            try {
                System.loadLibrary("sherpa-onnx-jni")
                isLibraryLoaded = true
                Log.i(TAG, "Sherpa ONNX JNI library loaded successfully")
            } catch (e: UnsatisfiedLinkError) {
                isLibraryLoaded = false
                Log.e(TAG, "Failed to load Sherpa ONNX JNI library", e)
            }
        }
    }

    // TTS Methods
    fun initTts(config: ReadableMap, promise: Promise) {
        ttsHandler.init(config, promise)
    }

    fun generateTts(config: ReadableMap, promise: Promise) {
        ttsHandler.generate(config, promise)
    }

    fun stopTts(promise: Promise) {
        ttsHandler.stop(promise)
    }

    fun releaseTts(promise: Promise) {
        ttsHandler.release(promise)
    }

    // ASR Methods
    fun initAsr(config: ReadableMap, promise: Promise) {
        asrHandler.init(config, promise)
    }

    fun recognizeFromSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        asrHandler.recognizeFromSamples(sampleRate, audioBuffer, promise)
    }

    fun recognizeFromFile(filePath: String, promise: Promise) {
        asrHandler.recognizeFromFile(filePath, promise)
    }

    fun releaseAsr(promise: Promise) {
        asrHandler.release(promise)
    }

    fun createAsrOnlineStream(promise: Promise) {
        asrHandler.createAsrOnlineStream(promise)
    }

    fun acceptAsrOnlineWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        asrHandler.acceptAsrOnlineWaveform(sampleRate, audioBuffer, promise)
    }

    fun isAsrOnlineEndpoint(promise: Promise) {
        asrHandler.isAsrOnlineEndpoint(promise)
    }

    fun getAsrOnlineResult(promise: Promise) {
        asrHandler.getAsrOnlineResult(promise)
    }

    fun finishAsrOnlineInput(promise: Promise) {
        asrHandler.finishAsrOnlineInput(promise)
    }

    fun resetAsrOnlineStream(promise: Promise) {
        asrHandler.resetAsrOnlineStream(promise)
    }

    // Audio Tagging Methods
    fun initAudioTagging(config: ReadableMap, promise: Promise) {
        audioTaggingHandler.init(config, promise)
    }

    fun processAudioSamples(sampleRate: Int, audioBuffer: ReadableArray, topK: Int = -1, promise: Promise) {
        audioTaggingHandler.processAudioSamples(sampleRate, audioBuffer, topK, promise)
    }

    fun computeAudioTagging(topK: Int = -1, promise: Promise) {
        audioTaggingHandler.computeAudioTagging(topK, promise)
    }

    fun releaseAudioTagging(promise: Promise) {
        audioTaggingHandler.release(promise)
    }

    fun processAndComputeAudioTagging(filePath: String, topK: Int = -1, promise: Promise) {
        audioTaggingHandler.processAndComputeAudioTagging(filePath, topK, promise)
    }

    fun processAudioFile(filePath: String, topK: Int = -1, promise: Promise) {
        audioTaggingHandler.processAudioFile(filePath, topK, promise)
    }

    // Speaker ID Methods
    fun initSpeakerId(config: ReadableMap, promise: Promise) {
        speakerIdHandler.init(config, promise)
    }

    fun processSpeakerIdSamples(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        speakerIdHandler.processAudioSamples(sampleRate, audioBuffer, promise)
    }

    fun computeSpeakerEmbedding(promise: Promise) {
        speakerIdHandler.computeEmbedding(promise)
    }

    fun resetSpeakerIdStream(promise: Promise) {
        speakerIdHandler.resetStream(promise)
    }

    fun registerSpeaker(name: String, embedding: ReadableArray, promise: Promise) {
        speakerIdHandler.registerSpeaker(name, embedding, promise)
    }

    fun removeSpeaker(name: String, promise: Promise) {
        speakerIdHandler.removeSpeaker(name, promise)
    }

    fun getSpeakers(promise: Promise) {
        speakerIdHandler.getSpeakers(promise)
    }

    fun identifySpeaker(embedding: ReadableArray, threshold: Float, promise: Promise) {
        speakerIdHandler.identifySpeaker(embedding, threshold, promise)
    }

    fun verifySpeaker(name: String, embedding: ReadableArray, threshold: Float, promise: Promise) {
        speakerIdHandler.verifySpeaker(name, embedding, threshold, promise)
    }

    fun processSpeakerIdFile(filePath: String, promise: Promise) {
        speakerIdHandler.processAudioFile(filePath, promise)
    }

    fun processSpeakerIdFileWindow(filePath: String, startTimeMs: Double, durationMs: Double, promise: Promise) {
        speakerIdHandler.processAudioFileWindow(filePath, startTimeMs, durationMs, promise)
    }

    fun releaseSpeakerId(promise: Promise) {
        speakerIdHandler.release(promise)
    }

    // Diarization Methods
    fun initDiarization(config: ReadableMap, promise: Promise) {
        diarizationHandler.initDiarization(config, promise)
    }

    fun processDiarizationFile(filePath: String, numClusters: Int, threshold: Float, promise: Promise) {
        diarizationHandler.processDiarizationFile(filePath, numClusters, threshold, promise)
    }

    fun processDiarizationFileWindow(
        filePath: String,
        startTimeMs: Double,
        durationMs: Double,
        numClusters: Int,
        threshold: Float,
        promise: Promise
    ) {
        diarizationHandler.processDiarizationFileWindow(filePath, startTimeMs, durationMs, numClusters, threshold, promise)
    }

    fun releaseDiarization(promise: Promise) {
        diarizationHandler.releaseDiarization(promise)
    }

    // KWS Methods
    fun initKws(config: ReadableMap, promise: Promise) {
        kwsHandler.init(config, promise)
    }

    fun acceptKwsWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        kwsHandler.acceptWaveform(sampleRate, audioBuffer, promise)
    }

    fun resetKwsStream(promise: Promise) {
        kwsHandler.resetStream(promise)
    }

    fun releaseKws(promise: Promise) {
        kwsHandler.release(promise)
    }

    // VAD Methods
    fun initVad(config: ReadableMap, promise: Promise) {
        vadHandler.init(config, promise)
    }

    fun acceptVadWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        vadHandler.acceptWaveform(sampleRate, audioBuffer, promise)
    }

    fun resetVad(promise: Promise) {
        vadHandler.reset(promise)
    }

    fun releaseVad(promise: Promise) {
        vadHandler.release(promise)
    }

    // Language ID Methods
    fun initLanguageId(config: ReadableMap, promise: Promise) {
        languageIdHandler.init(config, promise)
    }

    fun detectLanguage(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        languageIdHandler.detectLanguage(sampleRate, audioBuffer, promise)
    }

    fun detectLanguageFromFile(filePath: String, promise: Promise) {
        languageIdHandler.detectLanguageFromFile(filePath, promise)
    }

    fun releaseLanguageId(promise: Promise) {
        languageIdHandler.release(promise)
    }

    // Punctuation Methods
    fun initPunctuation(config: ReadableMap, promise: Promise) {
        punctuationHandler.init(config, promise)
    }

    fun addPunctuation(text: String, promise: Promise) {
        punctuationHandler.addPunctuation(text, promise)
    }

    fun releasePunctuation(promise: Promise) {
        punctuationHandler.release(promise)
    }

    // Denoising Methods
    fun initDenoiser(config: ReadableMap, promise: Promise) {
        denoisingHandler.initDenoiser(config, promise)
    }

    fun denoiseFile(filePath: String, promise: Promise) {
        denoisingHandler.denoiseFile(filePath, promise)
    }

    fun releaseDenoiser(promise: Promise) {
        denoisingHandler.releaseDenoiser(promise)
    }

    // ONNX Inference Methods
    fun createOnnxSession(config: ReadableMap, promise: Promise) = onnxInferenceHandler.createSession(config, promise)
    fun runOnnxSession(sessionId: String, inputNames: ReadableArray, inputTypes: ReadableArray, inputDims: ReadableArray, inputData: ReadableArray, promise: Promise) = onnxInferenceHandler.runSession(sessionId, inputNames, inputTypes, inputDims, inputData, promise)
    fun releaseOnnxSession(sessionId: String, promise: Promise) = onnxInferenceHandler.releaseSession(sessionId, promise)

    // Utility Methods
    fun extractTarBz2(sourcePath: String, targetDir: String, promise: Promise) {
        archiveHandler.extractTarBz2(sourcePath, targetDir, promise)
    }

    fun validateLibraryLoaded(promise: Promise) {
        val resultMap = Arguments.createMap()
        resultMap.putBoolean("loaded", isLibraryLoaded)

        if (isLibraryLoaded) {
            resultMap.putString("status", "Sherpa ONNX JNI library loaded successfully")
        } else {
            resultMap.putString("status", "Failed to load Sherpa ONNX JNI library")
        }

        promise.resolve(resultMap)
    }

    fun testOnnxIntegration(promise: Promise) {
        try {
            // Test JNI communication with a real native call. An empty OnlineStream()
            // no longer works as a probe: since v2.0.1 it requires a native pointer.
            check(VersionInfo.version.isNotEmpty()) { "Native version string is empty" }

            val response = Arguments.createMap().apply {
                putString("status", "C library integration successful")
                putBoolean("success", true)
            }

            promise.resolve(response)
        } catch (e: Throwable) {
            // Throwable: a missing JNI symbol or library throws an Error, not an Exception.
            val response = Arguments.createMap().apply {
                putString("status", "C library integration failed: ${e.message}")
                putBoolean("success", false)
            }
            promise.resolve(response)  // Still resolve but with error info
        }
    }

    fun getArchitectureInfo(promise: Promise) {
        getSystemInfo(promise)
    }

    fun getSystemInfo(promise: Promise) {
        val response = Arguments.createMap()

        try {
            // React Native Architecture Info
            val archInfo = Arguments.createMap()
            val isNewArchEnabled = true // New Architecture is always enabled (SDK 55+)

            // Check if JSI is available (for additional context)
            val isJSIAvailable = try {
                Class.forName("com.facebook.react.turbomodule.core.CallInvokerHolderImpl")
                true
            } catch (e: ClassNotFoundException) {
                false
            }

            archInfo.putString("type", if (isNewArchEnabled) "new" else "old")
            archInfo.putString("description", if (isNewArchEnabled) "New Architecture (TurboModules)" else "Old Architecture (Bridge)")
            archInfo.putBoolean("jsiAvailable", isJSIAvailable)
            archInfo.putBoolean("turboModulesEnabled", isNewArchEnabled)
            archInfo.putString("moduleType", if (isNewArchEnabled) "TurboModule" else "Bridge Module")
            response.putMap("architecture", archInfo)

            // Memory Information
            val memoryInfo = Arguments.createMap()
            val runtime = Runtime.getRuntime()
            val maxMemory = runtime.maxMemory()
            val totalMemory = runtime.totalMemory()
            val freeMemory = runtime.freeMemory()
            val usedMemory = totalMemory - freeMemory

            memoryInfo.putDouble("maxMemoryMB", maxMemory / 1024.0 / 1024.0)
            memoryInfo.putDouble("totalMemoryMB", totalMemory / 1024.0 / 1024.0)
            memoryInfo.putDouble("freeMemoryMB", freeMemory / 1024.0 / 1024.0)
            memoryInfo.putDouble("usedMemoryMB", usedMemory / 1024.0 / 1024.0)

            // Get system memory info
            val activityManager = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (activityManager != null) {
                val memInfo = ActivityManager.MemoryInfo()
                activityManager.getMemoryInfo(memInfo)
                memoryInfo.putDouble("systemTotalMemoryMB", memInfo.totalMem / 1024.0 / 1024.0)
                memoryInfo.putDouble("systemAvailableMemoryMB", memInfo.availMem / 1024.0 / 1024.0)
                memoryInfo.putBoolean("lowMemory", memInfo.lowMemory)
                memoryInfo.putDouble("lowMemoryThresholdMB", memInfo.threshold / 1024.0 / 1024.0)
            }
            response.putMap("memory", memoryInfo)

            // CPU Information
            val cpuInfo = Arguments.createMap()
            cpuInfo.putInt("availableProcessors", runtime.availableProcessors())

            // Read CPU info from /proc/cpuinfo if available
            try {
                val cpuInfoFile = File("/proc/cpuinfo")
                if (cpuInfoFile.exists()) {
                    val cpuInfoText = cpuInfoFile.readText()
                    val hardwareMatch = Regex("Hardware\\s*:\\s*(.*)").find(cpuInfoText)
                    if (hardwareMatch != null) {
                        cpuInfo.putString("hardware", hardwareMatch.groupValues[1].trim())
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Could not read CPU info", e)
            }

            // ABI Information
            val abiInfo = Arguments.createArray()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                Build.SUPPORTED_ABIS.forEach { abi ->
                    abiInfo.pushString(abi)
                }
            } else {
                @Suppress("DEPRECATION")
                abiInfo.pushString(Build.CPU_ABI)
                @Suppress("DEPRECATION")
                if (Build.CPU_ABI2.isNotEmpty()) {
                    abiInfo.pushString(Build.CPU_ABI2)
                }
            }
            cpuInfo.putArray("supportedAbis", abiInfo)
            response.putMap("cpu", cpuInfo)

            // Device Information
            val deviceInfo = Arguments.createMap()
            deviceInfo.putString("brand", Build.BRAND)
            deviceInfo.putString("model", Build.MODEL)
            deviceInfo.putString("device", Build.DEVICE)
            deviceInfo.putString("manufacturer", Build.MANUFACTURER)
            deviceInfo.putInt("sdkVersion", Build.VERSION.SDK_INT)
            deviceInfo.putString("androidVersion", Build.VERSION.RELEASE)
            response.putMap("device", deviceInfo)

            // GPU Information (limited on Android)
            val gpuInfo = Arguments.createMap()
            // Android doesn't provide direct GPU info access, but we can check for some features
            val packageManager = reactContext.packageManager
            gpuInfo.putBoolean("supportsVulkan",
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
                packageManager.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_LEVEL))

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
                packageManager.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_LEVEL)) {
                // Note: getSystemFeatureLevel is available from API 24+
                // For now, just indicate Vulkan is supported
                gpuInfo.putBoolean("vulkanSupported", true)
            }

            // Check OpenGL ES version
            val glEsVersion = activityManager?.deviceConfigurationInfo?.glEsVersion ?: "Unknown"
            gpuInfo.putString("openGLESVersion", glEsVersion)
            response.putMap("gpu", gpuInfo)

            // Library Status
            response.putBoolean("libraryLoaded", isLibraryLoaded)

            // Thread Information (for debugging)
            val threadInfo = Arguments.createMap()
            threadInfo.putString("currentThread", Thread.currentThread().name)
            threadInfo.putInt("threadId", Thread.currentThread().id.toInt())
            response.putMap("thread", threadInfo)

            Log.i(TAG, "System info collected successfully")
            promise.resolve(response)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get system info", e)
            response.putString("error", e.message)
            promise.resolve(response)
        }
    }

}
