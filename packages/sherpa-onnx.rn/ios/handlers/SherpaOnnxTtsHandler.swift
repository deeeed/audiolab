import Foundation
import AVFoundation
import CSherpaOnnx

// NOTE: toCPointer() is provided by the upstream SherpaOnnx.swift wrapper.

/**
 * SherpaOnnxTtsHandler - Text-to-Speech Handler
 * 
 * Manages Text-to-Speech functionality using Sherpa-ONNX C API.
 * Supports different model types: VITS, Kokoro, Matcha.
 * 
 * This handler mirrors the TtsHandler.kt implementation for Android
 * to ensure feature parity across platforms.
 */
@objc public class SherpaOnnxTtsHandler: NSObject {
    private var tts: OpaquePointer?
    private var isInitialized: Bool = false
    private var sampleRate: Int = 16000
    private var audioPlayer: AVAudioPlayer?
    private var isGenerating: Bool = false
    
    @objc public override init() {
        super.init()
    }
    
    deinit {
        cleanupTtsResources()
    }
    
    /**
     * Initialize TTS with configuration
     * 
     * @param config Dictionary containing TTS configuration
     * @return Dictionary with initialization result
     */
    @objc public func initTts(_ config: NSDictionary) -> NSDictionary {
        NSLog("[SherpaOnnxTtsHandler.swift] initTts entered with config: %@", config)

        if tts != nil {
            cleanupTtsResources()
        }

        NSLog("===== TTS INITIALIZATION START =====")
        NSLog("Initializing TTS with config: %@", config)

        do {
            // --- Extract configuration parameters --- 
            guard let modelDirRaw = config["modelDir"] as? String, !modelDirRaw.isEmpty else {
                throw NSError(domain: "SherpaOnnx", code: 101, userInfo: [NSLocalizedDescriptionKey: "Missing or empty modelDir parameter"])
            }
            let modelDir = modelDirRaw // file:// stripping handled in JS layer (cleanFilePath)
            
            let modelType = config["ttsModelType"] as? String ?? "vits"
            let modelFile = config["modelFile"] as? String // Read 'modelFile'
            let tokensFile = config["tokensFile"] as? String ?? "tokens.txt" // Read 'tokensFile' or default
            let voicesFile = config["voicesFile"] as? String
            let lexiconFile = config["lexiconFile"] as? String
            let vocoderFile = config["vocoderFile"] as? String
            let dataDirInput = config["dataDir"] as? String
            let numThreads = config["numThreads"] as? Int ?? 1
            let debug = config["debug"] as? Bool ?? false
            let provider = "cpu"
        // NSNumber bridging fix (Swift SE-0170): the RN bridge boxes JS numbers
        // as double-backed NSNumbers, and `as? Float` on those returns nil unless
        // the value is exactly Float32-representable — so non-dyadic config like
        // 0.005 silently fell back to the default. `.floatValue` converts explicitly.
            let noiseScale = (config["noiseScale"] as? NSNumber)?.floatValue ?? 0.667
            let noiseScaleW = (config["noiseScaleW"] as? NSNumber)?.floatValue ?? 0.8
            let lengthScale = (config["lengthScale"] as? NSNumber)?.floatValue ?? 1.0
            
            // --- Log Extracted Config --- 
            NSLog("TTS Init - Model dir (cleaned): \(modelDir)")
            // Removed extractedFiles logging
            NSLog("TTS Init - Model type: \(modelType)")
            NSLog("TTS Init - Model file (relative, from JS): \(modelFile ?? "nil")")
            NSLog("TTS Init - Tokens file (relative, from JS): \(tokensFile)")
            NSLog("TTS Init - Voices file (relative): \(voicesFile ?? "nil")")
            NSLog("TTS Init - Lexicon file (relative): \(lexiconFile ?? "nil")")
            NSLog("TTS Init - Vocoder file (relative): \(vocoderFile ?? "nil")")
            // Log the input dataDir value
            NSLog("TTS Init - Data dir (input): \(dataDirInput ?? "nil")")
            NSLog("TTS Init - Num threads: \(numThreads)")
            NSLog("TTS Init - Debug: \(debug)")

            // --- Determine Asset Base Path (Simplified -> Adjusted) ---
            // Start assuming files are directly in modelDir
            var assetBasePath = modelDir
            NSLog("Initial Asset Base Path: \(assetBasePath)")

            // --- Construct INITIAL Absolute Path for Model Check ---
            guard let modelFileName = modelFile, !modelFileName.isEmpty else { // Use modelFileName to avoid conflict
                throw NSError(domain: "SherpaOnnx", code: 102, userInfo: [NSLocalizedDescriptionKey: "Missing or empty model file name (checked after reading 'modelName')"])
            }
            let initialModelCheckPath = "\(assetBasePath)/\(modelFileName)"
            NSLog("Initial check for model at: \(initialModelCheckPath)")

            // --- Check if model exists directly, if not, look in subdirectory ---
            if !FileManager.default.fileExists(atPath: initialModelCheckPath) {
                NSLog("Model not found directly in modelDir. Checking for single subdirectory...")
                do {
                    // ---> Add explicit check for the base directory itself <---
                    var isDir: ObjCBool = false
                    if !FileManager.default.fileExists(atPath: assetBasePath, isDirectory: &isDir) {
                        NSLog("Error: The base directory '\(assetBasePath)' itself does not exist before attempting to list contents.")
                        throw NSError(domain: "SherpaOnnx", code: 105, userInfo: [NSLocalizedDescriptionKey: "Base model directory path does not exist: \(assetBasePath)"])
                    }
                    if !isDir.boolValue {
                         NSLog("Error: The base path '\(assetBasePath)' exists but is not a directory.")
                         throw NSError(domain: "SherpaOnnx", code: 106, userInfo: [NSLocalizedDescriptionKey: "Base model path is not a directory: \(assetBasePath)"])
                    }
                    // ---> End explicit check <---

                    let contents = try FileManager.default.contentsOfDirectory(atPath: assetBasePath)
                    let subdirectories = contents.filter { item -> Bool in
                        var itemIsDir: ObjCBool = false // Use a different variable name
                        let fullPath = "\(assetBasePath)/\(item)"
                        // Check if it exists AND is a directory
                        return FileManager.default.fileExists(atPath: fullPath, isDirectory: &itemIsDir) && itemIsDir.boolValue
                    }

                    if subdirectories.count == 1 {
                        assetBasePath = "\(assetBasePath)/\(subdirectories[0])" // Update base path to the subdirectory
                        NSLog("Found single subdirectory, updated Asset Base Path to: \(assetBasePath)")
                    } else {
                         NSLog("Did not find exactly one subdirectory (found \(subdirectories.count)). Contents: \(contents.joined(separator: ", "))")
                        // Stick with the original assetBasePath, let the later file checks fail if necessary.
                    }
                } catch {
                    NSLog("Error checking subdirectory contents: \(error.localizedDescription)")
                    // Proceed with original assetBasePath, let the later checks fail if necessary.
                    // Log the error but don't re-throw immediately if the goal is to let the later file check fail
                }
            } else {
                 NSLog("Model found directly in initial path.")
            }
            // --- End Path Adjustment Logic ---

            // --- Construct FINAL Absolute Paths (using the potentially updated assetBasePath) ---
            let modelAbsPath = "\(assetBasePath)/\(modelFileName)" // Join base path and relative model file path
            let tokensAbsPath = "\(assetBasePath)/\(tokensFile)"     // Join base path and relative tokens file path
            // Kokoro takes a comma-separated lexicon list; join each entry with the base path.
            let lexiconAbsPath = lexiconFile?.split(separator: ",").map { "\(assetBasePath)/\($0.trimmingCharacters(in: .whitespaces))" }.joined(separator: ",") ?? ""
            let voicesAbsPath = voicesFile != nil ? "\(assetBasePath)/\(voicesFile!)" : ""
            // Adjusted acousticModel/vocoder path logic for Matcha:
            // - Use modelFile for acoustic model path
            // - For vocoder, use vocoderFile if available
            let acousticModelAbsPath = "\(assetBasePath)/\(modelFile ?? "")"
            let vocoderAbsPath = vocoderFile != nil ? "\(assetBasePath)/\(vocoderFile!)" : voicesAbsPath

            // --- Handle dataDir (joining with the final assetBasePath if relative) ---
            let dataDirAbsPath: String
            if let dataDir = dataDirInput, !dataDir.isEmpty {
                if dataDir.hasPrefix("/") {
                    dataDirAbsPath = dataDir
                    NSLog("TTS Init - Treating dataDir as absolute: \(dataDirAbsPath)")
                } else {
                    dataDirAbsPath = "\(assetBasePath)/\(dataDir)" // Join relative path with final assetBasePath
                    NSLog("TTS Init - Treating dataDir as relative, joined path: \(dataDirAbsPath)")
                }
            } else {
                dataDirAbsPath = ""
                NSLog("TTS Init - No dataDir provided or empty.")
            }
            
            // --- Log Constructed Paths --- 
            NSLog("TTS Init - Using Model path: \(modelAbsPath)")
            NSLog("TTS Init - Using Tokens path: \(tokensAbsPath)")
            NSLog("TTS Init - Using Lexicon path: \(lexiconAbsPath)")
            NSLog("TTS Init - Using Voices path: \(voicesAbsPath)")
            NSLog("TTS Init - Using Vocoder path: \(vocoderAbsPath)")
            NSLog("TTS Init - Using Data dir path: \(dataDirAbsPath)") 
            
            // --- Perform File Existence Checks (using simplified paths) --- 
            NSLog("Checking existence of Model file at: \(modelAbsPath)")
            if !FileManager.default.fileExists(atPath: modelAbsPath) {
                logDirectoryContents(path: assetBasePath) // Log parent dir if file not found
                throw NSError(domain: "SherpaOnnx", code: 103, userInfo: [NSLocalizedDescriptionKey: "Model file ('\(modelFileName)') not found at final path: \(modelAbsPath)"])
            }
            NSLog("Checking existence of Tokens file at: \(tokensAbsPath)")
            if !FileManager.default.fileExists(atPath: tokensAbsPath) {
                logDirectoryContents(path: assetBasePath) // Log parent dir if file not found
                throw NSError(domain: "SherpaOnnx", code: 104, userInfo: [NSLocalizedDescriptionKey: "Tokens file ('\(tokensFile)') not found at final path: \(tokensAbsPath)"])
            }
            // Optional file checks (log warning if missing)
            for lexiconPath in lexiconAbsPath.split(separator: ",").map(String.init) where !FileManager.default.fileExists(atPath: lexiconPath) {
                NSLog("Warning: Optional lexicon file not found at: \(lexiconPath)")
            }
            if !voicesAbsPath.isEmpty && !FileManager.default.fileExists(atPath: voicesAbsPath) {
                NSLog("Warning: Optional voices/vocoder file not found at: \(voicesAbsPath)")
            }
            if !dataDirAbsPath.isEmpty {
                NSLog("Checking existence of Data directory at: \(dataDirAbsPath)")
                var isDir : ObjCBool = false
                if !FileManager.default.fileExists(atPath: dataDirAbsPath, isDirectory: &isDir) || !isDir.boolValue {
                    NSLog("Warning: Optional data directory not found or not a directory at: \(dataDirAbsPath)")
                }
            }
            
            // --- Create model configuration based on type (Pass simplified *AbsPath variables) --- 
            var cModelConfig: SherpaOnnxOfflineTtsModelConfig

            if modelType == "vits" {
                NSLog("Configuring VITS model")
                let vitsConfig = sherpaOnnxOfflineTtsVitsModelConfig(
                    model: modelAbsPath,
                    lexicon: lexiconAbsPath,
                    tokens: tokensAbsPath,
                    dataDir: dataDirAbsPath,
                    noiseScale: noiseScale, 
                    noiseScaleW: noiseScaleW,
                    lengthScale: lengthScale
                )
                cModelConfig = sherpaOnnxOfflineTtsModelConfig(
                    vits: vitsConfig,
                    numThreads: numThreads,
                    debug: debug ? 1 : 0,
                    provider: provider
                )
            } else if modelType == "kokoro" {
                 NSLog("Configuring Kokoro model")
                 let kokoroConfig = sherpaOnnxOfflineTtsKokoroModelConfig(
                    model: modelAbsPath,
                    voices: voicesAbsPath, 
                    tokens: tokensAbsPath,
                    dataDir: dataDirAbsPath,
                    lengthScale: lengthScale,
                    lexicon: lexiconAbsPath // Pass lexicon if available
                 )
                 cModelConfig = sherpaOnnxOfflineTtsModelConfig(
                    kokoro: kokoroConfig,
                    numThreads: numThreads,
                    debug: debug ? 1 : 0,
                    provider: provider
                 )
            } else if modelType == "matcha" {
                NSLog("Configuring Matcha model")
                // Note: Matcha C API uses acoustic_model and vocoder fields
                let matchaConfig = sherpaOnnxOfflineTtsMatchaModelConfig(
                    acousticModel: acousticModelAbsPath, // Use the specific acoustic model path
                    vocoder: vocoderAbsPath,          // Use the specific vocoder path
                    lexicon: lexiconAbsPath,
                    tokens: tokensAbsPath,
                    dataDir: dataDirAbsPath,
                    noiseScale: noiseScale, // Pass scales if applicable
                    lengthScale: lengthScale
                )
                 cModelConfig = sherpaOnnxOfflineTtsModelConfig(
                    matcha: matchaConfig,
                    numThreads: numThreads,
                    debug: debug ? 1 : 0,
                    provider: provider
                 )
            } else {
                throw NSError(domain: "SherpaOnnx", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported model type: \(modelType)"])
            }

            // Create the final TTS config for the C API
            var cTtsConfig = sherpaOnnxOfflineTtsConfig(model: cModelConfig)

            // Log and Create TTS instance
            NSLog("Final C TTS Config - numThreads: \(numThreads), debug: \(debug)")
            NSLog("--> Calling SherpaOnnxCreateOfflineTts...")
            tts = SherpaOnnxCreateOfflineTts(&cTtsConfig)
            NSLog("<-- SherpaOnnxCreateOfflineTts returned. Pointer: \(String(describing: tts))")

            if tts == nil {
                throw NSError(domain: "SherpaOnnx", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to initialize TTS engine (SherpaOnnxCreateOfflineTts returned nil)"])
            }

            NSLog("--> Calling SherpaOnnxOfflineTtsSampleRate...")
            sampleRate = Int(SherpaOnnxOfflineTtsSampleRate(tts))
            NSLog("<-- SherpaOnnxOfflineTtsSampleRate returned: \(sampleRate)")
            isInitialized = true

            let numSpeakers = Int(SherpaOnnxOfflineTtsNumSpeakers(tts))
            NSLog("TTS initialized successfully! Sample rate: \(sampleRate), numSpeakers: \(numSpeakers)")
            NSLog("===== TTS INITIALIZATION COMPLETE =====")

            return [
                "success": true,
                "sampleRate": sampleRate,
                "numSpeakers": numSpeakers,
                "error": NSNull()
            ]
        } catch {
            NSLog("TTS initialization failed: \(error.localizedDescription)")
             NSLog("===== TTS INITIALIZATION FAILED =====")
            // Ensure cleanup happens on failure
            cleanupTtsResources()
            return [
                "success": false,
                "error": error.localizedDescription
            ]
        }
    }
    
    /**
     * Generate speech from text
     * 
     * @param config Dictionary containing generation parameters
     * @return Dictionary with generation result
     */
    @objc public func generateTts(_ config: NSDictionary) -> NSDictionary {
        if tts == nil || !isInitialized {
            return [
                "success": false,
                "error": "TTS not initialized"
            ]
        }
        
        if isGenerating {
            return [
                "success": false,
                "error": "TTS is already generating speech"
            ]
        }
        
        do {
            isGenerating = true
            
            // Extract parameters
            let text = config["text"] as? String ?? ""
            let speakerId = config["speakerId"] as? Int ?? 0
            let speakingRate = Float(config["speakingRate"] as? Double ?? 1.0)
            let playAudio = config["playAudio"] as? Bool ?? true
            let fileNamePrefix = config["fileNamePrefix"] as? String
            // Pre-phonemized input (sherpa-onnx v2.0+); when present it replaces `text`.
            let phonemeCodepoints = (config["phonemeCodepoints"] as? [[NSNumber]])?.map { $0.map { $0.int32Value } } ?? []
            
            // Apply custom parameters if provided
            if config["lengthScale"] as? NSNumber != nil { // Use _ to ignore the value
                // Note: Unlike Android, we don't have direct access to modify these parameters 
                // on existing TTS instance. Instead, we'd need to recreate the instance.
                NSLog("lengthScale parameter provided but cannot be applied to existing instance in iOS")
            }
            
            if config["noiseScale"] as? NSNumber != nil { // Use _ to ignore the value
                NSLog("noiseScale parameter provided but cannot be applied to existing instance in iOS")
            }
            
            if config["noiseScaleW"] as? NSNumber != nil { // Use _ to ignore the value
                NSLog("noiseScaleW parameter provided but cannot be applied to existing instance in iOS")
            }
            
            if text.isEmpty && phonemeCodepoints.isEmpty {
                throw NSError(domain: "SherpaOnnx", code: 3, userInfo: [NSLocalizedDescriptionKey: "Text cannot be empty"])
            }
            
            NSLog("Generating TTS for text: '\(text)' with speakerId: \(speakerId), speed: \(speakingRate)")
            
            // Generate speech
            let generationConfig = SherpaOnnxGenerationConfigC(SherpaOnnxGenerationConfigSwift(
                speed: speakingRate, sid: speakerId, phonemeCodepoints: phonemeCodepoints))
            let result = withUnsafePointer(to: &generationConfig.cConfig) { configPtr in
                SherpaOnnxOfflineTtsGenerateWithConfig(tts, toCPointer(text), configPtr, nil, nil)
            }
            
            if result == nil {
                // The C API returns NULL for empty audio, which is what v2.0+ produces
                // when a VITS/Piper, Kokoro or Matcha model has no lexicon.
                throw NSError(domain: "SherpaOnnx", code: 4, userInfo: [NSLocalizedDescriptionKey: "Failed to generate speech. Since sherpa-onnx v2.0 this model may need a lexicon file or phonemeCodepoints."])
            }
            
            // Get samples from result
            let numSamples = Int(result!.pointee.n)
            guard let samples = result!.pointee.samples else {
                throw NSError(domain: "SherpaOnnx", code: 5, userInfo: [NSLocalizedDescriptionKey: "Generated speech contains no samples"])
            }
            
            // Create filename
            let fileName = fileNamePrefix != nil ? "\(fileNamePrefix!)_\(Int(Date().timeIntervalSince1970))" : "generated_audio_\(Int(Date().timeIntervalSince1970))"
            let fileManager = FileManager.default
            let cacheDir = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first!
            let filePath = cacheDir.appendingPathComponent("\(fileName).wav")
            
            // Save audio to file
            let saved = saveAudioToFile(samples, numSamples: numSamples, sampleRate: sampleRate, filePath: filePath)
            
            if playAudio {
                // Play audio
                try playAudioFile(filePath: filePath.path)
            }
            
            // Free the result
            SherpaOnnxDestroyOfflineTtsGeneratedAudio(result)
            
            isGenerating = false
            
            return [
                "success": true,
                "filePath": filePath.path,
                "sampleRate": sampleRate,
                "numSamples": numSamples,
                "samplesLength": numSamples,
                "saved": saved,
                "error": NSNull()
            ]
        } catch {
            isGenerating = false
            NSLog("TTS generation failed: \(error.localizedDescription)")
            return [
                "success": false,
                "error": error.localizedDescription
            ]
        }
    }
    
    /**
     * Stop TTS generation and playback
     * 
     * @return Dictionary with stop result
     */
    @objc public func stopTts() -> NSDictionary {
        NSLog("SherpaOnnxTtsHandler: Stopping TTS generation - isGenerating was: \(isGenerating)")
        
        // Set flag to stop callback-based generation
        isGenerating = false
        
        // Stop audio playback if playing
        if let player = audioPlayer, player.isPlaying {
            NSLog("SherpaOnnxTtsHandler: Stopping audio playback")
            player.stop()
            audioPlayer = nil
        }
        
        // Additional check for TTS instance
        if tts != nil {
            NSLog("SherpaOnnxTtsHandler: TTS instance exists, marking as stopping")
            // Note: The C library doesn't have a direct "stop" function for TTS,
            // but the isGenerating flag should stop any callback-based generation
        }
        
        NSLog("SherpaOnnxTtsHandler: TTS stop completed successfully")
        
        return [
            "stopped": true,
            "message": "TTS stopped successfully"
        ]
    }
    
    /**
     * Release TTS resources
     * 
     * @return Dictionary with release result
     */
    @objc public func releaseTts() -> NSDictionary {
        cleanupTtsResources()
        return ["released": true]
    }
    
    // MARK: - Private Helper Methods
    
    /**
     * Release TTS resources
     */
    private func cleanupTtsResources() {
        isGenerating = false
        
        if let player = audioPlayer, player.isPlaying {
            player.stop()
            audioPlayer = nil
        }
        
        if let ttsPtr = tts {
            SherpaOnnxDestroyOfflineTts(ttsPtr)
            tts = nil
        }
        
        isInitialized = false
    }
    
    /**
     * Save audio to WAV file
     * 
     * @param samples Float array of audio samples
     * @param numSamples Number of samples
     * @param sampleRate Sample rate
     * @param filePath Output file path
     * @return Boolean indicating success
     */
    private func saveAudioToFile(_ samples: UnsafePointer<Float>?, numSamples: Int, sampleRate: Int, filePath: URL) -> Bool {
        guard let samples = samples else {
            NSLog("Error: samples pointer is nil")
            return false
        }
        
        do {
            // Create a WAV file
            let format = AVAudioFormat(standardFormatWithSampleRate: Double(sampleRate), channels: 1)
            let file = try AVAudioFile(forWriting: filePath, settings: format!.settings)
            
            // Create a buffer
            let buffer = AVAudioPCMBuffer(pcmFormat: format!, frameCapacity: AVAudioFrameCount(numSamples))
            buffer!.frameLength = AVAudioFrameCount(numSamples)
            
            // Copy samples to buffer
            let samplesPtr = UnsafeMutablePointer<Float>(mutating: samples)
            for i in 0..<numSamples {
                buffer!.floatChannelData![0][i] = samplesPtr[i]
            }
            
            // Write buffer to file
            try file.write(from: buffer!)
            
            NSLog("Saved audio file to: \(filePath.path)")
            return true
        } catch {
            NSLog("Error saving audio file: \(error.localizedDescription)")
            return false
        }
    }
    
    /**
     * Play audio file
     * 
     * @param filePath Path to audio file
     * @throws Error if playback fails
     */
    private func playAudioFile(filePath: String) throws {
        let url = URL(fileURLWithPath: filePath)
        audioPlayer = try AVAudioPlayer(contentsOf: url)
        audioPlayer?.prepareToPlay()
        audioPlayer?.play()
    }

    // ---> Add Helper function INSIDE the class <--- 
    private func logDirectoryContents(path: String) {
        do {
            let items = try FileManager.default.contentsOfDirectory(atPath: path)
            NSLog("Contents of directory '\(path)': \(items.joined(separator: ", "))")
        } catch {
            NSLog("Failed to list contents of directory '\(path)': \(error.localizedDescription)")
        }
    }
}

// NOTE: TTS config builder functions (sherpaOnnxOfflineTtsVitsModelConfig, etc.)
// are now provided by the upstream SherpaOnnx.swift wrapper in prebuilt/swift/sherpa-onnx/.
// Do NOT re-declare them here. 