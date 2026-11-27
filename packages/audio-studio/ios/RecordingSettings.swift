// RecordingSettings.swift

import AVFoundation

struct NotificationAction {
    var title: String
    var identifier: String
}

struct IOSAudioSessionConfig {
    var category: AVAudioSession.Category
    var mode: AVAudioSession.Mode
    var categoryOptions: AVAudioSession.CategoryOptions
}

struct IOSNotificationConfig {
    var categoryIdentifier: String?
}

struct OutputSettings {
    struct PrimaryOutput {
        var enabled: Bool = true
        var format: String = "wav"  // Currently only "wav" is supported
    }

    struct CompressedOutput {
        var enabled: Bool = false
        var format: String = "aac"  // "aac" or "opus" (opus falls back to aac on iOS)
        var bitrate: Int = 128000
        var preferRawStream: Bool = false

        /// AVAudioRecorder picks the AAC container from the file extension: `.aac` gives raw
        /// ADTS, so every streamed chunk can be joined and decoded without a moov atom (#505).
        /// `preferRawStream` only applies to AAC; every other format keeps the `.m4a` filename.
        var fileExtension: String {
            format == "aac" && preferRawStream ? "aac" : "m4a"
        }
    }

    var primary: PrimaryOutput = PrimaryOutput()
    var compressed: CompressedOutput = CompressedOutput()
}

struct CompressedRecordingInfo {
    var compressedFileUri: String
    var mimeType: String
    var bitrate: Int
    var format: String
    var size: Int64 = 0  // Add size with default value

    static func validate(format: String, bitrate: Int) -> Result<(String, Int), Error> {
        // Validate format
        guard ["aac", "opus"].contains(format.lowercased()) else {
            return .failure(RecordingError.unsupportedFormat(format))
        }

        // Adjust bitrate based on format
        let adjustedBitrate: Int
        if format.lowercased() == "aac" {
            // Standard AAC bitrates (bps)
            let standardAACBitrates = [32000, 48000, 64000, 96000, 128000, 160000, 192000, 256000, 320000]
            adjustedBitrate = standardAACBitrates.min(by: { abs($0 - bitrate) < abs($1 - bitrate) }) ?? 128000
        } else {
            // For Opus, allow lower bitrates (especially good for voice)
            // Typical Opus voice bitrates: 8-24 kbps, music: 32-128 kbps
            adjustedBitrate = min(max(bitrate, 8000), 320000)
        }

        return .success((format, adjustedBitrate))
    }
}

struct NotificationConfig {
    var title: String?
    var text: String?
    var icon: String?
    var ios: IOSNotificationConfig?
}

struct IOSConfig {
    var audioSession: IOSAudioSessionConfig?
}

enum RecordingError: Error {
    case unsupportedFormat(String)
    case invalidBitrate(Int)
    case invalidOutputDirectory(String)

    var localizedDescription: String {
        switch self {
        case .unsupportedFormat(let format):
            return "Unsupported compression format: \(format). iOS only supports AAC."
        case .invalidBitrate(let bitrate):
            return "Invalid bitrate: \(bitrate). Must be between 8000 and 960000 bps."
        case .invalidOutputDirectory(let directory):
            return "Invalid output directory: \(directory). Directory does not exist, is not a directory, or is not writable."
        }
    }
}

struct RecordingSettings {
    // Core recording settings
    var sampleRate: Double
    var desiredSampleRate: Double
    var numberOfChannels: Int = 1
    var bitDepth: Int = 16
    var interval: Int?
    var intervalAnalysis: Int?

    // Feature flags
    var keepAwake: Bool = true
    var showNotification: Bool = false
    var enableProcessing: Bool = false

    // Remove pointsPerSecond and algorithm
    var featureOptions: [String: Bool]? = ["rms": true, "zcr": true]

    // iOS-specific configuration
    var ios: IOSConfig?

    // Notification configuration
    var notification: NotificationConfig?

    // Output configuration
    var output: OutputSettings = OutputSettings()

    let autoResumeAfterInterruption: Bool

    var outputDirectory: String? = nil
    var filename: String? = nil

    // Update default to 100ms
    var segmentDurationMs: Int = 100  // Default 100ms segments

    // Add these new properties
    var deviceId: String?
    var deviceDisconnectionBehavior: DeviceDisconnectionBehavior = .FALLBACK
    var bufferDurationSeconds: Double?
    var streamFormat: String = "raw"
    var maxDurationMs: Int64 = 0
    var autoStopOnMaxDuration: Bool = false

    /// startRecording records an enabled Opus request as AAC because AVAudioRecorder cannot
    /// encode Opus. That fallback has always produced an M4A file, so `preferRawStream`
    /// (an AAC option) is cleared to keep the `.m4a` filename. Returns nil when no rewrite applies.
    static func applyingOpusFallback(_ options: [String: Any]) -> [String: Any]? {
        guard var output = options["output"] as? [String: Any],
              var compressed = output["compressed"] as? [String: Any],
              compressed["enabled"] as? Bool == true,
              (compressed["format"] as? String)?.lowercased() == "opus" else {
            return nil
        }
        compressed["format"] = "aac"
        compressed["preferRawStream"] = false
        output["compressed"] = compressed
        var modified = options
        modified["output"] = output
        return modified
    }

    static func fromDictionary(_ dict: [String: Any]) -> Result<RecordingSettings, Error> {
        // Parse output configuration
        var outputSettings = OutputSettings()

        if let outputDict = dict["output"] as? [String: Any] {
            // Parse primary output settings
            if let primaryDict = outputDict["primary"] as? [String: Any] {
                outputSettings.primary.enabled = primaryDict["enabled"] as? Bool ?? true
                outputSettings.primary.format = primaryDict["format"] as? String ?? "wav"
            }

            // Parse compressed output settings
            if let compressedDict = outputDict["compressed"] as? [String: Any] {
                outputSettings.compressed.enabled = compressedDict["enabled"] as? Bool ?? false
                let format = (compressedDict["format"] as? String)?.lowercased() ?? "aac"
                outputSettings.compressed.format = format
                outputSettings.compressed.bitrate = compressedDict["bitrate"] as? Int ?? 128000
                outputSettings.compressed.preferRawStream = compressedDict["preferRawStream"] as? Bool ?? false

                // Validate compression settings if enabled
                if outputSettings.compressed.enabled {
                    if case .failure(let error) = CompressedRecordingInfo.validate(
                        format: format,
                        bitrate: outputSettings.compressed.bitrate
                    ) {
                        return .failure(error)
                    }
                }
            }
        }

        // Add extraction of new properties
        let deviceId = dict["deviceId"] as? String
        let deviceDisconnectionBehaviorStr = dict["deviceDisconnectionBehavior"] as? String

        // Create settings
        var settings = RecordingSettings(
            sampleRate: dict["sampleRate"] as? Double ?? 44100.0,
            desiredSampleRate: dict["desiredSampleRate"] as? Double ?? 44100.0,
            autoResumeAfterInterruption: dict["autoResumeAfterInterruption"] as? Bool ?? false
        )

        settings.output = outputSettings

        // Parse core settings
        settings.numberOfChannels = dict["channels"] as? Int ?? 1
        settings.bitDepth = dict["bitDepth"] as? Int ?? 16
        settings.interval = dict["interval"] as? Int
        settings.intervalAnalysis = dict["intervalAnalysis"] as? Int
        if let maxDurationNumber = dict["maxDurationMs"] as? NSNumber {
            settings.maxDurationMs = maxDurationNumber.int64Value
        }
        settings.autoStopOnMaxDuration = dict["autoStopOnMaxDuration"] as? Bool ?? false
        // Parse feature flags
        settings.keepAwake = dict["keepAwake"] as? Bool ?? true
        settings.showNotification = dict["showNotification"] as? Bool ?? false
        settings.enableProcessing = dict["enableProcessing"] as? Bool ?? false

        settings.featureOptions = dict["features"] as? [String: Bool]

        // Update segmentDurationMs parsing
        settings.segmentDurationMs = dict["segmentDurationMs"] as? Int ?? 100

        // Parse iOS-specific config
        if let iosDict = dict["ios"] as? [String: Any],
           let audioSessionDict = iosDict["audioSession"] as? [String: Any] {

            // Map category
            let category: AVAudioSession.Category
            if let categoryStr = audioSessionDict["category"] as? String {
                switch categoryStr {
                    case "Ambient": category = .ambient
                    case "SoloAmbient": category = .soloAmbient
                    case "Playback": category = .playback
                    case "Record": category = .record
                    case "PlayAndRecord": category = .playAndRecord
                    case "MultiRoute": category = .multiRoute
                    default: category = .record
                }
            } else {
                category = .record
            }

            // Map mode
            let mode: AVAudioSession.Mode
            if let modeStr = audioSessionDict["mode"] as? String {
                switch modeStr {
                    case "Default": mode = .default
                    case "VoiceChat": mode = .voiceChat
                    case "VideoChat": mode = .videoChat
                    case "GameChat": mode = .gameChat
                    case "VideoRecording": mode = .videoRecording
                    case "Measurement": mode = .measurement
                    case "MoviePlayback": mode = .moviePlayback
                    case "SpokenAudio": mode = .spokenAudio
                    default: mode = .default
                }
            } else {
                mode = .default
            }

            // Map category options
            var categoryOptions: AVAudioSession.CategoryOptions = []
            if let optionsArray = audioSessionDict["categoryOptions"] as? [String] {
                for option in optionsArray {
                    switch option {
                        case "MixWithOthers": categoryOptions.insert(.mixWithOthers)
                        case "DuckOthers": categoryOptions.insert(.duckOthers)
                        case "InterruptSpokenAudioAndMixWithOthers": categoryOptions.insert(.interruptSpokenAudioAndMixWithOthers)
                        case "AllowBluetooth": categoryOptions.insert(.allowBluetooth)
                        case "AllowBluetoothA2DP": categoryOptions.insert(.allowBluetoothA2DP)
                        case "AllowAirPlay": categoryOptions.insert(.allowAirPlay)
                        case "DefaultToSpeaker": categoryOptions.insert(.defaultToSpeaker)
                        default: break
                    }
                }
            }

            settings.ios = IOSConfig(audioSession: IOSAudioSessionConfig(
                category: category,
                mode: mode,
                categoryOptions: categoryOptions
            ))
        }

        // Parse notification config
        if let notificationDict = dict["notification"] as? [String: Any] {
            var notificationConfig = NotificationConfig()
            notificationConfig.title = notificationDict["title"] as? String
            notificationConfig.text = notificationDict["text"] as? String
            notificationConfig.icon = notificationDict["icon"] as? String

            // Parse iOS-specific notification config
            if let iosNotificationDict = notificationDict["ios"] as? [String: Any] {
                notificationConfig.ios = IOSNotificationConfig(
                    categoryIdentifier: iosNotificationDict["categoryIdentifier"] as? String
                )
            }

            settings.notification = notificationConfig
        }

        // Parse output settings (they remain nil if not provided)
        if let directory = dict["outputDirectory"] as? String {
            // Only validate if a custom directory is provided
            let fileManager = FileManager.default
            var isDirectory: ObjCBool = false

            // Clean up the directory path by removing file:// protocol if present
            let cleanDirectory = directory.replacingOccurrences(of: "file://", with: "")
                .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                .replacingOccurrences(of: "//", with: "/")

            if !fileManager.fileExists(atPath: cleanDirectory, isDirectory: &isDirectory) {
                return .failure(RecordingError.invalidOutputDirectory("Directory does not exist: \(cleanDirectory)"))
            }

            if !isDirectory.boolValue {
                return .failure(RecordingError.invalidOutputDirectory("Path is not a directory: \(cleanDirectory)"))
            }

            if !fileManager.isWritableFile(atPath: cleanDirectory) {
                return .failure(RecordingError.invalidOutputDirectory("Directory is not writable: \(cleanDirectory)"))
            }

            settings.outputDirectory = cleanDirectory
        }

        settings.filename = dict["filename"] as? String

        // Set new properties
        settings.deviceId = deviceId
        settings.deviceDisconnectionBehavior = DeviceDisconnectionBehavior(rawValue: deviceDisconnectionBehaviorStr ?? "fallback") ?? .FALLBACK

        if let bufferDuration = dict["bufferDurationSeconds"] as? Double {
            settings.bufferDurationSeconds = bufferDuration
        }

        settings.streamFormat = dict["streamFormat"] as? String ?? "raw"

        return .success(settings)
    }
}
