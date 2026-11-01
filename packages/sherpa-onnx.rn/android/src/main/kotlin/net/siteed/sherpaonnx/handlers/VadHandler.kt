package net.siteed.sherpaonnx.handlers

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import net.siteed.sherpaonnx.SherpaOnnxImpl
import net.siteed.sherpaonnx.utils.AssetUtils
import java.io.File
import java.util.concurrent.Executors

class VadHandler(private val reactContext: ReactApplicationContext) {

    private val executor = Executors.newSingleThreadExecutor()
    private var vad: Vad? = null
    private var sampleRate: Int = 16000

    companion object {
        private const val TAG = "SherpaOnnxVAD"
    }

    fun init(modelConfig: ReadableMap, promise: Promise) {
        if (!SherpaOnnxImpl.isLibraryLoaded) {
            promise.reject("ERR_LIBRARY_NOT_LOADED", "Sherpa ONNX library is not loaded")
            return
        }

        executor.execute {
            try {
                Log.i(TAG, "===== VAD INITIALIZATION START =====")

                val modelDir = AssetUtils.cleanFilePath(modelConfig.getString("modelDir") ?: "")
                val modelFile = modelConfig.getString("modelFile") ?: "silero_vad_v5.onnx"
                val threshold = if (modelConfig.hasKey("threshold")) modelConfig.getDouble("threshold").toFloat() else 0.5f
                val minSilenceDuration = if (modelConfig.hasKey("minSilenceDuration")) modelConfig.getDouble("minSilenceDuration").toFloat() else 0.25f
                val minSpeechDuration = if (modelConfig.hasKey("minSpeechDuration")) modelConfig.getDouble("minSpeechDuration").toFloat() else 0.25f
                val windowSize = if (modelConfig.hasKey("windowSize")) modelConfig.getInt("windowSize") else 512
                val maxSpeechDuration = if (modelConfig.hasKey("maxSpeechDuration")) modelConfig.getDouble("maxSpeechDuration").toFloat() else 5.0f
                val numThreads = if (modelConfig.hasKey("numThreads")) modelConfig.getInt("numThreads") else 1
                val debug = if (modelConfig.hasKey("debug")) modelConfig.getBoolean("debug") else false
                val provider = modelConfig.getString("provider") ?: "cpu"

                val modelPath = File(modelDir, modelFile).absolutePath
                if (!File(modelPath).exists()) {
                    throw Exception("VAD model file not found: $modelPath")
                }

                Log.i(TAG, "Model: $modelPath (exists: true)")
                Log.i(TAG, "threshold=$threshold, minSilence=$minSilenceDuration, minSpeech=$minSpeechDuration")
                Log.i(TAG, "windowSize=$windowSize, maxSpeech=$maxSpeechDuration")

                // Release previous
                releaseResources()

                sampleRate = 16000

                val sileroConfig = SileroVadModelConfig(
                    model = modelPath,
                    threshold = threshold,
                    minSilenceDuration = minSilenceDuration,
                    minSpeechDuration = minSpeechDuration,
                    windowSize = windowSize,
                    maxSpeechDuration = maxSpeechDuration,
                )

                val vadConfig = VadModelConfig(
                    sileroVadModelConfig = sileroConfig,
                    sampleRate = sampleRate,
                    numThreads = numThreads,
                    provider = provider,
                    debug = debug,
                )

                vad = Vad(null, vadConfig)

                if (vad == null) {
                    throw Exception("Failed to create VAD instance")
                }

                Log.i(TAG, "===== VAD INITIALIZATION COMPLETE =====")

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error initializing VAD: ${e.message}")
                e.printStackTrace()
                releaseResources()

                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_VAD_INIT", "Failed to initialize VAD: ${e.message}")
                }
            }
        }
    }

    fun acceptWaveform(sampleRate: Int, audioBuffer: ReadableArray, promise: Promise) {
        executor.execute {
            try {
                if (vad == null) {
                    throw Exception("VAD is not initialized")
                }

                // Convert ReadableArray to FloatArray
                val samples = FloatArray(audioBuffer.size())
                for (i in 0 until audioBuffer.size()) {
                    samples[i] = audioBuffer.getDouble(i).toFloat()
                }

                // Feed samples to VAD
                vad!!.acceptWaveform(samples)

                // Check if speech is detected right now
                val isSpeechDetected = vad!!.isSpeechDetected()

                // Collect completed speech segments
                val segmentsArray = Arguments.createArray()
                while (!vad!!.empty()) {
                    val segment = vad!!.front()
                    val segmentMap = Arguments.createMap()
                    // 64-bit sample index since sherpa-onnx v2.0; a JS number holds it exactly.
                    segmentMap.putDouble("start", segment.start.toDouble())
                    segmentMap.putInt("duration", segment.samples.size)
                    segmentMap.putDouble("startTime", segment.start.toDouble() / this.sampleRate)
                    segmentMap.putDouble("endTime", (segment.start + segment.samples.size).toDouble() / this.sampleRate)
                    segmentsArray.pushMap(segmentMap)
                    vad!!.pop()
                }

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)
                resultMap.putBoolean("isSpeechDetected", isSpeechDetected)
                resultMap.putArray("segments", segmentsArray)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error accepting waveform: ${e.message}")
                e.printStackTrace()
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_VAD_ACCEPT", "Failed to accept waveform: ${e.message}")
                }
            }
        }
    }

    fun reset(promise: Promise) {
        executor.execute {
            try {
                if (vad == null) {
                    throw Exception("VAD is not initialized")
                }
                vad!!.reset()

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("success", true)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error resetting VAD: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_VAD_RESET", "Failed to reset VAD: ${e.message}")
                }
            }
        }
    }

    fun release(promise: Promise) {
        executor.execute {
            try {
                releaseResources()

                val resultMap = Arguments.createMap()
                resultMap.putBoolean("released", true)

                reactContext.runOnUiQueueThread {
                    promise.resolve(resultMap)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error releasing VAD: ${e.message}")
                reactContext.runOnUiQueueThread {
                    promise.reject("ERR_VAD_RELEASE", "Failed to release VAD: ${e.message}")
                }
            }
        }
    }

    private fun releaseResources() {
        try {
            vad?.release()
            vad = null
            Log.i(TAG, "VAD resources released")
        } catch (e: Exception) {
            Log.e(TAG, "Error in releaseResources: ${e.message}")
        }
    }
}
