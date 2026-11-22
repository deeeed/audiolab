package net.siteed.sherpaonnx

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import junit.framework.TestCase.*
import kotlinx.coroutines.runBlocking
import net.siteed.sherpaonnx.utils.LightweightModelDownloader
import net.siteed.sherpaonnx.utils.ModelExtractionCache
import net.siteed.sherpaonnx.utils.createPromise
import net.siteed.sherpaonnx.utils.extractModelArchive
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.system.measureTimeMillis
import net.siteed.sherpaonnx.handlers.ArchiveHandler
import net.siteed.sherpaonnx.utils.createTestReactContext

@RunWith(AndroidJUnit4::class)
class RealTtsFunctionalityTest {

    private lateinit var sherpaOnnxImpl: SherpaOnnxImpl
    private lateinit var reactContext: ReactApplicationContext
    private lateinit var context: android.content.Context
    private var downloadedModelPath: String? = null
    private var extractedModelPath: String? = null

    companion object {
        // The VITS archive is about 31 MB. Whisper's 118 MB archive uses 90 seconds.
        private const val MODEL_EXTRACTION_TIMEOUT_SECONDS = 30L
        private const val WAV_HEADER_SIZE_BYTES = 44L
        private const val TEST_TEXT_SHORT = "Hello, this is a test."
        private const val TEST_TEXT_MEDIUM = "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet."
        private val TEST_TEXT_LONG = """
            Sherpa ONNX is a powerful library for speech synthesis and recognition. 
            It supports multiple models and provides high-quality audio output. 
            This test validates the text-to-speech functionality using a lightweight model.
        """.trimIndent()
    }

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        reactContext = createTestReactContext(context)
        sherpaOnnxImpl = SherpaOnnxImpl(reactContext)
        assertTrue("Sherpa ONNX JNI library should load", SherpaOnnxImpl.isLibraryLoaded)
        
        // Download and extract the lightweight TTS model
        runBlocking {
            downloadAndExtractModel()
            downloadLexicon()
        }
    }

    @After
    fun tearDown() {
        // Clean up TTS resources
        releaseTts()
        
        // Clean up downloaded models (optional - keep for faster subsequent tests)
        // LightweightModelDownloader.cleanupModels(context, listOf(LightweightModelDownloader.TestModel.VITS_EN_LOW))
    }

    private suspend fun downloadAndExtractModel() {
        val model = LightweightModelDownloader.TestModel.VITS_EN_LOW
        val targetDir = File(context.cacheDir, "extracted-models/${model.modelName}")
        val modelDir = File(targetDir, "vits-icefall-en_US-ljspeech-low")
        val cache = ModelExtractionCache(
            targetDir = targetDir,
            requiredFiles = listOf(
                File(modelDir, "model.onnx"),
                File(modelDir, "tokens.txt"),
                File(modelDir, "espeak-ng-data/phontab")
            )
        )
        if (cache.isComplete()) {
            extractedModelPath = targetDir.absolutePath
            println("Using extracted TTS model: ${targetDir.absolutePath}")
            return
        }

        println("Downloading model: ${model.modelName}")
        val downloadTime = measureTimeMillis {
            val modelFile = LightweightModelDownloader.downloadModel(
                context = context,
                model = model,
                progressListener = object : LightweightModelDownloader.DownloadProgressListener {
                    override fun onProgress(bytesDownloaded: Long, totalBytes: Long, percentComplete: Int) {
                        if (percentComplete % 10 == 0) {
                            println("Download progress: $percentComplete%")
                        }
                    }
                    
                    override fun onComplete(modelFile: File) {
                        println("Download complete: ${modelFile.absolutePath}")
                        downloadedModelPath = modelFile.absolutePath
                    }
                    
                    override fun onError(error: Exception) {
                        println("Download error: ${error.message}")
                    }
                }
            )
            downloadedModelPath = modelFile.absolutePath
        }
        println("Model downloaded in ${downloadTime}ms")
        
        println("Extracting model to: ${targetDir.absolutePath}")
        val extractTime = measureTimeMillis {
            val extraction = extractModelArchive(
                sherpaOnnxImpl = sherpaOnnxImpl,
                sourcePath = downloadedModelPath!!,
                cache = cache,
                timeoutSeconds = MODEL_EXTRACTION_TIMEOUT_SECONDS
            )

            assertTrue("Extraction should complete: ${extraction.error}", extraction.completed)
            assertNull("Extraction failed: ${extraction.error}", extraction.error)
            assertTrue("Extraction should succeed", extraction.success)
            extractedModelPath = targetDir.absolutePath
            println("Extraction successful")
        }
        println("Model extracted in ${extractTime}ms")
    }

    // sherpa-onnx v2.0 dropped espeak-ng: VITS speaks text only with a lexicon (or phonemeCodepoints).
    private suspend fun downloadLexicon() {
        val model = LightweightModelDownloader.TestModel.LEXICON_EN_US
        val lexicon = File("$extractedModelPath/vits-icefall-en_US-ljspeech-low", "lexicon-en-us.txt")
        if (lexicon.length() == model.sizeBytes) return
        LightweightModelDownloader.downloadModel(context, model).copyTo(lexicon, overwrite = true)
    }

    @Test
    fun testRealTtsInitialization() {
        assertNotNull("Model should be extracted", extractedModelPath)
        
        val latch = CountDownLatch(1)
        var initResult: ReadableMap? = null
        var error: String? = null
        
        val config = Arguments.createMap().apply {
            putString("modelDir", "$extractedModelPath/vits-icefall-en_US-ljspeech-low")
            putString("ttsModelType", "vits")
            putString("modelFile", "model.onnx")
            putString("tokensFile", "tokens.txt")
            putString("lexiconFile", "lexicon-en-us.txt")
            putInt("numThreads", 2)
            putBoolean("debug", true)
            putString("provider", "cpu")
        }
        
        val initTime = measureTimeMillis {
            sherpaOnnxImpl.initTts(config, createPromise(
                onResolve = { result ->
                    initResult = result as? ReadableMap
                    latch.countDown()
                },
                onReject = { _, message, _ ->
                    error = message
                    latch.countDown()
                }
            ))
            
            assertTrue("TTS init should complete", latch.await(10, TimeUnit.SECONDS))
        }
        
        println("TTS initialization took ${initTime}ms")
        
        assertNull("Should not have error: $error", error)
        assertNotNull("Should have init result", initResult)
        assertTrue("Init should be successful", initResult?.getBoolean("success") ?: false)
        
        val sampleRate = initResult?.getInt("sampleRate") ?: 0
        val numSpeakers = initResult?.getInt("numSpeakers") ?: 0
        
        println("TTS initialized with sampleRate=$sampleRate, numSpeakers=$numSpeakers")
        assertTrue("Sample rate should be positive", sampleRate > 0)
        assertTrue("Should have at least one speaker", numSpeakers > 0)
    }

    @Test
    fun testRealTtsGeneration() {
        // Initialize TTS first
        initializeTts()
        
        // Test cases with different text lengths
        val testCases = listOf(
            "short" to TEST_TEXT_SHORT,
            "medium" to TEST_TEXT_MEDIUM,
            "long" to TEST_TEXT_LONG
        )
        
        testCases.forEach { (name, text) ->
            println("\nTesting TTS generation for $name text")
            
            val latch = CountDownLatch(1)
            var generateResult: ReadableMap? = null
            var error: String? = null
            
            val config = Arguments.createMap().apply {
                putString("text", text)
                putInt("speakerId", 0)
                putDouble("speakingRate", 1.0)
                putBoolean("playAudio", false) // Don't play during tests
                putString("fileNamePrefix", "test_${name}_")
            }
            
            val generateTime = measureTimeMillis {
                sherpaOnnxImpl.generateTts(config, createPromise(
                    onResolve = { result ->
                        generateResult = result as? ReadableMap
                        latch.countDown()
                    },
                    onReject = { _, message, _ ->
                        error = message
                        latch.countDown()
                    }
                ))
                
                assertTrue("TTS generation should complete", latch.await(30, TimeUnit.SECONDS))
            }
            
            assertNull("Should not have error: $error", error)
            assertNotNull("Should have generation result", generateResult)
            assertTrue("Generation should be successful", generateResult?.getBoolean("success") ?: false)
            
            val filePath = generateResult?.getString("filePath")
            assertNotNull("Should have file path", filePath)
            
            val audioFile = File(filePath!!)
            assertTrue("Audio file should exist", audioFile.exists())
            assertTrue("Audio file should have content", audioFile.length() > 0)
            
            println("Generated audio for '$name' text:")
            println("  Time: ${generateTime}ms")
            println("  File: ${audioFile.absolutePath}")
            println("  Size: ${audioFile.length()} bytes")
            
            // Clean up generated file
            audioFile.delete()
        }
    }

    @Test
    fun testTtsWithDifferentSpeakers() {
        val numSpeakers = initializeTts()
        println("Testing with $numSpeakers speakers")
        
        // Test with different speaker IDs (test up to 3 speakers if available)
        val speakersToTest = minOf(numSpeakers, 3)
        
        for (speakerId in 0 until speakersToTest) {
            println("\nTesting speaker ID: $speakerId")
            
            val latch = CountDownLatch(1)
            var success = false
            var filePath: String? = null
            
            val config = Arguments.createMap().apply {
                putString("text", "Testing speaker $speakerId")
                putInt("speakerId", speakerId)
                putDouble("speakingRate", 1.0)
                putBoolean("playAudio", false)
                putString("fileNamePrefix", "test_speaker_${speakerId}_")
            }
            
            sherpaOnnxImpl.generateTts(config, createPromise(
                onResolve = { result ->
                    val map = result as? ReadableMap
                    success = map?.getBoolean("success") ?: false
                    filePath = map?.getString("filePath")
                    latch.countDown()
                },
                onReject = { _, _, _ ->
                    latch.countDown()
                }
            ))
            
            try {
                assertTrue("Generation should complete", latch.await(10, TimeUnit.SECONDS))
                assertTrue("Generation should succeed for speaker $speakerId", success)
                assertNotNull("Generation should return a file for speaker $speakerId", filePath)
                assertTrue(
                    "Speaker output should contain audio",
                    File(filePath!!).length() > WAV_HEADER_SIZE_BYTES
                )
            } finally {
                filePath?.let { File(it).delete() }
            }
        }
    }

    @Test
    fun testTtsWithDifferentSpeakingRates() {
        initializeTts()
        
        val speakingRates = listOf(0.5, 0.75, 1.0, 1.25, 1.5)
        
        speakingRates.forEach { rate ->
            println("\nTesting speaking rate: $rate")
            
            val latch = CountDownLatch(1)
            var generateResult: ReadableMap? = null
            var error: String? = null
            
            val config = Arguments.createMap().apply {
                putString("text", "Testing different speaking rates")
                putInt("speakerId", 0)
                putDouble("speakingRate", rate)
                putBoolean("playAudio", false)
                putString("fileNamePrefix", "test_rate_${rate}_")
            }
            
            val generateTime = measureTimeMillis {
                sherpaOnnxImpl.generateTts(config, createPromise(
                    onResolve = { result ->
                        generateResult = result as? ReadableMap
                        latch.countDown()
                    },
                    onReject = { code, message, _ ->
                        error = "$code: $message"
                        latch.countDown()
                    }
                ))
                assertTrue("Generation should complete for rate $rate", latch.await(10, TimeUnit.SECONDS))
            }

            val filePath = generateResult?.getString("filePath")
            try {
                assertNull("Generation failed for rate $rate: $error", error)
                assertTrue(
                    "Generation should succeed for rate $rate",
                    generateResult?.getBoolean("success") == true
                )
                assertNotNull("Generation should return a file for rate $rate", filePath)
                assertTrue(
                    "Speaking-rate output should contain audio",
                    File(filePath!!).length() > WAV_HEADER_SIZE_BYTES
                )
                println("  Generation time: ${generateTime}ms")
            } finally {
                filePath?.let { File(it).delete() }
            }
        }
    }

    @Test
    fun testTtsMemoryManagement() {
        // Test multiple init/release cycles
        repeat(5) { cycle ->
            println("\nMemory test cycle ${cycle + 1}")
            
            // Get memory before
            val memoryBefore = getMemoryUsage()
            println("Memory before: used=${memoryBefore.usedMB}MB, free=${memoryBefore.freeMB}MB")
            
            // Initialize TTS
            initializeTts()
            
            // Generate some audio
            generateAudio("Memory test cycle ${cycle + 1}")
            
            // Get memory after generation
            val memoryAfterGen = getMemoryUsage()
            println("Memory after generation: used=${memoryAfterGen.usedMB}MB, free=${memoryAfterGen.freeMB}MB")
            
            // Release TTS
            releaseTts()
            
            // Force garbage collection
            System.gc()
            Thread.sleep(500)
            
            // Get memory after release
            val memoryAfter = getMemoryUsage()
            println("Memory after release: used=${memoryAfter.usedMB}MB, free=${memoryAfter.freeMB}MB")
            
            // Memory increase should be reasonable
            val memoryIncrease = memoryAfter.usedMB - memoryBefore.usedMB
            println("Memory increase: ${memoryIncrease}MB")
            assertTrue("Memory increase should be less than 10MB", memoryIncrease < 10)
        }
    }

    @Test
    fun testTtsErrorHandling() {
        // Test 1: Generate without initialization
        println("\nTest 1: Generate without initialization")
        var latch = CountDownLatch(1)
        var result: ReadableMap? = null
        var errorCode: String? = null
        var errorMessage: String? = null
        
        val config = Arguments.createMap().apply {
            putString("text", "Test")
            putInt("speakerId", 0)
            putDouble("speakingRate", 1.0)
            putBoolean("playAudio", false)
        }
        
        sherpaOnnxImpl.generateTts(config, createPromise(
            onResolve = { value ->
                result = value as? ReadableMap
                latch.countDown()
            },
            onReject = { code, message, _ ->
                errorCode = code
                errorMessage = message
                latch.countDown()
            }
        ))
        
        assertTrue("Uninitialized generation should complete", latch.await(5, TimeUnit.SECONDS))
        assertNull("Uninitialized generation should not resolve", result)
        assertEquals(
            "Unexpected uninitialized TTS error: $errorMessage",
            "ERR_GENERATION_FAILED",
            errorCode
        )
        assertTrue(
            "Expected the uninitialized branch, got: $errorMessage",
            errorMessage?.contains("TTS not initialized") == true
        )
        
        // Test 2: Empty text
        println("\nTest 2: Empty text")
        latch = CountDownLatch(1)
        result = null
        errorCode = null
        errorMessage = null
        
        val invalidConfig = Arguments.createMap().apply {
            putString("text", "")
            putInt("speakerId", 0)
            putDouble("speakingRate", 1.0)
            putBoolean("playAudio", false)
        }
        
        sherpaOnnxImpl.generateTts(invalidConfig, createPromise(
            onResolve = { value ->
                result = value as? ReadableMap
                latch.countDown()
            },
            onReject = { code, message, _ ->
                errorCode = code
                errorMessage = message
                latch.countDown()
            }
        ))
        
        assertTrue("Empty-text generation should complete", latch.await(5, TimeUnit.SECONDS))
        assertNull("Empty-text generation should not resolve", result)
        assertEquals(
            "Unexpected empty-text TTS error: $errorMessage",
            "ERR_INVALID_TEXT",
            errorCode
        )
        assertTrue(
            "Expected the empty-text branch, got: $errorMessage",
            errorMessage?.contains("Text cannot be empty") == true
        )

        // Test 3: The native VITS boundary falls back to speaker 0 when the model
        // has one speaker and the requested ID is out of range. This assertion is
        // intentionally fixture-specific because multi-speaker fallback may differ.
        val numSpeakers = initializeTts()
        assertEquals("Fallback test requires the single-speaker LJSpeech fixture", 1, numSpeakers)
        println("\nTest 3: Invalid speaker ID falls back to speaker 0")
        latch = CountDownLatch(1)
        result = null
        errorCode = null
        errorMessage = null

        val invalidSpeakerConfig = Arguments.createMap().apply {
            putString("text", "Speaker fallback test")
            putInt("speakerId", 999)
            putDouble("speakingRate", 1.0)
            putBoolean("playAudio", false)
            putString("fileNamePrefix", "test_invalid_speaker")
        }

        sherpaOnnxImpl.generateTts(invalidSpeakerConfig, createPromise(
            onResolve = { value ->
                result = value as? ReadableMap
                latch.countDown()
            },
            onReject = { code, message, _ ->
                errorCode = code
                errorMessage = message
                latch.countDown()
            }
        ))

        assertTrue("Invalid-speaker generation should complete", latch.await(10, TimeUnit.SECONDS))
        val fallbackPath = result?.getString("filePath")
        try {
            assertNull("Invalid-speaker generation should use the model fallback: $errorMessage", errorCode)
            assertTrue("Invalid-speaker generation should succeed", result?.getBoolean("success") == true)
            assertNotNull("Invalid-speaker generation should return a file path", fallbackPath)
            assertTrue(
                "Invalid-speaker generation should create audio",
                File(fallbackPath!!).length() > WAV_HEADER_SIZE_BYTES
            )
        } finally {
            fallbackPath?.let { File(it).delete() }
        }
    }

    // Helper functions
    
    private fun initializeTts(): Int {
        val latch = CountDownLatch(1)
        var success = false
        var numSpeakers = 0
        var error: String? = null
        
        val config = Arguments.createMap().apply {
            putString("modelDir", "$extractedModelPath/vits-icefall-en_US-ljspeech-low")
            putString("ttsModelType", "vits")
            putString("modelFile", "model.onnx")
            putString("tokensFile", "tokens.txt")
            putString("lexiconFile", "lexicon-en-us.txt")
            putInt("numThreads", 2)
            putBoolean("debug", false)
            putString("provider", "cpu")
        }
        
        sherpaOnnxImpl.initTts(config, createPromise(
            onResolve = { result ->
                val map = result as? ReadableMap
                success = map?.getBoolean("success") ?: false
                numSpeakers = map?.getInt("numSpeakers") ?: 0
                latch.countDown()
            },
            onReject = { code, message, _ ->
                error = "$code: $message"
                latch.countDown()
            }
        ))
        
        assertTrue("TTS init should complete", latch.await(10, TimeUnit.SECONDS))
        assertNull("TTS init failed: $error", error)
        assertTrue("TTS init should succeed", success)
        return numSpeakers
    }
    
    private fun generateAudio(text: String): Boolean {
        val latch = CountDownLatch(1)
        var success = false
        
        val config = Arguments.createMap().apply {
            putString("text", text)
            putInt("speakerId", 0)
            putDouble("speakingRate", 1.0)
            putBoolean("playAudio", false)
            putString("fileNamePrefix", "test_")
        }
        
        sherpaOnnxImpl.generateTts(config, createPromise(
            onResolve = { result ->
                val map = result as? ReadableMap
                success = map?.getBoolean("success") ?: false
                
                // Clean up generated file
                map?.getString("filePath")?.let { path ->
                    File(path).delete()
                }
                
                latch.countDown()
            },
            onReject = { _, _, _ ->
                latch.countDown()
            }
        ))
        
        latch.await(10, TimeUnit.SECONDS)
        return success
    }
    
    private fun releaseTts() {
        val latch = CountDownLatch(1)
        
        sherpaOnnxImpl.releaseTts(createPromise(
            onResolve = { _ ->
                latch.countDown()
            },
            onReject = { _, _, _ ->
                latch.countDown()
            }
        ))
        
        latch.await(5, TimeUnit.SECONDS)
    }
    
    private fun getMemoryUsage(): MemoryInfo {
        val runtime = Runtime.getRuntime()
        val usedMB = (runtime.totalMemory() - runtime.freeMemory()) / 1024 / 1024
        val freeMB = runtime.freeMemory() / 1024 / 1024
        val totalMB = runtime.totalMemory() / 1024 / 1024
        val maxMB = runtime.maxMemory() / 1024 / 1024
        
        return MemoryInfo(usedMB, freeMB, totalMB, maxMB)
    }
    
    data class MemoryInfo(
        val usedMB: Long,
        val freeMB: Long,
        val totalMB: Long,
        val maxMB: Long
    )
}
