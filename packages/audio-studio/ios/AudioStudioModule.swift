// packages/audio-studio/ios/AudioStudioModule.swift
import ExpoModulesCore
import AVFoundation

// Constants
private let audioDataEvent: String = "AudioData"
private let audioAnalysisEvent: String = "AudioAnalysis"
private let recordingInterruptedEvent: String = "onRecordingInterrupted"
private let maxDurationReachedEvent: String = "MaxDurationReached"
private let deviceChangedEvent: String = "deviceChangedEvent"
private let trimProgressEvent: String = "TrimProgress"
private let errorEvent: String = "error"
private let audioStreamChunkEvent: String = "AudioDataStreamChunk"
private let audioStreamProgressEvent: String = "AudioDataStreamProgress"
private let audioStreamCompleteEvent: String = "AudioDataStreamComplete"
private let audioStreamErrorEvent: String = "AudioDataStreamError"
private let DEFAULT_SEGMENT_DURATION_MS = 100
private let audioDeviceTypeBuiltinMic = "builtin_mic"
private let audioDeviceTypeBluetooth = "bluetooth"
private let audioDeviceTypeUSB = "usb"
private let audioDeviceTypeWiredHeadset = "wired_headset"
private let audioDeviceTypeWiredHeadphones = "wired_headphones"
private let audioDeviceTypeSpeaker = "speaker"
private let audioDeviceTypeUnknown = "unknown"

public class AudioStudioModule: Module, AudioStreamManagerDelegate, AudioDeviceManagerDelegate, AudioStreamDecoderDelegate {
    private var streamManager = AudioStreamManager()
    private let notificationCenter = UNUserNotificationCenter.current()
    private let notificationIdentifier = "audio_recording_notification"
    private var deviceManager = AudioDeviceManager()
    private var deviceChangeObserver: Any?

    private let streamDecodersLock = NSLock()
    private var streamDecoders: [String: AudioStreamDecoder] = [:]

    // Serial queue for AVAudioEngine lifecycle ops (prepare/start/stop).
    // Prevents concurrent mutation of shared engine state and keeps callers
    // off the main thread to avoid UI freezes during heavy native init.
    private let audioLifecycleQueue = DispatchQueue(
        label: "net.siteed.audiostudio.lifecycle",
        qos: .userInitiated
    )
        
    public func definition() -> ModuleDefinition {
        Name("AudioStudio")
        
        // Defines event names that the module can send to JavaScript.
        Events([
            audioDataEvent,
            audioAnalysisEvent,
            recordingInterruptedEvent,
            maxDurationReachedEvent,
            deviceChangedEvent,
            trimProgressEvent,
            errorEvent,
            audioStreamChunkEvent,
            audioStreamProgressEvent,
            audioStreamCompleteEvent,
            audioStreamErrorEvent
        ])
        
        OnCreate {
            Logger.debug("AudioStudioModule", "Module created, setting delegate and starting device monitoring.")
            streamManager.delegate = self
            // Set up device manager delegate to emit device change events
            deviceManager.delegate = self
            
            // Listen for device connection notifications (minimal addition)
            NotificationCenter.default.addObserver(
                forName: NSNotification.Name("DeviceConnected"),
                object: nil,
                queue: .main
            ) { [weak self] notification in
                if let deviceId = notification.userInfo?["deviceId"] as? String {
                    Logger.debug("AudioStudioModule", "Device connected: \(deviceId)")
                    self?.sendEvent(deviceChangedEvent, [
                        "type": "deviceConnected",
                        "deviceId": deviceId
                    ])
                }
            }
        }
        
        OnDestroy {
            Logger.debug("AudioStudioModule", "Module destroyed, stopping device monitoring.")
            _ = streamManager.stopRecording()
            // Cancel any in-flight streamAudioData decoders before the module
            // is torn down. Without this, decoder threads can outlive the
            // module and try to emit events through a destroyed instance.
            // Detach each decoder's delegate *before* cancelling so the
            // terminal "cancelled" events the worker emits after observing
            // `cancel()` are dropped instead of being forwarded.
            self.streamDecodersLock.lock()
            let inflight = self.streamDecoders
            self.streamDecoders.removeAll()
            self.streamDecodersLock.unlock()
            for (_, decoder) in inflight {
                decoder.delegate = nil
                decoder.cancel()
            }
            // Clear device manager delegate
            deviceManager.delegate = nil
        }
        
        /// Extracts audio analysis data from an audio file.
        ///
        /// - Parameters:
        ///   - options: A dictionary containing:
        ///     - `fileUri`: The URI of the audio file.
        ///     - `pointsPerSecond`: The number of data points to extract per second of audio.
        ///     - `features`: A dictionary specifying which features to extract (e.g., `energy`, `mfcc`, `rms`, etc.).
        ///   - promise: A promise to resolve with the extracted audio analysis data or reject with an error.
        /// - Returns: Promise to be resolved with audio analysis data.
        AsyncFunction("extractAudioAnalysis") { (options: [String: Any], promise: Promise) in
            Logger.debug("AudioStudioModule", "extractAudioAnalysis called with options: \(options)")
            guard let fileUri = options["fileUri"] as? String,
                  let url = URL(string: fileUri) else {
                Logger.error("AudioStudioModule", "extractAudioAnalysis: Invalid file URI.")
                promise.reject("INVALID_ARGUMENTS", "Invalid file URI provided")
                return
            }
            
            // Get time or byte range options
            let startTimeMs = bridgedFiniteDouble(options, "startTimeMs")
            let endTimeMs = bridgedFiniteDouble(options, "endTimeMs")
            let position = bridgedInt(options, "position")
            let byteLength = bridgedInt(options, "length")
            
            // Validate ranges - can have time range OR byte range OR no range
            let hasTimeRange = startTimeMs != nil && endTimeMs != nil
            let hasByteRange = position != nil && byteLength != nil
            
            // Only throw if both ranges are provided
            guard !(hasTimeRange && hasByteRange) else {
                promise.reject("INVALID_ARGUMENTS", "Cannot specify both time range and byte range")
                return
            }
            
            let features = options["features"] as? [String: Bool] ?? [:]
            let featureOptions = self.extractFeatureOptions(from: features)
            let segmentDurationMs = bridgedInt(options, "segmentDurationMs").flatMap { $0 > 0 ? $0 : nil } ?? DEFAULT_SEGMENT_DURATION_MS // Default value of 100ms
            
            DispatchQueue.global().async(execute: {
                do {
                    let audioFile = try AVAudioFile(forReading: url)
                    let bitDepth = audioFile.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int ?? 16
                    let numberOfChannels = Int(audioFile.fileFormat.channelCount)
                    let sampleRate = audioFile.fileFormat.sampleRate
                    
                    // Convert time range to byte range if needed
                    let effectivePosition: Int?
                    let effectiveLength: Int?
                    
                    if hasTimeRange {
                        // Validate the endpoints before converting. Clamping a negative
                        // start to zero turned -200...-100ms into "the first 100ms" instead
                        // of a rejected request (#433).
                        guard startTimeMs! >= 0, endTimeMs! > startTimeMs! else {
                            promise.reject(
                                "INVALID_RANGE",
                                "Invalid time range [\(startTimeMs!), \(endTimeMs!)]: "
                                + "start must be non-negative and end must be greater than start"
                            )
                            return
                        }
                        let bytesPerSecond = Int(sampleRate) * numberOfChannels * (bitDepth / 8)
                        // Clamp at the conversion: the option fits Int, the product with
                        // bytesPerSecond need not (#433).
                        effectivePosition = BridgedNarrowing.byteOffset(
                            milliseconds: startTimeMs!,
                            bytesPerSecond: bytesPerSecond
                        )
                        effectiveLength = BridgedNarrowing.byteOffset(
                            milliseconds: endTimeMs! - startTimeMs!,
                            bytesPerSecond: bytesPerSecond
                        )
                    } else {
                        effectivePosition = position
                        effectiveLength = byteLength
                    }
                    
                    Logger.debug("AudioStudioModule", "extractAudioAnalysis: Processing started for \(fileUri)")
                    let audioProcessor = try AudioProcessor(url: url, resolve: { result in
                        Logger.warn("AudioStudioModule", "extractAudioAnalysis: AudioProcessor resolve called unexpectedly.")
                    }, reject: { code, message in
                        Logger.warn("AudioStudioModule", "extractAudioAnalysis: AudioProcessor reject called unexpectedly: \(code) - \(message)")
                    })
                    
                    if let result = audioProcessor.processAudioData(
                        numberOfSamples: nil,
                        offset: 0,
                        length: nil,
                        segmentDurationMs: segmentDurationMs,
                        featureOptions: featureOptions,
                        bitDepth: bitDepth,
                        numberOfChannels: numberOfChannels,
                        position: effectivePosition,
                        byteLength: effectiveLength
                    ) {
                        Logger.debug("AudioStudioModule", "extractAudioAnalysis: Processing successful for \(fileUri)")
                        promise.resolve(result.toDictionary())
                    } else {
                        Logger.error("AudioStudioModule", "extractAudioAnalysis: audioProcessor.processAudioData returned nil for \(fileUri)")
                        promise.reject("PROCESSING_ERROR", "Failed to process audio data")
                    }
                } catch {
                    Logger.error("AudioStudioModule", "extractAudioAnalysis: Error initializing AudioProcessor for \(fileUri): \(error.localizedDescription)")
                    promise.reject("PROCESSING_ERROR", "Failed to initialize audio processor: \(error.localizedDescription)")
                }
            })
        }
        AsyncFunction("extractPreviewBars") { (options: [String: Any], promise: Promise) in
            extractPreviewBars(options: options, promise: promise)
        }

        
        
        /// Asynchronously starts audio recording with the given settings.
        ///
        /// - Parameters:
        ///   - options: A dictionary containing:
        ///     - `sampleRate`: The sample rate for recording (default is 16000.0).
        ///     - `channelConfig`: The number of channels (default is 1 for mono).
        ///     - `audioFormat`: The bit depth for recording (default is 16 bits).
        ///     - `interval`: The interval in milliseconds at which to emit recording data (default is 1000 ms).
        ///     - `intervalAnalysis`: The interval in milliseconds at which to emit analysis data (default is 500 ms).
        ///     - `enableProcessing`: Boolean to enable/disable audio processing (default is false).
        ///     - `pointsPerSecond`: The number of data points to extract per second of audio (default is 20).
        ///     - `algorithm`: The algorithm to use for extraction (default is "rms").
        ///     - `featureOptions`: A dictionary of feature options to extract (default is empty).
        ///     - `maxRecentDataDuration`: The maximum duration of recent data to keep for processing (default is 10.0 seconds).
        ///     - `compression`: A dictionary containing:
        ///       - `enabled`: Boolean to enable/disable compression (default is false).
        ///       - `format`: The compression format (default is "aac").
        ///       - `bitrate`: The compression bitrate in bps (default is 128000).
        ///   - promise: A promise to resolve with the recording settings or reject with an error.
        AsyncFunction("startRecording") { (options: [String: Any], promise: Promise) in
            Logger.debug("AudioStudioModule", "startRecording called")
            self.checkMicrophonePermission { granted in
                guard granted else {
                    Logger.warn("AudioStudioModule", "startRecording: Permission denied.")
                    promise.reject("PERMISSION_DENIED", "Recording permission has not been granted")
                    return
                }

                // Check if output.compressed is enabled and format is Opus
                var modifiedOptions = options
                if let fallback = RecordingSettings.applyingOpusFallback(options) {
                    modifiedOptions = fallback
                    Logger.warn("AudioStudioModule", "startRecording: Opus format is not supported on iOS. Falling back to AAC format.")
                }

                // Create settings with validation using the potentially modified options
                let settingsResult = RecordingSettings.fromDictionary(modifiedOptions)

                switch settingsResult {
                case .success(let settings):
                    // Initialize notification if enabled
                    if settings.showNotification {
                        Task {
                            let notificationGranted = await self.requestNotificationPermissions()
                            if !notificationGranted {
                                Logger.debug("AudioStudioModule", "Notification permissions not granted")
                            }
                        }
                    }

                    // Serialize on lifecycle queue: avoids racing with prepare/stop
                    // and keeps the JS/UI thread responsive while audio session
                    // and AVAudioEngine come up.
                    self.audioLifecycleQueue.async {
                        let outcome: Result<StartRecordingResult, Error>
                        do {
                            outcome = .success(try self.streamManager.startRecording(settings: settings))
                        } catch {
                            outcome = .failure(error)
                        }
                        DispatchQueue.main.async {
                            switch outcome {
                            case .success(let result):
                                var resultDict: [String: Any] = [
                                    "fileUri": result.fileUri,
                                    "channels": result.channels,
                                    "bitDepth": result.bitDepth,
                                    "sampleRate": result.sampleRate,
                                    "mimeType": result.mimeType,
                                ]

                                if let compression = result.compression {
                                    resultDict["compression"] = [
                                        "compressedFileUri": compression.compressedFileUri,
                                        "mimeType": compression.mimeType,
                                        "bitrate": compression.bitrate,
                                        "format": compression.format
                                    ]
                                }

                                Logger.info("AudioStudioModule", "Recording started successfully")
                                promise.resolve(resultDict)

                            case .failure(let error):
                                // Surface the specific reason. Every failure used to collapse
                                // into "Failed to start recording." with no way to tell a phone
                                // call from a permission problem (#419).
                                let startError = error as? StartRecordingError
                                let code = startError?.code ?? "START_FAILED"
                                let message = startError?.message ?? error.localizedDescription
                                Logger.error("AudioStudioModule", "Failed to start recording: \(code) - \(message)")
                                promise.reject(code, message)
                            }
                        }
                    }

                case .failure(let error):
                    Logger.error("AudioStudioModule", "Invalid settings - \(error.localizedDescription)")
                    promise.reject("INVALID_SETTINGS", error.localizedDescription)
                }
            }
        }
        
        /// Retrieves the current status of the audio stream.
        ///
        /// - Returns: The current status of the audio stream.Ï
        Function("status") {
            let currentStatus = self.streamManager.getStatus()
            Logger.debug("AudioStudioModule", "status requested: isRecording=\(currentStatus["isRecording"] ?? false), isPaused=\(currentStatus["isPaused"] ?? false)")
            return currentStatus
        }
        
        /// Prepares audio recording with the specified settings without starting it.
        ///
        /// - Parameters:
        ///   - options: The recording settings to use.
        ///   - promise: A promise to resolve with true if preparation was successful.
        /// - Returns: A promise that resolves with a boolean indicating success.
        AsyncFunction("prepareRecording") { (options: [String: Any], promise: Promise) in
            Logger.debug("AudioStudioModule", "prepareRecording called with options: \(options)")
            self.checkMicrophonePermission { granted in
                guard granted else {
                    promise.reject("PERMISSION_DENIED", "Recording permission has not been granted")
                    return
                }

                // Create settings with validation
                let settingsResult = RecordingSettings.fromDictionary(options)

                switch settingsResult {
                case .success(let settings):
                    Logger.debug("AudioStudioModule", "prepareRecording: Settings parsed. Dispatching to serial audio queue.")
                    // Serial queue prevents concurrent AVAudioEngine mutation if
                    // prepare/start/stop overlap. Off-main keeps UI responsive.
                    self.audioLifecycleQueue.async {
                        let prepareError: Error?
                        do {
                            try self.streamManager.prepareRecording(settings: settings)
                            prepareError = nil
                        } catch {
                            prepareError = error
                        }
                        DispatchQueue.main.async {
                            if let error = prepareError {
                                // Same reasoning as startRecording: report which reason,
                                // not just that something failed (#419).
                                let prep = error as? StartRecordingError
                                let code = prep?.code ?? "START_FAILED"
                                let message = prep?.message ?? error.localizedDescription
                                Logger.error("AudioStudioModule", "prepareRecording failed: \(code) - \(message)")
                                promise.reject(code, message)
                            } else {
                                Logger.info("AudioStudioModule", "prepareRecording: Preparation successful.")
                                promise.resolve(true)
                            }
                        }
                    }

                case .failure(let error):
                    promise.reject("INVALID_SETTINGS", error.localizedDescription)
                }
            }
        }
        
        /// Pauses audio recording.
        Function("pauseRecording") {
            Logger.debug("AudioStudioModule", "pauseRecording called.")
            self.streamManager.pauseRecording()
        }
        
        /// Resumes audio recording.
        Function("resumeRecording") {
            Logger.debug("AudioStudioModule", "resumeRecording called.")
            self.streamManager.resumeRecording()
        }
        
        /// Asynchronously stops audio recording and retrieves the recording result.
        ///
        /// - Parameters:
        ///   - promise: A promise to resolve with the recording result or reject with an error.
        AsyncFunction("stopRecording") { (promise: Promise) in
            Logger.debug("AudioStudioModule", "stopRecording called.")

            // Serialize on lifecycle queue: stop flushes file handles and
            // tears down AVAudioEngine; must not race with start/prepare and
            // must not block the JS/UI thread.
            self.audioLifecycleQueue.async {
                let recordingResult = self.streamManager.stopRecording()
                DispatchQueue.main.async {
                    if let recordingResult = recordingResult {
                        var resultDict: [String: Any] = [
                            "fileUri": recordingResult.fileUri,
                            "filename": recordingResult.filename,
                            "durationMs": recordingResult.duration,
                            "size": recordingResult.size,
                            "channels": recordingResult.channels,
                            "bitDepth": recordingResult.bitDepth,
                            "sampleRate": recordingResult.sampleRate,
                            "mimeType": recordingResult.mimeType,
                            "createdAt": Date().timeIntervalSince1970 * 1000,
                        ]

                        if let compression = recordingResult.compression {
                            resultDict["compression"] = [
                                "compressedFileUri": compression.compressedFileUri,
                                "mimeType": compression.mimeType,
                                "bitrate": compression.bitrate,
                                "format": compression.format,
                                "size": compression.size
                            ]
                        }

                        Logger.info("AudioStudioModule", "stopRecording: Recording stopped successfully. fileUri: \(recordingResult.fileUri), size: \(recordingResult.size)")
                        promise.resolve(resultDict)
                    } else {
                        Logger.error("AudioStudioModule", "stopRecording: streamManager.stopRecording returned nil.")
                        promise.reject("ERROR", "Failed to stop recording or no recording in progress.")
                    }
                }
            }
        }
        
        /// Asynchronously lists all audio files stored in the document directory.
        ///
        /// - Parameters:
        ///   - promise: A promise to resolve with the list of audio file URIs or reject with an error.
        /// - Returns: A promise that resolves with the list of audio file URIs or rejects with an error.
        AsyncFunction("listAudioFiles") { (promise: Promise) in
            Logger.debug("AudioStudioModule", "listAudioFiles called.")
            let files = listAudioFiles()
            Logger.debug("AudioStudioModule", "listAudioFiles returning \(files.count) files.")
            promise.resolve(files)
        }
        
        /// Clears all audio files stored in the document directory.
        Function("clearAudioFiles") {
            Logger.debug("AudioStudioModule", "clearAudioFiles called.")
            clearAudioFiles()
        }
        
        
        /// Requests audio recording permissions.
        ///
        /// - Parameters:
        ///   - promise: A promise to resolve with the permission status or reject with an error.
        /// - Returns: Promise to be resolved with the permission status.
        AsyncFunction("requestPermissionsAsync") { (promise: Promise) in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                promise.resolve([
                    "status": granted ? "granted" : "denied",
                    "granted": granted,
                    "expires": "never",
                    "canAskAgain": true
                ])
            }
        }
        
        AsyncFunction("requestNotificationPermissionsAsync") { (promise: Promise) in
            Task {
                let granted = await requestNotificationPermissions()
                promise.resolve([
                    "granted": granted,
                    "status": granted ? "granted" : "denied"
                ])
            }
        }
        
        /// Gets the current audio recording permissions.
        ///
        /// - Parameters:
        ///   - promise: A promise to resolve with the permission status or reject with an error.
        /// - Returns: Promise to be resolved with the permission status.
        AsyncFunction("getPermissionsAsync") { (promise: Promise) in
            let permissionStatus = AVAudioSession.sharedInstance().recordPermission
            switch permissionStatus {
            case .granted:
                promise.resolve([
                    "status": "granted",
                    "granted": true,
                    "expires": "never",
                    "canAskAgain": true
                ])
            case .denied:
                promise.resolve([
                    "status": "denied",
                    "granted": false,
                    "expires": "never",
                    "canAskAgain": false
                ])
            case .undetermined:
                promise.resolve([
                    "status": "undetermined",
                    "granted": false,
                    "expires": "never",
                    "canAskAgain": true
                ])
            @unknown default:
                promise.reject("UNKNOWN_ERROR", "Unknown permission status")
            }
        }

        /// Trims an audio file to specified start and end times.
        /// - Parameters:
        ///   - options: A dictionary containing:
        ///     - `fileUri`: The URI of the audio file.
        ///     - `mode`: Trim mode ('single', 'keep', or 'remove').
        ///     - `startTimeMs`: Start time in milliseconds (for 'single' mode).
        ///     - `endTimeMs`: End time in milliseconds (for 'single' mode).
        ///     - `ranges`: Array of time ranges (for 'keep' and 'remove' modes).
        ///     - `outputFileName`: Optional name for the output file.
        ///     - `outputFormat`: Optional output format configuration.
        ///     - `decodingOptions`: Optional decoding configuration.
        AsyncFunction("trimAudio") { (options: [String: Any], promise: Promise) in
            guard let fileUri = options["fileUri"] as? String,
                  let url = URL(string: fileUri) else {
                promise.reject("INVALID_ARGUMENTS", "Invalid file URI provided")
                return
            }

            let mode = options["mode"] as? String ?? "single"
            let startTimeMs = bridgedFiniteDouble(options, "startTimeMs")
            let endTimeMs = bridgedFiniteDouble(options, "endTimeMs")
            // Nested payload: read inner values through NSNumber, matching
            // bridgedDouble, so they parse regardless of how the bridge boxed them.
            // Absent `ranges` stays nil so the keep/remove guard below still fires.
            let ranges = (options["ranges"] as? [[String: Any]])?.map { range in
                // Same finite + Int-representable rule as the scalar reads: these
                // values are later narrowed for frame-position math.
                range.compactMapValues { value -> Double? in
                    guard let d = (value as? NSNumber)?.doubleValue, d.isFinite,
                          Int(exactly: d.rounded(.towardZero)) != nil else { return nil }
                    return d
                }
            }
            let outputFileName = options["outputFileName"] as? String
            // A name, not a path. A separator makes it a path, and a path can traverse:
            // `../../../../tmp/pwned` would write to /var/tmp (#433).
            if let name = outputFileName, !SafeFilename.isValid(name) {
                promise.reject(
                    "INVALID_OUTPUT_FILENAME",
                    "outputFileName must be a single filename without path separators"
                )
                return
            }
            let outputFormat = options["outputFormat"] as? [String: Any]
            let decodingOptions = options["decodingOptions"] as? [String: Any] ?? [:]

            // Add detailed logging for filename and format options
            Logger.debug("AudioStudioModule", "Trim audio request:")
            Logger.debug("AudioStudioModule", "- Input file: \(fileUri)")
            Logger.debug("AudioStudioModule", "- Mode: \(mode)")
            Logger.debug("AudioStudioModule", "- Output filename: \(outputFileName ?? "not specified (will generate UUID)")")
            if let format = outputFormat?["format"] as? String {
                Logger.debug("AudioStudioModule", "- Output format: \(format)")
            } else {
                Logger.debug("AudioStudioModule", "- Output format: not specified (will use default)")
            }

            // Input validation based on mode
            switch mode {
            case "single":
                guard let start = startTimeMs, let end = endTimeMs else {
                    promise.reject("INVALID_ARGUMENTS", "startTimeMs and endTimeMs required for 'single' mode")
                    return
                }
                guard start >= 0, end > start else {
                    promise.reject("INVALID_ARGUMENTS", "Invalid time range")
                    return
                }
            case "keep", "remove":
                guard let rangesArray = ranges, !rangesArray.isEmpty else {
                    promise.reject("INVALID_ARGUMENTS", "'ranges' array required for 'keep' or 'remove' mode")
                    return
                }
            default:
                promise.reject("INVALID_MODE", "Mode must be 'single', 'keep', or 'remove'")
                return
            }

            DispatchQueue.global().async {
                do {
                    let audioProcessor = try AudioProcessor(
                        url: url,
                        resolve: { result in promise.resolve(result) },
                        reject: { code, message in promise.reject(code, message) }
                    )

                    let progressCallback: (Float, Int64, Int64) -> Void = { progress, bytesProcessed, totalBytes in
                        self.sendEvent(trimProgressEvent, [
                            "progress": progress,
                            "bytesProcessed": bytesProcessed,
                            "totalBytes": totalBytes
                        ])
                    }

                    let startTime = CACurrentMediaTime()
                    if let result = audioProcessor.trimAudio(
                        mode: mode,
                        startTimeMs: startTimeMs,
                        endTimeMs: endTimeMs,
                        ranges: ranges,
                        outputFileName: outputFileName,
                        outputFormat: outputFormat,
                        decodingOptions: decodingOptions,
                        progressCallback: progressCallback
                    ) {
                        let processingTimeMs = Int((CACurrentMediaTime() - startTime) * 1000)
                        var resultDict = result.toDictionary()
                        resultDict["processingInfo"] = ["durationMs": processingTimeMs]
                        
                        let uri = result.uri
                        Logger.debug("AudioStudioModule", "Trim completed successfully in \(processingTimeMs)ms")
                        Logger.debug("AudioStudioModule", "Output file URI: \(uri)")
                        
                        // Verify file exists
                        let fileManager = FileManager.default
                        if let url = URL(string: uri) {
                            let exists = fileManager.fileExists(atPath: url.path)
                            Logger.debug("AudioStudioModule", "File exists at path \(url.path): \(exists)")
                            
                            // Log filename details
                            Logger.debug("AudioStudioModule", "Filename: \(url.lastPathComponent)")
                            Logger.debug("AudioStudioModule", "File extension: \(url.pathExtension.lowercased())")
                            
                            // If format is AAC, ensure we're using the correct extension and MIME type
                            if let format = outputFormat?["format"] as? String, 
                               format.lowercased() == "aac" {
                                
                                Logger.debug("AudioStudioModule", "AAC format detected - ensuring correct metadata")
                                
                                // For AAC format, ensure we're using the correct extension and MIME type
                                if url.pathExtension.lowercased() == "m4a" {
                                    Logger.debug("AudioStudioModule", "File has correct m4a extension for AAC audio")
                                    
                                    // Just update the MIME type in the result to ensure correct playback
                                    if var compression = resultDict["compression"] as? [String: Any] {
                                        compression["mimeType"] = "audio/mp4"
                                        resultDict["compression"] = compression
                                    }
                                    
                                    resultDict["mimeType"] = "audio/mp4"
                                    resultDict["actualFormat"] = "m4a"
                                } else {
                                    Logger.debug("AudioStudioModule", "Warning: AAC format should use .m4a extension, but found .\(url.pathExtension.lowercased())")
                                }
                            }
                        }
                        
                        promise.resolve(resultDict)
                    } else {
                        Logger.debug("AudioStudioModule", "Failed to trim audio")
                        promise.reject("TRIM_ERROR", "Failed to trim audio")
                    }
                } catch {
                    Logger.debug("AudioStudioModule", "Failed to initialize audio processor: \(error.localizedDescription)")
                    promise.reject("PROCESSING_ERROR", "Failed to initialize audio processor: \(error.localizedDescription)")
                }
            }
        }
        
        /// Extracts raw PCM audio data from a file with time or byte range support
        /// - Parameters:
        ///   - options: A dictionary containing:
        ///     - `fileUri`: The URI of the audio file
        ///     - `startTimeMs`: Optional start time in milliseconds
        ///     - `endTimeMs`: Optional end time in milliseconds
        ///     - `position`: Optional byte position
        ///     - `length`: Optional byte length
        ///     - `includeNormalizedData`: Boolean to include normalized audio data in [-1, 1] range
        ///     - `includeWavHeader`: Boolean to include WAV header in the PCM data
        ///     - `decodingOptions`: Decoding configuration
        ///     - `includeBase64Data`: Boolean to include base64 encoded string representation of the audio data
        ///     - `computeChecksum`: Boolean to compute and include CRC32 checksum of the PCM data
        AsyncFunction("extractAudioData") { (options: [String: Any], promise: Promise) in
            guard let fileUri = options["fileUri"] as? String,
                  let url = URL(string: fileUri) else {
                promise.reject("INVALID_ARGUMENTS", "Invalid file URI provided")
                return
            }

            // Get time or byte range options
            let startTimeMs = bridgedFiniteDouble(options, "startTimeMs")
            let endTimeMs = bridgedFiniteDouble(options, "endTimeMs")
            let position = bridgedInt(options, "position")
            let length = bridgedInt(options, "length")
            let includeWavHeader = options["includeWavHeader"] as? Bool ?? false
            let includeNormalizedData = options["includeNormalizedData"] as? Bool ?? false
            let decodingOptions = options["decodingOptions"] as? [String: Any] ?? [:]
            let includeBase64Data = options["includeBase64Data"] as? Bool ?? false

            // Validate that we have either time range or byte range, but not both and not neither
            let hasTimeRange = startTimeMs != nil && endTimeMs != nil
            let hasByteRange = position != nil && length != nil

            guard hasTimeRange || hasByteRange else {
                promise.reject("INVALID_ARGUMENTS", "Must specify either time range (startTimeMs, endTimeMs) or byte range (position, length)")
                return
            }

            guard !(hasTimeRange && hasByteRange) else {
                promise.reject("INVALID_ARGUMENTS", "Cannot specify both time range and byte range")
                return
            }

            // File decode + frame read can take 100s of ms on large files.
            // Move off main to keep JS/UI responsive.
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let audioFile = try AVAudioFile(forReading: url)
                    let format = audioFile.processingFormat
                    let sampleRate = format.sampleRate
                    let channels = Int(format.channelCount)
                    let bitDepth = audioFile.fileFormat.settings[AVLinearPCMBitDepthKey] as? Int ?? 16

                    let startFrame: AVAudioFramePosition
                    let endFrame: AVAudioFramePosition

                    if hasTimeRange {
                        // Validate before converting. Clamping a negative start to zero let
                        // a negative start with a positive end through, where it used to be
                        // rejected (#433).
                        guard startTimeMs! >= 0, endTimeMs! > startTimeMs! else {
                            promise.reject(
                                "INVALID_RANGE",
                                "Invalid time range [\(startTimeMs!), \(endTimeMs!)]: "
                                + "start must be non-negative and end must be greater than start"
                            )
                            return
                        }
                        // Clamp before narrowing; the range check below runs on values that
                        // already had to survive the conversion (#433).
                        startFrame = AVAudioFramePosition(
                            BridgedNarrowing.sampleCount(
                                milliseconds: startTimeMs!,
                                sampleRate: sampleRate,
                                minimum: 0
                            )
                        )
                        endFrame = AVAudioFramePosition(
                            BridgedNarrowing.sampleCount(
                                milliseconds: endTimeMs!,
                                sampleRate: sampleRate,
                                minimum: 0
                            )
                        )
                    } else {
                        let bytesPerFrame = Int64(channels * (bitDepth / 8))
                        startFrame = AVAudioFramePosition(position!) / bytesPerFrame
                        // Additive, so it can overflow even when both operands are valid:
                        // position = length = Int.max on 8-bit mono traps here.
                        let frameCount = AVAudioFramePosition(length!) / bytesPerFrame
                        let (sum, overflowed) = startFrame.addingReportingOverflow(frameCount)
                        endFrame = overflowed ? AVAudioFramePosition.max : sum
                    }

                    guard startFrame >= 0 && endFrame <= audioFile.length && startFrame < endFrame else {
                        promise.reject("INVALID_RANGE", "Invalid range specified")
                        return
                    }

                    let frameCount = AVAudioFrameCount(endFrame - startFrame)

                    let decodingConfig = DecodingConfig.fromDictionary(decodingOptions)

                    let (pcmData, normalizedData, base64Data) = try extractRawAudioData(
                        from: url,
                        startFrame: startFrame,
                        frameCount: frameCount,
                        format: format,
                        decodingConfig: decodingConfig,
                        includeNormalizedData: includeNormalizedData,
                        includeBase64Data: includeBase64Data
                    )

                    var resultDict: [String: Any] = [:]

                    if includeWavHeader {
                        let wavData = createWavHeader(
                            pcmData: pcmData,
                            sampleRate: Int(sampleRate),
                            channels: channels,
                            bitDepth: bitDepth
                        )
                        resultDict["pcmData"] = wavData
                        resultDict["hasWavHeader"] = true
                    } else {
                        resultDict["pcmData"] = pcmData
                        resultDict["hasWavHeader"] = false
                    }

                    resultDict["sampleRate"] = Int(sampleRate)
                    resultDict["channels"] = channels
                    resultDict["bitDepth"] = bitDepth
                    resultDict["durationMs"] = Int(Double(frameCount) * 1000.0 / sampleRate)
                    resultDict["format"] = "pcm_\(bitDepth)bit"
                    resultDict["samples"] = Int(frameCount) * channels

                    if includeNormalizedData {
                        resultDict["normalizedData"] = normalizedData
                    }

                    if options["computeChecksum"] as? Bool == true {
                        let checksum = calculateCRC32(data: pcmData)
                        resultDict["checksum"] = Int(checksum)
                        Logger.debug("AudioStudioModule", "Computed CRC32 checksum: \(checksum)")
                    }

                    if let includeBase64Data = options["includeBase64Data"] as? Bool, includeBase64Data {
                        resultDict["base64Data"] = base64Data
                    }

                    promise.resolve(resultDict)

                } catch {
                    promise.reject("PROCESSING_ERROR", "Failed to process audio file: \(error.localizedDescription)")
                }
            }
        }
        
        /// Extracts mel spectrogram data from a file.
        ///
        /// - Parameters:
        ///   - options: A dictionary containing:
        ///     - `fileUri`: The URI of the audio file.
        ///     - `pointsPerSecond`: The number of data points to extract per second of audio.
        ///   - promise: A promise to resolve with the extracted mel spectrogram data or reject with an error.
        /// - Returns: Promise to be resolved with mel spectrogram data.
        AsyncFunction("extractMelSpectrogram") { (options: [String: Any], promise: Promise) in
            // Heavy DSP: file decode + STFT + mel projection. Multi-second on
            // large files. Move off main to keep JS/UI responsive.
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    guard let fileUri = options["fileUri"] as? String else {
                        throw NSError(domain: "AudioStudio", code: -1, userInfo: [NSLocalizedDescriptionKey: "fileUri is required"])
                    }
                    guard let windowSizeMs = bridgedFiniteDouble(options, "windowSizeMs"), windowSizeMs > 0 else {
                        throw NSError(domain: "AudioStudio", code: -1, userInfo: [NSLocalizedDescriptionKey: "windowSizeMs is required"])
                    }
                    guard let hopLengthMs = bridgedFiniteDouble(options, "hopLengthMs"), hopLengthMs > 0 else {
                        throw NSError(domain: "AudioStudio", code: -1, userInfo: [NSLocalizedDescriptionKey: "hopLengthMs is required"])
                    }
                    guard let nMels = bridgedInt(options, "nMels"), nMels > 0, nMels <= Int(Int32.max) else {
                        throw NSError(domain: "AudioStudio", code: -1, userInfo: [NSLocalizedDescriptionKey: "nMels is required"])
                    }

                    let fMin = Float(bridgedFiniteDouble(options, "fMin") ?? 0.0)
                    let fMaxParam = bridgedFiniteDouble(options, "fMax")
                    let windowType = options["windowType"] as? String ?? "hann"
                    let logScale = options["logScale"] as? Bool ?? true
                    let normalize = options["normalize"] as? Bool ?? false
                    let startTimeMs = bridgedFiniteDouble(options, "startTimeMs")
                    let endTimeMs = bridgedFiniteDouble(options, "endTimeMs")

                    let audioData = try loadAudioFile(fileUri)
                    let sampleRate = audioData.sampleRate
                    var samples = audioData.samples

                    switch BridgedNarrowing.timeRange(
                        startMs: startTimeMs,
                        endMs: endTimeMs,
                        sampleRate: Double(sampleRate),
                        availableSamples: samples.count
                    ) {
                    case .whole:
                        break
                    case .samples(let startSample, let endSample):
                        samples = Array(samples[startSample..<endSample])
                    case .invalid(let reason):
                        throw NSError(
                            domain: "AudioStudio",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey: "Invalid time range: \(reason)"]
                        )
                    }

                    let fMax = fMaxParam.map { Float($0) } ?? Float(sampleRate) / 2.0

                    // Reject an oversized window instead of clamping it. The C++ side
                    // resizes window_ to windowSizeSamples — Int32.max floats is ~8 GiB —
                    // and then writes frameLen samples into fftInput_, which is only
                    // fftLength (2048) floats, so anything larger overruns that buffer
                    // (MelSpectrogram.cpp:35, :120, :135). Clamping would trade a trap for
                    // a heap overflow.
                    let fftLength = 2048
                    let maxWindowSamples = min(samples.count, fftLength)
                    let windowSizeSamples = BridgedNarrowing.sampleCount(
                        milliseconds: windowSizeMs,
                        sampleRate: Double(sampleRate)
                    )
                    guard windowSizeSamples <= maxWindowSamples else {
                        throw NSError(
                            domain: "AudioStudio",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "windowSizeMs is \(windowSizeMs)ms (\(windowSizeSamples) samples "
                                + "at \(sampleRate)Hz), above the maximum of \(maxWindowSamples) "
                                + "samples for this file and a \(fftLength)-point FFT"]
                        )
                    }

                    // Floor of 0, not 1: the C++ side treats a non-positive hop as "use the
                    // 160-sample default", and a sub-sample hop rounding to 1 would instead
                    // produce ~160x the frames.
                    let hopLengthSamples = BridgedNarrowing.sampleCount(
                        milliseconds: hopLengthMs,
                        sampleRate: Double(sampleRate),
                        minimum: 0
                    )
                    guard hopLengthSamples <= samples.count else {
                        throw NSError(
                            domain: "AudioStudio",
                            code: -1,
                            userInfo: [NSLocalizedDescriptionKey:
                                "hopLengthMs is \(hopLengthMs)ms (\(hopLengthSamples) samples "
                                + "at \(sampleRate)Hz), longer than the \(samples.count) samples "
                                + "being analysed"]
                        )
                    }

                    let windowTypeInt: Int32 = windowType.lowercased() == "hamming" ? 1 : 0

                    guard let result = samples.withUnsafeBufferPointer({ bufferPtr -> [AnyHashable: Any]? in
                        guard let baseAddress = bufferPtr.baseAddress else { return nil }
                        return MelSpectrogramWrapper.compute(
                            withSamples: baseAddress,
                            numSamples: Int32(samples.count),
                            sampleRate: Int32(sampleRate),
                            fftLength: 2048,
                            // Int32 traps well before Int does: 100_000_000 ms at 44.1 kHz
                            // is 4.41e9 samples, fine as Int and past Int32.max (#433).
                            // Both are already bounded above by the guards above, so these
                            // conversions cannot trap.
                            windowSizeSamples: Int32(windowSizeSamples),
                            hopLengthSamples: Int32(hopLengthSamples),
                            nMels: Int32(nMels),
                            fMin: fMin,
                            fMax: fMax,
                            windowType: windowTypeInt,
                            logScale: logScale,
                            normalize: normalize
                        )
                    }) else {
                        throw NSError(domain: "AudioStudio", code: -1, userInfo: [NSLocalizedDescriptionKey: "Audio data is too short for spectrogram analysis"])
                    }

                    let timeSteps = result["timeSteps"] as! Int
                    let durationMs = Double(samples.count) / Double(sampleRate) * 1000.0

                    let output: [String: Any] = [
                        "spectrogram": result["spectrogram"]!,
                        "sampleRate": sampleRate,
                        "nMels": nMels,
                        "timeSteps": timeSteps,
                        "durationMs": durationMs
                    ]

                    promise.resolve(output)
                } catch {
                    promise.reject("SPECTROGRAM_ERROR", "Failed to extract mel spectrogram: \(error.localizedDescription)")
                }
            }
        }
        
        /// Gets available audio input devices with an optional refresh parameter
        /// - Parameters:
        ///   - options: Optional dictionary containing a refresh parameter
        ///   - promise: A promise to resolve with a list of available audio input devices
        AsyncFunction("getAvailableInputDevices") { (options: [String: Any]?, promise: Promise) in
            Logger.debug("AudioStudioModule", "getAvailableInputDevices called. Refresh: \(options?["refresh"] ?? false)")
            if let options = options, let refresh = options["refresh"] as? Bool, refresh {
                Logger.debug("AudioStudioModule", "Forcing refresh of audio devices")
                _ = self.deviceManager.forceRefreshAudioSession()
            }
            
            // Call the device manager with the promise
            self.deviceManager.getAvailableInputDevices(promise: promise)
        }
        
        /// Refreshes the audio session to detect newly connected devices
        /// - Returns: Boolean indicating success
        Function("refreshAudioDevices") {
            Logger.debug("AudioStudioModule", "refreshAudioDevices called.")
            let success = self.deviceManager.forceRefreshAudioSession()
            Logger.debug("AudioStudioModule", "refreshAudioDevices result: \(success)")
            return ["success": success]
        }
        
        /// Gets the currently selected audio input device
        ///
        /// - Parameters:
        ///   - promise: A promise to resolve with the currently selected audio input device
        AsyncFunction("getCurrentInputDevice") { (promise: Promise) in
            Logger.debug("AudioStudioModule", "getCurrentInputDevice called.")
            self.deviceManager.getCurrentInputDevice(promise: promise)
        }
        
        /// Selects a specific audio input device for recording
        ///
        /// - Parameters:
        ///   - deviceId: The ID of the device to select
        ///   - promise: A promise to resolve with boolean indicating success
        AsyncFunction("selectInputDevice") { (deviceId: String, promise: Promise) in
            Logger.debug("AudioStudioModule", "selectInputDevice called with ID: \(deviceId)")
            self.deviceManager.selectInputDevice(deviceId, promise: promise)
            // Sync deviceId into recordingSettings so updateAudioSessionWithCurrentSettings can find the port
            self.streamManager.recordingSettings?.deviceId = deviceId
            // Update the audio recorder if recording is in progress or prepared
            if self.streamManager.isRecording || self.streamManager.isPrepared {
                Logger.debug("AudioStudioModule", "selectInputDevice: Calling updateAudioSessionWithCurrentSettings because recording/prepared.")
                self.streamManager.updateAudioSessionWithCurrentSettings()
            } else {
                Logger.debug("AudioStudioModule", "selectInputDevice: Not calling updateAudioSessionWithCurrentSettings because not recording/prepared.")
            }
        }
        
        /// Resets to the default audio input device
        ///
        /// - Parameters:
        ///   - promise: A promise to resolve with boolean indicating success
        AsyncFunction("resetToDefaultDevice") { (promise: Promise) in
            Logger.debug("AudioStudioModule", "resetToDefaultDevice called.")
            self.deviceManager.resetToDefaultDevice { success, error in
                if success {
                    // Clear stored deviceId so updateAudioSessionWithCurrentSettings won't bail early
                    self.streamManager.recordingSettings?.deviceId = nil
                    if self.streamManager.isRecording || self.streamManager.isPrepared {
                        Logger.debug("AudioStudioModule", "resetToDefaultDevice: Performing device switch to system default.")
                        // Bug 1 fix: call performDeviceSwitch(nil) directly — updateAudioSessionWithCurrentSettings
                        // would bail immediately because deviceId is now nil.
                        self.streamManager.performDeviceSwitch(port: nil)
                    } else {
                        Logger.debug("AudioStudioModule", "resetToDefaultDevice: Not recording/prepared, no engine action needed.")
                    }
                    promise.resolve(true)
                } else {
                    Logger.error("AudioStudioModule", "resetToDefaultDevice failed: \(error?.localizedDescription ?? "Unknown error")")
                    promise.reject("DEVICE_ERROR", "Failed to reset to default device: \(error?.localizedDescription ?? "Unknown error")")
                }
            }
        }

        AsyncFunction("streamAudioData") { (options: [String: Any], promise: Promise) in
            guard let requestId = options["requestId"] as? String,
                  let fileUri = options["fileUri"] as? String else {
                promise.reject(
                    "ERR_AUDIO_STREAM_INVALID_RANGE",
                    "fileUri and requestId are required"
                )
                return
            }

            let streamFormat = options["streamFormat"] as? String ?? "float32"
            guard streamFormat == "float32" else {
                promise.reject(
                    "ERR_AUDIO_STREAM_UNSUPPORTED_FORMAT",
                    "Only streamFormat='float32' is supported"
                )
                return
            }

            let chunkDurationMs = bridgedInt(options, "chunkDurationMs") ?? 1000
            guard (10...60000).contains(chunkDurationMs) else {
                promise.reject(
                    "ERR_AUDIO_STREAM_INVALID_RANGE",
                    "chunkDurationMs must be in [10, 60000]"
                )
                return
            }

            // Reject rather than silently falling back to the source rate. An absurd value
            // reached AVAssetReaderTrackOutput, which raises an ObjC exception no Swift
            // catch can recover from, and AVAudioConverter, which returns nil (#433).
            // Present-but-unusable must reject, not fall through to the source rate.
            let requested = BridgedNarrowing.requestedRate(
                rawValue: options["targetSampleRate"],
                parsed: bridgedFiniteDouble(options, "targetSampleRate"),
                permitted: BridgedNarrowing.readerSampleRates
            )
            if requested == .invalid {
                promise.reject(
                    "ERR_AUDIO_STREAM_INVALID_RANGE",
                    "targetSampleRate must be in "
                    + "[\(BridgedNarrowing.readerSampleRates.lowerBound), "
                    + "\(BridgedNarrowing.readerSampleRates.upperBound)]"
                )
                return
            }
            let requestedSampleRate: Double? = {
                if case .valid(let rate) = requested { return rate }
                return nil
            }()

            let opts = AudioStreamDecoder.Options(
                requestId: requestId,
                fileUri: fileUri,
                startTimeMs: bridgedFiniteDouble(options, "startTimeMs"),
                endTimeMs: bridgedFiniteDouble(options, "endTimeMs"),
                targetSampleRate: requestedSampleRate,
                channels: bridgedInt(options, "channels"),
                normalizeAudio: options["normalizeAudio"] as? Bool ?? true,
                chunkDurationMs: chunkDurationMs,
                maxChunkBytes: bridgedInt(options, "maxChunkBytes"),
                maxBufferedChunks: bridgedInt(options, "maxBufferedChunks") ?? 4,
                backpressureTimeoutMs: bridgedFiniteDouble(options, "backpressureTimeoutMs").flatMap { $0 >= 0 ? $0 : nil }
            )

            let decoder = AudioStreamDecoder(options: opts)
            decoder.delegate = self
            self.streamDecodersLock.lock()
            if self.streamDecoders[requestId] != nil {
                self.streamDecodersLock.unlock()
                promise.reject(
                    "ERR_AUDIO_STREAM_BUSY",
                    "requestId already in use"
                )
                return
            }
            self.streamDecoders[requestId] = decoder
            self.streamDecodersLock.unlock()
            decoder.start()
            promise.resolve(["requestId": requestId])
        }

        AsyncFunction("cancelStreamAudioData") { (requestId: String, promise: Promise) in
            self.streamDecodersLock.lock()
            let decoder = self.streamDecoders[requestId]
            self.streamDecodersLock.unlock()
            decoder?.cancel()
            promise.resolve(["requestId": requestId, "cancelled": decoder != nil])
        }

        Function("acknowledgeStreamAudioChunk") { (requestId: String, chunkIndex: Int) in
            self.streamDecodersLock.lock()
            let decoder = self.streamDecoders[requestId]
            self.streamDecodersLock.unlock()
            decoder?.acknowledgeChunk(chunkIndex)
        }

        AsyncFunction("getAudioDecodeCapabilities") { (promise: Promise) in
            promise.resolve([
                "platform": "ios",
                "supportedInputFormats": [
                    "audio/wav",
                    "audio/aac",
                    "audio/mp4",
                    "audio/mpeg",
                    "audio/x-m4a",
                    "audio/caf",
                    "audio/aiff",
                ],
                "supportedOutputFormats": ["float32"],
                "supportsCancellation": true,
                "supportsBackpressure": true,
                "supportsTimeRange": true,
                "supportsTargetSampleRate": true,
                "supportsChannelMixing": true,
                "knownLimitations": [
                    "Opus/WebM input depends on AVFoundation codec availability for the iOS version."
                ],
            ])
        }
    }

    private func releaseStreamDecoder(_ requestId: String) {
        streamDecodersLock.lock()
        streamDecoders.removeValue(forKey: requestId)
        streamDecodersLock.unlock()
    }

    /// Returns true when `requestId` is still tracked by the module. Used as
    /// the lifecycle gate for delegate sends: callbacks that race with
    /// `OnDestroy` (which clears the map *before* cancelling) see `false`
    /// and skip `sendEvent`, so we never push events through a destroyed
    /// React context.
    private func isActiveStreamDecoder(_ requestId: String) -> Bool {
        streamDecodersLock.lock()
        defer { streamDecodersLock.unlock() }
        return streamDecoders[requestId] != nil
    }

    // MARK: - AudioStreamDecoderDelegate

    public func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didEmitChunk payload: [String: Any]
    ) {
        guard let requestId = payload["requestId"] as? String,
              isActiveStreamDecoder(requestId) else { return }
        sendEvent(audioStreamChunkEvent, payload)
    }

    public func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didReportProgress payload: [String: Any]
    ) {
        guard let requestId = payload["requestId"] as? String,
              isActiveStreamDecoder(requestId) else { return }
        sendEvent(audioStreamProgressEvent, payload)
    }

    public func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didCompleteWith payload: [String: Any]
    ) {
        guard let requestId = payload["requestId"] as? String,
              isActiveStreamDecoder(requestId) else { return }
        releaseStreamDecoder(requestId)
        sendEvent(audioStreamCompleteEvent, payload)
    }

    public func streamDecoder(
        _ decoder: AudioStreamDecoder,
        didFailWith payload: [String: Any]
    ) {
        guard let requestId = payload["requestId"] as? String,
              isActiveStreamDecoder(requestId) else { return }
        if let code = payload["code"] as? String,
           code != "ERR_AUDIO_STREAM_CANCELLED" {
            releaseStreamDecoder(requestId)
        }
        sendEvent(audioStreamErrorEvent, payload)
    }

    func audioStreamManager(_ manager: AudioStreamManager, didReceiveInterruption info: [String: Any]) {
        Logger.debug("AudioStudioModule", "Delegate: didReceiveInterruption: \(info)")
        // Convert iOS interruption events to match the TypeScript types
        var reason: String
        var isPaused: Bool = true
        
        if let type = info["type"] as? String {
            switch type {
            case "began":
                // Phone call or other audio session interruption began
                reason = "audioFocusLoss"
            case "ended":
                reason = "audioFocusGain"
                isPaused = false
                // Check if this was from a phone call
                if let wasSuspended = info["wasSuspended"] as? Bool, wasSuspended {
                    reason = "phoneCallEnded"
                }
            default:
                return
            }
        } else if let specificReason = info["reason"] as? String {
            // Handle specific reasons that are already properly formatted
            reason = specificReason
            isPaused = info["isPaused"] as? Bool ?? true
        } else {
            return
        }
        
        // Send event in the correct format
        sendEvent(recordingInterruptedEvent, [
            "reason": reason,
            "isPaused": isPaused,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ])
    }

    func audioStreamManager(_ manager: AudioStreamManager, didReachMaxDuration info: [String: Any]) {
        sendEvent(maxDurationReachedEvent, info)
    }
    
    func audioStreamManager(_ manager: AudioStreamManager, didPauseRecording pauseTime: Date) {
        Logger.debug("AudioStudioModule", "Delegate: didPauseRecording")
        sendEvent(recordingInterruptedEvent, [
            "reason": "userPaused",
            "isPaused": true,
            "timestamp": pauseTime.timeIntervalSince1970 * 1000
        ])
    }
    
    func audioStreamManager(_ manager: AudioStreamManager, didResumeRecording resumeTime: Date) {
        Logger.debug("AudioStudioModule", "Delegate: didResumeRecording")
        sendEvent(recordingInterruptedEvent, [
            "reason": "userResumed",
            "isPaused": false,
            "timestamp": resumeTime.timeIntervalSince1970 * 1000
        ])
    }
    
    func audioStreamManager(_ manager: AudioStreamManager, didUpdateNotificationState isPaused: Bool) {
        Logger.debug("AudioStudioModule", "Delegate: didUpdateNotificationState: isPaused=\(isPaused)")
        sendEvent(recordingInterruptedEvent, [
            "reason": "notification",
            "isPaused": isPaused,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ])
    }
    
    /// Handles the reception of audio data from the AudioStreamManager.
    ///
    /// - Parameters:
    ///   - manager: The AudioStreamManager instance.
    ///   - data: The received audio data.
    ///   - recordingTime: The current recording time.
    ///   - totalDataSize: The total size of the received audio data.
    func audioStreamManager(
        _ manager: AudioStreamManager,
        didReceiveAudioData data: Data,
        recordingTime: TimeInterval,
        totalDataSize: Int64,
        compressionInfo: [String: Any]?
    ) {
        // Reduce log frequency or detail for this potentially high-frequency event
        // Logger.debug("[AudioStudioModule] Delegate: didReceiveAudioData: size=\(data.count), totalSize=\(totalDataSize)")
        var resultDict: [String: Any] = [
            "fileUri": manager.recordingFileURL?.absoluteString ?? "",
            "lastEmittedSize": totalDataSize,
            "deltaSize": data.count,
            "position": Int64(recordingTime * 1000),
            "mimeType": manager.mimeType,
            "totalSize": totalDataSize,
            "streamUuid": manager.recordingUUID?.uuidString ?? UUID().uuidString
        ]

        if manager.recordingSettings?.streamFormat == "float32" {
            let sampleCount = data.count / 2
            var floatArray = [Float](repeating: 0, count: sampleCount)
            data.withUnsafeBytes { ptr in
                let int16Ptr = ptr.bindMemory(to: Int16.self)
                for i in 0..<sampleCount {
                    floatArray[i] = Float(int16Ptr[i]) / 32768.0
                }
            }
            resultDict["pcmFloat32"] = floatArray
        } else {
            resultDict["encoded"] = data.base64EncodedString()
        }
        
        if let compressionInfo = compressionInfo {
            resultDict["compression"] = compressionInfo
        }
        
        sendEvent(audioDataEvent, resultDict)
    }
    
    private func requestNotificationPermissions() async -> Bool {
        do {
            let options: UNAuthorizationOptions = [.alert, .sound]
            return try await notificationCenter.requestAuthorization(options: options)
        } catch {
            Logger.debug("AudioStudioModule", "Failed to request notification permissions: \(error)")
            return false
        }
    }
    
    func audioStreamManager(_ manager: AudioStreamManager, didReceiveProcessingResult result: AudioAnalysisData?) {
        if let data = result {
            Logger.debug("AudioStudioModule", "Delegate: didReceiveProcessingResult: Received \(data.dataPoints.count) data points.")
        } else {
            Logger.debug("AudioStudioModule", "Delegate: didReceiveProcessingResult: Received nil result.")
        }
        let resultDict = result?.toDictionary() ?? [:] 
        sendEvent(audioAnalysisEvent, resultDict)
    }
    
    /// Checks microphone permission and calls the completion handler with the result.
    ///
    /// - Parameters:
    ///   - completion: A completion handler that receives a boolean indicating whether the microphone permission was granted.
    private func checkMicrophonePermission(completion: @escaping (Bool) -> Void) {
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            DispatchQueue.main.async { completion(true) }
        case .denied:
            DispatchQueue.main.async { completion(false) }
        case .undetermined:
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async {
                    completion(granted)
                }
            }
        @unknown default:
            DispatchQueue.main.async { completion(false) }
        }
    }
    
    /// Clears all audio files stored in the document directory.
    private func extractPreviewBars(options: [String: Any], promise: Promise) {
        Logger.debug("AudioStudioModule", "extractPreviewBars called with options: \(options)")
        guard let fileUri = options["fileUri"] as? String else {
            promise.reject("INVALID_ARGUMENTS", "Invalid file URI provided")
            return
        }

        let url = URL(string: fileUri) ?? URL(fileURLWithPath: fileUri.replacingOccurrences(of: "file://", with: ""))
        let numberOfBars = (options["numberOfBars"] as? NSNumber)?.intValue ?? 100
        let startTimeMs = (options["startTimeMs"] as? NSNumber)?.doubleValue
        let endTimeMs = (options["endTimeMs"] as? NSNumber)?.doubleValue
        let decodingOptions = options["decodingOptions"] as? [String: Any]
        let silenceRmsThreshold = (decodingOptions?["silenceRmsThreshold"] as? NSNumber)?.floatValue ?? 0.01

        DispatchQueue.global().async {
            self.resolvePreviewBars(
                url: url,
                numberOfBars: numberOfBars,
                startTimeMs: startTimeMs,
                endTimeMs: endTimeMs,
                silenceRmsThreshold: silenceRmsThreshold,
                promise: promise
            )
        }
    }

    private func resolvePreviewBars(
        url: URL,
        numberOfBars: Int,
        startTimeMs: Double?,
        endTimeMs: Double?,
        silenceRmsThreshold: Float,
        promise: Promise
    ) {
        do {
            let audioProcessor = try previewBarsProcessor(for: url)
            guard let result = audioProcessor.extractPreviewBars(
                numberOfBars: numberOfBars,
                startTimeMs: startTimeMs,
                endTimeMs: endTimeMs,
                silenceRmsThreshold: silenceRmsThreshold
            ) else {
                promise.reject("PROCESSING_ERROR", "Failed to extract preview bars")
                return
            }
            promise.resolve(result)
        } catch {
            promise.reject("PROCESSING_ERROR", "Failed to initialize audio processor: \(error.localizedDescription)")
        }
    }

    private func previewBarsProcessor(for url: URL) throws -> AudioProcessor {
        return try AudioProcessor(url: url, resolve: { _ in
            Logger.warn("AudioStudioModule", "extractPreviewBars: AudioProcessor resolve called unexpectedly.")
        }, reject: { code, message in
            Logger.warn("AudioStudioModule", "extractPreviewBars: AudioProcessor reject called unexpectedly: \(code) - \(message)")
        })
    }

    private func clearAudioFiles() {
        let fileURLs = listAudioFiles()  // This now returns full URLs as strings
        fileURLs.forEach { fileURLString in
            if let fileURL = URL(string: fileURLString) {
                do {
                    try FileManager.default.removeItem(at: fileURL)
                    print("AudioStudioModule", "Removed file at:", fileURL.path)
                } catch {
                    print("AudioStudioModule", "Error removing file at \(fileURL.path):", error.localizedDescription)
                }
            } else {
                print("AudioStudioModule", "Invalid URL string: \(fileURLString)")
            }
        }
    }
    
    /// Extracts feature options from the provided options dictionary.
    ///
    /// - Parameters:
    ///   - options: The options dictionary containing feature flags.
    /// - Returns: A dictionary with feature flags and their boolean values.
    private func extractFeatureOptions(from options: [String: Any]) -> [String: Bool] {
        return [
            "energy": options["energy"] as? Bool ?? false,
            "mfcc": options["mfcc"] as? Bool ?? false,
            "rms": options["rms"] as? Bool ?? false,
            "zcr": options["zcr"] as? Bool ?? false,
            "dB": options["dB"] as? Bool ?? false,
            "spectralCentroid": options["spectralCentroid"] as? Bool ?? false,
            "spectralFlatness": options["spectralFlatness"] as? Bool ?? false,
            "spectralRolloff": options["spectralRolloff"] as? Bool ?? false,
            "spectralBandwidth": options["spectralBandwidth"] as? Bool ?? false,
            "chromagram": options["chromagram"] as? Bool ?? false,
            "tempo": options["tempo"] as? Bool ?? false,
            "hnr": options["hnr"] as? Bool ?? false,
            "melSpectrogram": options["melSpectrogram"] as? Bool ?? false,
            "spectralContrast": options["spectralContrast"] as? Bool ?? false,
            "tonnetz": options["tonnetz"] as? Bool ?? false,
            "pitch": options["pitch"] as? Bool ?? false,
            "crc32": options["crc32"] as? Bool ?? false
        ]
    }
    
    /// Lists all audio files stored in the document directory.
    ///
    /// - Returns: An array of file URIs as strings.
    func listAudioFiles() -> [String] {
        guard let documentDirectory = try? FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false) else {
            print("AudioStudioModule", "Failed to access document directory.")
            return []
        }
        
        do {
            let files = try FileManager.default.contentsOfDirectory(at: documentDirectory, includingPropertiesForKeys: nil)
            let audioFiles = files.filter { $0.pathExtension == "wav" }.map { $0.absoluteString }
            return audioFiles
        } catch {
            print("AudioStudioModule", "Error listing audio files:", error.localizedDescription)
            return []
        }
    }
    
    func audioStreamManager(_ manager: AudioStreamManager, didFailWithError error: String) {
        Logger.error("AudioStudioModule", "Delegate: didFailWithError: \(error)")
        sendEvent(errorEvent, [ "message": error ])
    }
    
    // MARK: - AudioDeviceManagerDelegate
    
    /// Handles device disconnection events from the AudioDeviceManager
    func audioDeviceManager(_ manager: AudioDeviceManager, didDetectDisconnectionOfDevice deviceId: String) {
        Logger.debug("AudioStudioModule", "Device disconnected: \(deviceId)")
        
        // Emit device change event to match Android implementation
        sendEvent(deviceChangedEvent, [
            "type": "deviceDisconnected",
            "deviceId": deviceId
        ])
    }
}
