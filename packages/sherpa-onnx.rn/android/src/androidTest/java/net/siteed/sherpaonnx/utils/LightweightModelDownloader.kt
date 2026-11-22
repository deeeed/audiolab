package net.siteed.sherpaonnx.utils

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min

/**
 * Lightweight model downloader for integration tests
 * Downloads and caches small models suitable for CI/CD testing
 */
object LightweightModelDownloader {
    private const val TAG = "ModelDownloader"
    private const val CONNECT_TIMEOUT = 30000 // 30 seconds
    private const val READ_TIMEOUT = 60000 // 60 seconds
    private const val MAX_RETRIES = 3
    private const val RETRY_DELAY = 2000L // 2 seconds
    
    /**
     * Lightweight models suitable for testing
     */
    enum class TestModel(
        val modelName: String,
        val url: String,
        val sizeBytes: Long,
        val sha256: String?,
        val description: String
    ) {
        // TTS Model. The archive name is the en_US one: the previous
        // `vits-icefall-en-low.tar.bz2` returns 404, so every test that downloaded it
        // failed during setup (#458). Verified HTTP 200.
        VITS_EN_LOW(
            modelName = "vits-icefall-en-low",
            url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-en_US-ljspeech-low.tar.bz2",
            sizeBytes = 31_722_454L, // measured via content-length; re-uploaded upstream 2026-10-29
            sha256 = null, // Add SHA256 for integrity check
            description = "Lightweight English TTS model for testing"
        ),

        // English lexicon for VITS: sherpa-onnx v2.0 dropped espeak-ng, so text needs a lexicon
        LEXICON_EN_US(
            modelName = "lexicon-en-us",
            url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/lexicon-en-us.txt",
            sizeBytes = 6_305_773L, // measured via content-length
            sha256 = "8b67ae549a465eee78f92ecb74644ad90c3c58ce65f19c68baf85878a10ef73a",
            description = "English lexicon for the VITS TTS model"
        ),
        
        // VAD Model - ~0.6MB
        SILERO_VAD(
            modelName = "silero-vad",
            url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
            sizeBytes = 643_854L, // measured via content-length
            sha256 = null,
            description = "Voice Activity Detection model"
        ),
        
        // Audio Tagging Model - 27.2MB
        CED_TINY(
            modelName = "ced-tiny",
            url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-tiny-audio-tagging-2024-04-19.tar.bz2",
            sizeBytes = 28_531_989L, // measured via content-length
            sha256 = null,
            description = "Tiny audio tagging model for event detection"
        ),
        
        // ASR model, ~112MB: whisper-tiny.en ships fp32 and int8 variants in one archive
        WHISPER_TINY(
            modelName = "whisper-tiny",
            url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2",
            sizeBytes = 118_071_777L, // measured via content-length
            sha256 = null,
            description = "Tiny Whisper model for speech recognition"
        );
        
        fun getCacheDir(context: Context): File {
            return File(context.cacheDir, "test-models/$modelName")
        }
        
        fun getModelFile(context: Context): File {
            val extension = if (url.endsWith(".onnx")) "onnx" else if (url.endsWith(".txt")) "txt" else "tar.bz2"
            return File(getCacheDir(context), "$modelName.$extension")
        }
    }
    
    /**
     * Download progress listener
     */
    interface DownloadProgressListener {
        fun onProgress(bytesDownloaded: Long, totalBytes: Long, percentComplete: Int)
        fun onComplete(modelFile: File)
        fun onError(error: Exception)
    }
    
    /**
     * Download a lightweight model with progress tracking
     */
    suspend fun downloadModel(
        context: Context,
        model: TestModel,
        progressListener: DownloadProgressListener? = null
    ): File = withContext(Dispatchers.IO) {
        val modelFile = model.getModelFile(context)
        
        // Check if already cached
        if (modelFile.exists() && modelFile.length() == model.sizeBytes) {
            Log.i(TAG, "Model ${model.modelName} already cached at ${modelFile.absolutePath}")
            progressListener?.onComplete(modelFile)
            return@withContext modelFile
        }
        
        // Create cache directory
        model.getCacheDir(context).mkdirs()
        
        // Download with retries
        var lastException: Exception? = null
        repeat(MAX_RETRIES) { attempt ->
            try {
                Log.i(TAG, "Downloading ${model.modelName} (attempt ${attempt + 1}/$MAX_RETRIES)")
                downloadFile(model.url, modelFile, model.sizeBytes, progressListener)
                
                // Verify file size
                if (modelFile.length() != model.sizeBytes) {
                    throw IOException("Downloaded file size mismatch. Expected: ${model.sizeBytes}, Got: ${modelFile.length()}")
                }
                
                // Verify checksum if available
                model.sha256?.let { expectedHash ->
                    val actualHash = calculateSHA256(modelFile)
                    if (actualHash != expectedHash) {
                        throw IOException("Checksum verification failed")
                    }
                }
                
                Log.i(TAG, "Successfully downloaded ${model.modelName}")
                progressListener?.onComplete(modelFile)
                return@withContext modelFile
                
            } catch (e: Exception) {
                lastException = e
                Log.e(TAG, "Download attempt ${attempt + 1} failed: ${e.message}")
                
                // Clean up partial download
                if (modelFile.exists()) {
                    modelFile.delete()
                }
                
                if (attempt < MAX_RETRIES - 1) {
                    delay(RETRY_DELAY * (attempt + 1)) // Exponential backoff
                }
            }
        }
        
        // All retries failed
        val error = lastException ?: IOException("Download failed after $MAX_RETRIES attempts")
        progressListener?.onError(error)
        throw error
    }
    
    /**
     * Download multiple models concurrently
     */
    suspend fun downloadModels(
        context: Context,
        models: List<TestModel>,
        progressListener: DownloadProgressListener? = null
    ): Map<TestModel, File> = withContext(Dispatchers.IO) {
        val results = mutableMapOf<TestModel, File>()
        
        // Download models concurrently
        val jobs = models.map { model ->
            async {
                try {
                    val file = downloadModel(context, model, progressListener)
                    model to file
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to download ${model.modelName}: ${e.message}")
                    null
                }
            }
        }
        
        // Collect results
        jobs.mapNotNull { it.await() }.forEach { (model, file) ->
            results[model] = file
        }
        
        return@withContext results
    }
    
    /**
     * Clean up cached models
     */
    fun cleanupModels(context: Context, models: List<TestModel>? = null) {
        val modelsToClean = models ?: TestModel.values().toList()
        
        modelsToClean.forEach { model ->
            val cacheDir = model.getCacheDir(context)
            if (cacheDir.exists()) {
                cacheDir.deleteRecursively()
                Log.i(TAG, "Cleaned up ${model.modelName}")
            }
        }
    }
    
    /**
     * Get total size of models to download
     */
    fun getTotalDownloadSize(models: List<TestModel>): Long {
        return models.sumOf { it.sizeBytes }
    }
    
    /**
     * Check if models are already cached
     */
    fun areModelsCached(context: Context, models: List<TestModel>): Boolean {
        return models.all { model ->
            val file = model.getModelFile(context)
            file.exists() && file.length() == model.sizeBytes
        }
    }
    
    // Private helper functions
    
    private suspend fun downloadFile(
        urlString: String,
        outputFile: File,
        expectedSize: Long,
        progressListener: DownloadProgressListener?
    ) = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        var input: InputStream? = null
        var output: FileOutputStream? = null
        
        try {
            val url = URL(urlString)
            connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = CONNECT_TIMEOUT
            connection.readTimeout = READ_TIMEOUT
            connection.connect()
            
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("HTTP error code: ${connection.responseCode}")
            }
            
            val fileLength = connection.contentLength
            if (fileLength > 0 && fileLength.toLong() != expectedSize) {
                Log.w(TAG, "Content length mismatch. Expected: $expectedSize, Server reports: $fileLength")
            }
            
            input = BufferedInputStream(connection.inputStream)
            output = FileOutputStream(outputFile)
            
            val buffer = ByteArray(8192)
            var total = 0L
            var count: Int
            var lastProgress = 0
            
            while (input.read(buffer).also { count = it } != -1) {
                if (!isActive) {
                    throw CancellationException("Download cancelled")
                }
                
                total += count
                output.write(buffer, 0, count)
                
                // Report progress
                val progress = ((total * 100) / expectedSize).toInt()
                if (progress != lastProgress) {
                    lastProgress = progress
                    progressListener?.onProgress(total, expectedSize, progress)
                }
            }
            
            output.flush()
            
        } finally {
            output?.close()
            input?.close()
            connection?.disconnect()
        }
    }
    
    private fun calculateSHA256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        var count: Int
        
        FileInputStream(file).use { input ->
            while (input.read(buffer).also { count = it } != -1) {
                digest.update(buffer, 0, count)
            }
        }
        
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}