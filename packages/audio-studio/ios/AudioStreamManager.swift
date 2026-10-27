//
//  AudioStreamManager.swift
//  AudioStudio
//
//  Created by Arthur Breton on 21/4/2024.
//

import Foundation
import AVFoundation
import Accelerate
import UIKit
import MediaPlayer
import UserNotifications
import QuartzCore

// Constants
internal let MIN_AAC_COMPRESSED_SAMPLE_RATE: Double = 44100.0

// Helper to convert to little-endian byte array
extension UInt32 {
    var littleEndianBytes: [UInt8] {
        let value = self.littleEndian
        return [UInt8(value & 0xff), UInt8((value >> 8) & 0xff), UInt8((value >> 16) & 0xff), UInt8((value >> 24) & 0xff)]
    }
}

extension UInt16 {
    var littleEndianBytes: [UInt8] {
        let value = self.littleEndian
        return [UInt8(value & 0xff), UInt8((value >> 8) & 0xff)]
    }
}

// Define DeviceDisconnectionBehavior enum mirroring AudioStudio.types.ts
class AudioStreamManager: NSObject, AudioDeviceManagerDelegate {
    private let audioEngine = AVAudioEngine()
    private var inputNode: AVAudioInputNode {
        return audioEngine.inputNode
    }
    internal var recordingFileURL: URL?
    private var audioProcessor: AudioProcessor?
    private var fileHandle: FileHandle?
    /// Set once the primary WAV has stopped accepting writes and could not be recovered.
    ///
    /// Only read and written on `fileWriteQueue`. Without it a failing handle would report
    /// on every dropped buffer — dozens per second — so the delegate is told once and the
    /// remaining appends fail quietly (#420).
    private var primaryWriteFailureReported = false
    private var startTime: Date?
    private var totalPausedDuration: TimeInterval = 0  // Track total paused time
    private var currentPauseStart: Date?              // Track current pause start
    private var maxDurationTimer: DispatchSourceTimer?
    private var maxDurationTargetMs: Int64 = 0
    private var maxDurationAccumulatedActiveMs: Double = 0
    private var maxDurationSegmentStart: CFTimeInterval?
    private var maxDurationReached: Bool = false
    var isRecording = false
    var isPaused = false
    var isPrepared = false  // Add this new state flag
    
    // Move static variables to class level
    private var debugBufferCounter = 0
    private var tapCallCount = 0
    
    // Wake lock related properties
    private var wasIdleTimerDisabled: Bool = false  // Track previous idle timer state
    private var isWakeLockEnabled: Bool = false     // Track current wake lock state

    // Data emission for onAudioStream
    internal var lastEmissionTime: Date?
    internal var lastEmittedSize: Int64 = 0
    internal var lastEmittedCompressedSize: Int64 = 0
    private var totalDataSize: Int64 = 0
    private var lastBufferTime: AVAudioTime?
    /// Guarded by `accumulatedDataLock`.
    private var accumulatedData = Data()

    // Data emission for onAudioAnalysis
    internal var lastEmissionTimeAnalysis: Date?
    internal var lastEmittedSizeAnalysis: Int64 = 0
    internal var lastEmittedCompressedSizeAnalysis: Int64 = 0
    private var totalDataSizeAnalysis: Int64 = 0
    private var lastBufferTimeAnalysis: AVAudioTime?
    /// Guarded by `accumulatedDataLock`.
    private var accumulatedAnalysisData = Data()

    // Guards accumulatedData and accumulatedAnalysisData. The audio tap
    // appends from the render thread while emit/pause/stop snapshot-and-clear
    // from other threads. Without this lock, base64EncodedString crashed
    // mid-flush (issue #314) and short emissions were occasionally dropped.
    private let accumulatedDataLock = NSLock()

    /// Serial queue owning every write to the primary WAV file.
    ///
    /// PCM blocks were appended on the global concurrent utility queue, which gives
    /// no ordering guarantee against the final header rewrite in stopRecording().
    /// A serial queue makes "all appends done" something stopRecording() can wait
    /// for (issue #424).
    private let fileWriteQueue = DispatchQueue(
        label: "net.siteed.audiostudio.filewrite",
        qos: .utility
    )

    /// Append the same chunk to both buffers under the lock.
    /// Called from the audio tap thread.
    private func appendAccumulated(_ data: Data) {
        accumulatedDataLock.lock()
        accumulatedData.append(data)
        accumulatedAnalysisData.append(data)
        accumulatedDataLock.unlock()
    }

    /// Atomically snapshot accumulatedData and clear it. Empty Data if buffer was empty.
    private func takeAccumulatedSnapshot() -> Data {
        accumulatedDataLock.lock()
        defer { accumulatedDataLock.unlock() }
        let snapshot = accumulatedData
        accumulatedData.removeAll()
        return snapshot
    }

    /// Atomically snapshot accumulatedAnalysisData and clear it.
    private func takeAccumulatedAnalysisSnapshot() -> Data {
        accumulatedDataLock.lock()
        defer { accumulatedDataLock.unlock() }
        let snapshot = accumulatedAnalysisData
        accumulatedAnalysisData.removeAll()
        return snapshot
    }

    /// Clear both buffers atomically (lifecycle resets).
    private func resetAccumulated() {
        accumulatedDataLock.lock()
        accumulatedData.removeAll()
        accumulatedAnalysisData.removeAll()
        accumulatedDataLock.unlock()
    }

    /// Current size of accumulatedData for logs/probes.
    private func accumulatedDataSize() -> Int {
        accumulatedDataLock.lock()
        defer { accumulatedDataLock.unlock() }
        return accumulatedData.count
    }



    private var fileManager = FileManager.default
    internal var recordingSettings: RecordingSettings?
    internal var recordingUUID: UUID?
    internal var mimeType: String = "audio/wav"
    private var recentData = [Float]() // This property stores the recent audio data
    private var notificationUpdateTimer: Timer?
    
    private var notificationManager: AudioNotificationManager?
    private var notificationView: MPNowPlayingInfoCenter?
    private var audioSession: AVAudioSession?
    private var notificationObserver: Any?
    private var mediaInfoUpdateTimer: Timer?
    private var remoteCommandCenter: MPRemoteCommandCenter?

    weak var delegate: AudioStreamManagerDelegate?  // Define the delegate here
        
    private var lastValidDuration: TimeInterval?  // Add this property
    
    private var compressedRecorder: AVAudioRecorder?
    private var compressedFileURL: URL?
    private var compressedFormat: String = "aac"
    private var compressedBitRate: Int = 128000
    
    // Add property to track auto-resume preference
    private var autoResumeAfterInterruption: Bool = false
    private var pausedBySystemInterruption: Bool = false
    
    // Add these properties
    private var emissionInterval: TimeInterval = 1.0  // Default 1 second
    private var emissionIntervalAnalysis: TimeInterval = 0.5  // Default 0.5 seconds

    // ---> ADD BACK deviceManager PROPERTY <--- 
    private let deviceManager = AudioDeviceManager()

    // Add the stopping flag to the class properties
    private var stopping: Bool = false
    
    // Performance optimization: Cache file sizes during recording
    private var cachedWavFileSize: Int64 = 0
    private var cachedCompressedFileSize: Int64 = 0

    /// Returns an AVAudioRecorder-compatible sample rate for AAC sidecar files.
    ///
    /// The primary WAV path can resample emitted PCM to `settings.sampleRate`,
    /// but the compressed sidecar is produced by AVAudioRecorder directly from
    /// the active audio session. AVAudioRecorder fails to prepare AAC/M4A files
    /// below 44.1 kHz, so keep valid requested rates and otherwise use the
    /// active session rate when available, falling back to 44.1 kHz.
    internal static func compatibleAACCompressedSampleRate(
        requestedSampleRate: Double,
        sessionSampleRate: Double
    ) -> Double {
        if requestedSampleRate >= MIN_AAC_COMPRESSED_SAMPLE_RATE {
            return requestedSampleRate
        }

        if sessionSampleRate.isFinite && sessionSampleRate >= MIN_AAC_COMPRESSED_SAMPLE_RATE {
            return sessionSampleRate
        }

        return MIN_AAC_COMPRESSED_SAMPLE_RATE
    }

    /// Initializes the AudioStreamManager
    override init() {
        super.init()
        deviceManager.delegate = self // Set the delegate
        // Only keep audio session interruption observer here
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioSessionInterruption),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAppDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAppWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )

    }
    
    deinit {
        // Ensure wake lock is disabled when the manager is deallocated
        disableWakeLock()
        
        // Stop any active recording to properly release resources
        if isRecording {
            audioEngine.stop()
            audioEngine.reset()
        }
        
        // Remove ALL notification observers properly
        NotificationCenter.default.removeObserver(self)
        
        // Clean up notification manager
        notificationManager?.stopUpdates()
        notificationManager = nil
        
        // Cleanup media timer
        mediaInfoUpdateTimer?.invalidate()
        mediaInfoUpdateTimer = nil
    }
    
    /// Handles an audio session interruption.
    @objc private func handleAudioSessionInterruption(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }
        
        let wasSuspended = isPaused
        
        switch type {
        case .began:
            Logger.debug("AudioStreamManager", "Audio session interruption began")
            // Store the pause start time if not already paused
            if !wasSuspended {
                currentPauseStart = Date()
                pauseRecording(isSystemInterruption: true)
            }
            
            // Always notify delegate of interruption
            delegate?.audioStreamManager(
                self,
                didReceiveInterruption: [
                    "type": "began",
                    "wasSuspended": wasSuspended
                ]
            )
            
        case .ended:
            Logger.debug("AudioStreamManager", "Audio session interruption ended - autoResume: \(autoResumeAfterInterruption), wasSuspended: \(wasSuspended)")
            let options = InterruptionOptionsPolicy.options(from: userInfo)
            Logger.debug("AudioStreamManager", "Interruption options - shouldResume: \(options.contains(.shouldResume))")

            // Auto-resume only if this interruption paused the recording.
            // If the user had already paused, preserve that intent.
            // Keep currentPauseStart active until the actual resume so duration accounting
            // excludes the full paused interval, including any post-interruption delay.
            if AutoResumePolicy.shouldAutoResume(
                autoResumeAfterInterruption: autoResumeAfterInterruption,
                isRecording: isRecording,
                isPaused: isPaused,
                pausedBySystemInterruption: pausedBySystemInterruption
            ) {
                // Add a longer delay for phone calls and ensure proper session setup
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                    guard let self = self else { return }
                    Logger.debug("AudioStreamManager", "Attempting to auto-resume recording after phone call")

                    // Configure audio session
                    do {
                        let session = AVAudioSession.sharedInstance()
                        let resumeOptions: AVAudioSession.CategoryOptions = self.recordingSettings?.ios?.audioSession?.categoryOptions ?? [.allowBluetooth, .mixWithOthers]
                        try session.setCategory(.playAndRecord, mode: .default, options: resumeOptions)
                        try session.setActive(true, options: .notifyOthersOnDeactivation)

                        // Resume if we're still recording and paused
                        if self.isRecording && self.isPaused {
                            Logger.debug("AudioStreamManager", "Resuming recording after phone call interruption")
                            self.audioEngine.prepare()
                            self.resumeRecording()
                        } else {
                            Logger.debug("AudioStreamManager", "Cannot resume - recording state invalid: isRecording=\(self.isRecording), isPaused=\(self.isPaused)")
                        }
                    } catch {
                        Logger.debug("AudioStreamManager", "Failed to reactivate audio session: \(error)")
                        self.delegate?.audioStreamManager(self, didFailWithError: "Failed to auto-resume: \(error.localizedDescription)")
                    }
                }
            }

            // Always notify delegate of interruption end
            delegate?.audioStreamManager(
                self,
                didReceiveInterruption: [
                    "type": "ended",
                    "wasSuspended": wasSuspended,
                    "shouldResume": options.contains(.shouldResume)
                ]
            )
        @unknown default:
            break
        }
    }
    
    private func setupNowPlayingInfo() {
        // Session is already configured by configureAudioSession(); do not override it here.
        audioSession = AVAudioSession.sharedInstance()

        // Setup Now Playing info
        notificationView = MPNowPlayingInfoCenter.default()
        updateNowPlayingInfo(isPaused: false)
        
        // Configure Remote Command Center
        setupRemoteCommandCenter()
        
        // Enable remote control events on main thread
        DispatchQueue.main.async {
            UIApplication.shared.beginReceivingRemoteControlEvents()
        }
    }
    
    private func setupRemoteCommandCenter() {
        remoteCommandCenter = MPRemoteCommandCenter.shared()
        
        // Remove any existing handlers
        remoteCommandCenter?.pauseCommand.removeTarget(nil)
        remoteCommandCenter?.playCommand.removeTarget(nil)
        
        // Add pause command handler
        remoteCommandCenter?.pauseCommand.addTarget { [weak self] _ in
            guard let self = self, self.isRecording && !self.isPaused else {
                return .commandFailed
            }
            self.pauseRecording()
            return .success
        }
        
        // Add play/resume command handler
        remoteCommandCenter?.playCommand.addTarget { [weak self] _ in
            guard let self = self, self.isRecording && self.isPaused else {
                return .commandFailed
            }
            self.resumeRecording()
            return .success
        }
        
        // Enable the commands
        remoteCommandCenter?.pauseCommand.isEnabled = true
        remoteCommandCenter?.playCommand.isEnabled = true
        
        // Disable unused commands
        remoteCommandCenter?.nextTrackCommand.isEnabled = false
        remoteCommandCenter?.previousTrackCommand.isEnabled = false
        remoteCommandCenter?.changePlaybackRateCommand.isEnabled = false
        remoteCommandCenter?.seekBackwardCommand.isEnabled = false
        remoteCommandCenter?.seekForwardCommand.isEnabled = false
    }
    
    private func updateNowPlayingInfo(isPaused: Bool) {
        var nowPlayingInfo = [String: Any]()
        
        // Set media title and artist
        nowPlayingInfo[MPMediaItemPropertyTitle] = recordingSettings?.notification?.title ?? "Recording in Progress"
        nowPlayingInfo[MPMediaItemPropertyArtist] = "Audio Stream"
        
        // Set playback state
        nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPaused ? 0.0 : 1.0
        nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentRecordingDuration()
        
        // Add placeholder image if available
        if let image = UIImage(named: "recording_icon") {
            nowPlayingInfo[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { size in
                return image
            }
        }
        
        // Update the info on main thread
        DispatchQueue.main.async {
            self.notificationView?.nowPlayingInfo = nowPlayingInfo
        }
    }
    
    func currentRecordingDuration() -> TimeInterval {
        // If we're paused, return the last valid duration
        if isPaused, let lastDuration = lastValidDuration {
            return lastDuration
        }
        
        // Safety check: if recording but no start time, use current time
        if isRecording && startTime == nil {
            Logger.debug("AudioStreamManager", "WARNING: Recording active but startTime is nil, setting to current time")
            startTime = Date()
        }
        
        guard let startTime = self.startTime else { return 0 }
        
        let now = Date()
        var duration = now.timeIntervalSince(startTime)
        
        // Subtract total paused duration
        duration -= TimeInterval(totalPausedDuration)
        
        // If we're currently in a pause (including background pause for !keepAwake), subtract that too
        if let pauseStart = currentPauseStart {
            duration -= now.timeIntervalSince(pauseStart)
        }
        
        return duration
    }
    
    private func cleanupNotificationObservers() {
        NotificationCenter.default.removeObserver(self)
    }
    
    @objc private func handlePauseNotification(_ notification: Notification) {
        // Only handle if recording and notifications are enabled
        guard isRecording, recordingSettings?.showNotification == true else { return }
        pauseRecording()
    }
    
    @objc private func handleResumeNotification(_ notification: Notification) {
        // Only handle if recording and notifications are enabled
        guard isRecording, recordingSettings?.showNotification == true else { return }
        resumeRecording()
    }
    
    @objc private func handlePauseAction() {
        pauseRecording()
        updateNotificationState(isPaused: true)
    }

    @objc private func handleResumeAction() {
        resumeRecording()
        updateNotificationState(isPaused: false)
    }
    
    @objc private func handleAppDidEnterBackground(_ notification: Notification) {
        // Skip if we're in the process of stopping - this prevents race conditions
        if !isRecording || stopping {
            return
        }
        
        // If keepAwake is false, we should track this as a pause and actually pause the engine
        if let settings = recordingSettings, !settings.keepAwake {
            Logger.debug("AudioStreamManager", "App entering background with keepAwake=false, pausing recording")
            currentPauseStart = Date()
            // Explicitly pause the engine but don't change isPaused state
            // so we can automatically resume when returning to foreground
            audioEngine.pause()
        } else {
            Logger.debug("AudioStreamManager", "App entering background with keepAwake=true, continuing recording")
        }
        
        // Use a strong reference to notificationManager to avoid potential null reference
        if let manager = notificationManager {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self = self, self.isRecording, !self.stopping else { return }
                manager.showInitialNotification()
            }
        }
    }

    @objc private func handleAppWillEnterForeground(_ notification: Notification) {
        // Skip if we're in the process of stopping
        if !isRecording || stopping {
            return
        }
        
        // If we were paused due to background and keepAwake was false, calculate pause duration
        if let settings = recordingSettings, !settings.keepAwake, let pauseStart = currentPauseStart {
            let pauseDuration = Date().timeIntervalSince(pauseStart)
            totalPausedDuration += pauseDuration
            currentPauseStart = nil
            Logger.debug("AudioStreamManager", "Added background pause duration: \(pauseDuration), total paused: \(totalPausedDuration)")
            
            // Now restart the engine if it was paused due to background
            do {
                // Reinstall tap with hardware format to ensure we have good input
                let tapInstall = installTapWithHardwareFormat()
                guard tapInstall.installed else {
                    throw NSError(
                        domain: "AudioStreamManager",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Failed to install audio tap after returning from background"]
                    )
                }
                // Restart the engine
                try audioEngine.start()
                Logger.debug("AudioStreamManager", "Successfully restarted audio engine after returning from background")
            } catch {
                Logger.debug("AudioStreamManager", "Failed to restart audio engine after returning from background: \(error)")
                // If we can't restart, officially pause the recording
                if !isPaused {
                    isPaused = true
                    pausedBySystemInterruption = false
                    // Notify delegate
                    delegate?.audioStreamManager(self, didPauseRecording: Date())
                }
            }
        }
        
        // Safely access notificationManager
        if let manager = notificationManager {
            manager.stopUpdates()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                guard let self = self, self.isRecording, !self.stopping else { return }
                manager.startUpdates(startTime: self.startTime ?? Date())
            }
        }
    }
    
    private func updateNotificationState(isPaused: Bool) {
        // Calculate current duration
        let currentDuration: TimeInterval
        if let startTime = startTime {
            currentDuration = Date().timeIntervalSince(startTime) - TimeInterval(totalPausedDuration)
        } else {
            currentDuration = 0
        }

        // Update Now Playing info
        var nowPlayingInfo = notificationView?.nowPlayingInfo ?? [:]
        nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPaused ? 0.0 : 1.0
        nowPlayingInfo[MPMediaItemPropertyTitle] = isPaused ?
            "Recording Paused" :
            (recordingSettings?.notification?.title ?? "Recording in Progress")
        nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentDuration
        notificationView?.nowPlayingInfo = nowPlayingInfo

        // Delegate notification update to AudioNotificationManager
        notificationManager?.updateState(isPaused: isPaused)
    }
    
    private func updateMediaInfo() {
        guard let startTime = startTime else { return }
        
        let currentDuration = Date().timeIntervalSince(startTime) - TimeInterval(totalPausedDuration)
        
        var nowPlayingInfo = notificationView?.nowPlayingInfo ?? [:]
        nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentDuration
        nowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPaused ? 0.0 : 1.0
        notificationView?.nowPlayingInfo = nowPlayingInfo
    }
    
    /// Enables the wake lock to prevent screen dimming
    private func enableWakeLock() {
        guard let settings = recordingSettings,
              settings.keepAwake, // Only proceed if keepAwake is true
              !isWakeLockEnabled // Only proceed if wake lock isn't already enabled
        else { return }
        
        DispatchQueue.main.async {
            self.wasIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
            UIApplication.shared.isIdleTimerDisabled = true
            self.isWakeLockEnabled = true
            Logger.debug("AudioStreamManager", "Wake lock enabled")
        }
    }
    
    /// Disables the wake lock and restores previous screen dimming state
    private func disableWakeLock() {
        guard let settings = recordingSettings,
              settings.keepAwake, // Only proceed if keepAwake is true
              isWakeLockEnabled  // Only proceed if wake lock is currently enabled
        else { return }
        
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = self.wasIdleTimerDisabled
            self.isWakeLockEnabled = false
            Logger.debug("AudioStreamManager", "Wake lock disabled")
        }
    }
    
    /// Creates a new recording file.
    /// - Returns: The URL of the newly created recording file, or nil if creation failed.
    private func createRecordingFile(isCompressed: Bool = false) -> URL? {
        // Add debug logging
        Logger.debug("AudioStreamManager", "Creating recording file - settings filename: \(recordingSettings?.filename ?? "nil")")
        
        // Get base directory - use default if no custom directory provided
        let baseDirectory: URL
        if let customDir = recordingSettings?.outputDirectory {
            baseDirectory = URL(fileURLWithPath: customDir)
            Logger.debug("AudioStreamManager", "Using custom directory: \(customDir)")
        } else {
            // Use existing default behavior
            baseDirectory = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
            Logger.debug("AudioStreamManager", "Using default directory: \(baseDirectory.path)")
        }
        
        // Generate or reuse UUID for filename
        let baseFilename: String
        if let existingFilename = recordingSettings?.filename {
            baseFilename = existingFilename
        } else {
            // Always create a new UUID for recording unless a filename is provided
            let newUUID = UUID()
            recordingUUID = newUUID
            baseFilename = newUUID.uuidString
        }
        Logger.debug("AudioStreamManager", "Using base filename: \(baseFilename)")
        
        // Remove any existing extension from the filename
        let filenameWithoutExtension = baseFilename.replacingOccurrences(
            of: "\\.[^\\.]+$",
            with: "",
            options: .regularExpression
        )
        
        // Choose extension based on whether this is a compressed file
        let fileExtension: String
        if isCompressed, let compressed = recordingSettings?.output.compressed, compressed.format == "aac", compressed.preferRawStream {
            // Raw ADTS AAC: every streamed chunk is independently decodable
            fileExtension = "aac"
        } else if isCompressed {
            // iOS produces an M4A container when using AAC or Opus formats
            // Opus falls back to AAC in M4A container on iOS
            fileExtension = "m4a"
        } else {
            fileExtension = "wav"
        }
        
        let fullFilename = "\(filenameWithoutExtension).\(fileExtension)"
        Logger.debug("AudioStreamManager", "Full filename: \(fullFilename)")
        
        let fileURL = baseDirectory.appendingPathComponent(fullFilename)
        Logger.debug("AudioStreamManager", "Final file URL: \(fileURL.path)")
        
        // Check if file already exists
        if fileManager.fileExists(atPath: fileURL.path) {
            Logger.debug("AudioStreamManager", "File already exists at: \(fileURL.path)")
            return nil
        }
        
        if !fileManager.createFile(atPath: fileURL.path, contents: nil, attributes: nil) {
            Logger.debug("AudioStreamManager", "Failed to create file at: \(fileURL.path)")
            return nil
        }
        return fileURL
    }
    
    /// Creates a WAV header for the given data size.
    /// - Parameter dataSize: The size of the audio data.
    /// - Returns: A Data object containing the WAV header.
    private func createWavHeader(dataSize: Int) -> Data {
        var header = Data()
        
        let sampleRate = UInt32(recordingSettings!.sampleRate)
        let channels = UInt32(recordingSettings!.numberOfChannels)
        let bitDepth = UInt32(recordingSettings!.bitDepth)
        
        let blockAlign = channels * (bitDepth / 8)
        let byteRate = sampleRate * blockAlign
        
        // "RIFF" chunk descriptor
        header.append(contentsOf: "RIFF".utf8)
        header.append(contentsOf: UInt32(36 + dataSize).littleEndianBytes)
        header.append(contentsOf: "WAVE".utf8)
        
        // "fmt " sub-chunk
        header.append(contentsOf: "fmt ".utf8)
        header.append(contentsOf: UInt32(16).littleEndianBytes)  // PCM format requires 16 bytes for the fmt sub-chunk
        header.append(contentsOf: UInt16(1).littleEndianBytes)   // Audio format 1 for PCM
        header.append(contentsOf: UInt16(channels).littleEndianBytes)
        header.append(contentsOf: sampleRate.littleEndianBytes)
        header.append(contentsOf: byteRate.littleEndianBytes)    // byteRate
        header.append(contentsOf: UInt16(blockAlign).littleEndianBytes)  // blockAlign
        header.append(contentsOf: UInt16(bitDepth).littleEndianBytes)  // bits per sample
        
        // "data" sub-chunk
        header.append(contentsOf: "data".utf8)
        header.append(contentsOf: UInt32(dataSize).littleEndianBytes)  // Sub-chunk data size
        
        return header
    }
    
    /// Gets the current status of the recording.
    /// - Returns: A dictionary containing the recording status information.
    func getStatus() -> [String: Any] {
        let durationInSeconds = currentRecordingDuration()
        let durationInMilliseconds = Int(durationInSeconds * 1000)
        let settings = recordingSettings
        
        var status: [String: Any] = [
            "durationMs": durationInMilliseconds,
            "isRecording": isRecording,
            "isPaused": isPaused,
            "mimeType": mimeType,
            "size": totalDataSize,
            "maxDurationReached": maxDurationReached
        ]

        let statusMaxDurationMs = settings?.maxDurationMs ?? maxDurationTargetMs
        if statusMaxDurationMs > 0 {
            status["maxDurationMs"] = statusMaxDurationMs
        }
        
        // Safely handle optional interval values
        if let interval = settings?.interval {
            status["interval"] = interval
        } else {
            status["interval"] = 1000 // Default value
        }
        
        if let intervalAnalysis = settings?.intervalAnalysis {
            status["intervalAnalysis"] = intervalAnalysis
        } else {
            status["intervalAnalysis"] = 500 // Default value
        }
        
        // Add compression info if enabled
        if settings?.output.compressed.enabled == true,
           let compressedURL = compressedFileURL,
           FileManager.default.fileExists(atPath: compressedURL.path) {
            do {
                let compressedAttributes = try FileManager.default.attributesOfItem(atPath: compressedURL.path)
                if let compressedSize = compressedAttributes[.size] as? Int64 {
                    Logger.debug("AudioStreamManager", "Compressed file status - Size: \(compressedSize)")
                    let compressionBundle: [String: Any] = [
                        "fileUri": compressedURL.absoluteString,
                        "mimeType": compressedFormat == "aac" ? "audio/aac" : "audio/opus",
                        "size": compressedSize,
                        "format": compressedFormat,
                        "bitrate": compressedBitRate
                    ]
                    status["compression"] = compressionBundle
                }
            } catch {
                Logger.debug("AudioStreamManager", "Error getting compressed file attributes: \(error)")
            }
        }
        
        return status
    }

    private func maxDurationActiveMs(now: CFTimeInterval = CACurrentMediaTime()) -> Double {
        if let segmentStart = maxDurationSegmentStart {
            return maxDurationAccumulatedActiveMs + ((now - segmentStart) * 1000)
        }
        return maxDurationAccumulatedActiveMs
    }

    private func startMaxDurationTimer(settings: RecordingSettings) {
        cancelMaxDurationTimer()
        maxDurationReached = false
        maxDurationTargetMs = settings.maxDurationMs
        maxDurationAccumulatedActiveMs = 0
        maxDurationSegmentStart = nil
        guard settings.maxDurationMs > 0 else { return }

        maxDurationSegmentStart = CACurrentMediaTime()
        scheduleMaxDurationTimer()
    }

    private func scheduleMaxDurationTimer() {
        guard maxDurationTargetMs > 0, !maxDurationReached, isRecording, !isPaused else {
            return
        }

        maxDurationTimer?.cancel()
        let remainingMs = max(0, Double(maxDurationTargetMs) - maxDurationActiveMs())
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        timer.schedule(deadline: .now() + .milliseconds(Int(remainingMs.rounded(.up))))
        timer.setEventHandler { [weak self] in
            self?.maxDurationTimer = nil
            self?.emitMaxDurationReached()
        }
        maxDurationTimer = timer
        timer.resume()
    }

    private func pauseMaxDurationTimer() {
        maxDurationTimer?.cancel()
        maxDurationTimer = nil
        if maxDurationSegmentStart != nil {
            maxDurationAccumulatedActiveMs = maxDurationActiveMs()
            maxDurationSegmentStart = nil
        }
    }

    private func resumeMaxDurationTimer() {
        guard maxDurationTargetMs > 0, !maxDurationReached else { return }
        maxDurationSegmentStart = CACurrentMediaTime()
        scheduleMaxDurationTimer()
    }

    private func cancelMaxDurationTimer() {
        maxDurationTimer?.cancel()
        maxDurationTimer = nil
        maxDurationSegmentStart = nil
        if !maxDurationReached {
            maxDurationTargetMs = 0
            maxDurationAccumulatedActiveMs = 0
        }
    }

    private func emitMaxDurationReached() {
        guard maxDurationTargetMs > 0, !maxDurationReached else { return }
        guard isRecording, !isPaused else { return }

        let durationMs = Int64(maxDurationActiveMs().rounded())
        maxDurationReached = true
        let shouldAutoStop = recordingSettings?.autoStopOnMaxDuration == true
        delegate?.audioStreamManager(self, didReachMaxDuration: [
            "durationMs": durationMs,
            "maxDurationMs": maxDurationTargetMs,
            "overrunMs": max(Int64(0), durationMs - maxDurationTargetMs),
            "streamUuid": recordingUUID ?? "",
            "autoStopped": shouldAutoStop
        ])
        if shouldAutoStop {
            _ = stopRecording()
        }
    }

    /// Builds compression info dictionary with incremental compressed data for streaming events.
    /// Mirrors the Android pattern (AudioRecorderManager.kt) for consistent cross-platform behavior.
    /// - Returns: A dictionary containing compression metadata and base64-encoded data chunk, or nil if compression is disabled.
    private func buildCompressionInfo() -> [String: Any]? {
        guard let settings = recordingSettings,
              settings.output.compressed.enabled,
              let compressedURL = compressedFileURL,
              FileManager.default.fileExists(atPath: compressedURL.path) else {
            return nil
        }

        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: compressedURL.path)
            guard let compressedSize = attributes[.size] as? Int64 else { return nil }

            let eventDataSize = compressedSize - lastEmittedCompressedSize

            var info: [String: Any] = [
                "position": lastEmittedCompressedSize,
                "fileUri": compressedURL.absoluteString,
                "eventDataSize": eventDataSize,
                "totalSize": compressedSize,
                "size": compressedSize,
                "mimeType": compressedFormat == "aac" ? "audio/aac" : "audio/opus",
                "bitrate": compressedBitRate,
                "format": compressedFormat
            ]

            // Read incremental chunk if there is new data
            if eventDataSize > 0 {
                let fileHandle = try FileHandle(forReadingFrom: compressedURL)
                defer { fileHandle.closeFile() }
                fileHandle.seek(toFileOffset: UInt64(lastEmittedCompressedSize))
                let chunkData = fileHandle.readData(ofLength: Int(eventDataSize))
                info["data"] = chunkData.base64EncodedString()
            }

            lastEmittedCompressedSize = compressedSize
            cachedCompressedFileSize = compressedSize

            return info
        } catch {
            Logger.debug("AudioStreamManager", "Error building compression info: \(error)")
            return nil
        }
    }

    /// Detects if a phone call is active without using CallKit.
    /// We avoid CallKit because its usage prevents apps from being available in China's App Store.
    /// This is a workaround that uses AVAudioSession to detect phone calls instead.
    private func isPhoneCallActive() -> Bool {
        let audioSession = AVAudioSession.sharedInstance()
        return audioSession.isOtherAudioPlaying && 
               audioSession.secondaryAudioShouldBeSilencedHint && 
               audioSession.currentRoute.outputs.contains { $0.portType == .builtInReceiver }
    }

    /// Installs the audio tap with the hardware-compatible format
    /// - Parameters:
    ///   - customTapBlock: Optional custom tap block for specialized processing (like in fallback)
    ///   - prepareEngine: Whether to call prepare() on the engine after installing the tap (default: true)
    /// - Returns: The hardware input format that was used for the tap
    private func installTapWithHardwareFormat(
        customTapBlock: ((AVAudioPCMBuffer, AVAudioTime) -> Void)? = nil,
        prepareEngine: Bool = true
    ) -> (format: AVAudioFormat, installed: Bool) {
        // Get the hardware input format
        let inputNode = audioEngine.inputNode
        let inputHardwareFormat = inputNode.inputFormat(forBus: 0)
        let nodeOutputFormat = inputNode.outputFormat(forBus: 0)
        
        // Log format information for diagnostic purposes
        Logger.debug("AudioStreamManager", "Installing tap - Hardware input format: \(describeAudioFormat(inputHardwareFormat))")
        Logger.debug("AudioStreamManager", "Node output format: \(describeAudioFormat(nodeOutputFormat))")
        
        // Remove any existing tap
        inputNode.removeTap(onBus: 0)
        
        // Create the default tap block if none provided
        let tapBlock = customTapBlock ?? { [weak self] (buffer, time) in
            guard let self = self,
                  self.isRecording else {
                return
            }
            // Process audio buffer for streaming, analysis, and optional file writing
            // Note: Audio streaming works regardless of primary output settings (consistent with Web/Android)
            self.processAudioBuffer(buffer)
            self.lastBufferTime = time
        }
        
        // Calculate buffer size from duration if specified
        let bufferSize: AVAudioFrameCount
        if let duration = recordingSettings?.bufferDurationSeconds {
            // Use target sample rate from settings for calculation
            let targetSampleRate = Double(recordingSettings?.sampleRate ?? 16000)
            // Clamp BEFORE narrowing: AVAudioFrameCount(_:) traps on a value it
            // cannot represent, so the safety clamp below would never be reached
            // for a large duration.
            let requestedFrames = (duration * targetSampleRate).rounded(.towardZero)
            let calculatedSize = AVAudioFrameCount(
                min(max(requestedFrames, 0), Double(AVAudioFrameCount.max))
            )

            // iOS enforces minimum buffer size of ~4800 frames
            if calculatedSize < 4800 {
                Logger.debug("AudioStreamManager", "Requested buffer size \(calculatedSize) frames (from \(duration)s at \(targetSampleRate)Hz) is below iOS minimum of ~4800 frames")
            }
            
            // Apply safety clamping
            bufferSize = max(256, min(calculatedSize, 16384))
            Logger.debug("AudioStreamManager", "Buffer size: requested=\(calculatedSize), clamped=\(bufferSize) frames")
        } else {
            bufferSize = 1024 // Default
        }
        
        // Validate hardware format before installing tap (#223)
        if !AudioTapInstallPolicy.shouldInstallTap(
            channelCount: inputHardwareFormat.channelCount,
            sampleRate: inputHardwareFormat.sampleRate
        ) {
            let message = "Invalid hardware format: channels=\(inputHardwareFormat.channelCount), sampleRate=\(inputHardwareFormat.sampleRate). Skipping tap install to avoid format mismatch crash."
            Logger.debug("AudioStreamManager", message)
            delegate?.audioStreamManager(self, didFailWithError: message)
            if prepareEngine {
                audioEngine.prepare()
            }
            return (inputHardwareFormat, false)
        }

        // Install the tap with hardware format
        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputHardwareFormat, block: tapBlock)
        Logger.debug("AudioStreamManager", "Tap installed with hardware-compatible format")
        
        // Prepare the engine if requested
        if prepareEngine {
            audioEngine.prepare()
            Logger.debug("AudioStreamManager", "Engine prepared after tap installation")
        }
        
        return (inputHardwareFormat, true)
    }
    
    /// Prepares the audio recording with the specified settings without starting it.
    /// This reduces latency when startRecording is called later.
    /// - Parameters:
    ///   - settings: The recording settings to use.
    /// - Throws: `StartRecordingError` naming why preparation could not complete.
    /// Prepares the audio session, output file and tap.
    ///
    /// Throws rather than returning Bool: a bare Bool meant every reason — an active
    /// call, a file that could not be opened, a tap that would not install — arrived at
    /// the caller identical, and reporting them as one code was worse than the generic
    /// message it replaced. A mutable "last failure" side channel replaced that with a
    /// path that was easy to miss, and one was missed (#419). Throwing makes the compiler
    /// require a reason on every failure.
    func prepareRecording(settings: RecordingSettings) throws {

        // Store settings first before doing anything else
        recordingSettings = settings
        
        // Skip if already prepared or recording
        // Already prepared is success, not failure — there is nothing left to do. Recording
        // in progress is caught by startRecording's own alreadyRecording guard.
        guard !isPrepared && !isRecording else {
            Logger.debug("AudioStreamManager", "Already prepared or recording in progress.")
            return
        }

        // Check for active call using the new method
        if isPhoneCallActive() {
            Logger.debug("AudioStreamManager", "Cannot prepare recording during an active phone call")
            delegate?.audioStreamManager(self, didFailWithError: "Cannot prepare recording during an active phone call")
            throw StartRecordingError.phoneCallActive
        }

        // Deactivate the session for a clean slate before reconfiguring.
        // configureAudioSession() below will activate it once — no need for
        // the previous deactivate→sleep→activate→reconfigure→activate cycle.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            Logger.debug("AudioStreamManager", "Failed to deactivate audio session (non-fatal): \(error)")
        }

        // Update auto-resume preference from settings
        autoResumeAfterInterruption = settings.autoResumeAfterInterruption
        
        // Enforce minimum interval to prevent excessive CPU usage
        emissionInterval = max(10.0, Double(settings.interval ?? 1000)) / 1000.0
        emissionIntervalAnalysis = max(10.0, Double(settings.intervalAnalysis ?? 500)) / 1000.0
        lastEmissionTime = nil // Will be set when recording starts
        lastEmissionTimeAnalysis = nil // Will be set when recording starts
        resetAccumulated()
        totalDataSize = 0
        totalDataSizeAnalysis = 0
        // Per recording: a previous recording's failure must not suppress this one's report.
        // Synchronous so the reset is ordered before any append this recording enqueues.
        fileWriteQueue.sync { self.primaryWriteFailureReported = false }
        totalPausedDuration = 0
        lastEmittedSize = 0
        lastEmittedCompressedSize = 0
        lastEmittedCompressedSizeAnalysis = 0
        isPaused = false
        pausedBySystemInterruption = false

        // Create recording file first (unless primary output is disabled)
        if settings.output.primary.enabled {
            recordingFileURL = createRecordingFile()
            if let url = recordingFileURL {
                do {
                    // Ensure directory exists if needed (createRecordingFile should handle this, but belt-and-suspenders)
                    try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
                    // Create the file if it doesn't exist (createRecordingFile should also handle this)
                    if !fileManager.fileExists(atPath: url.path) {
                        fileManager.createFile(atPath: url.path, contents: nil, attributes: nil)
                    }
                    // Open the handle for writing
                    self.fileHandle = try FileHandle(forWritingTo: url)
                    // Write initial dummy header immediately
                    let header = createWavHeader(dataSize: 0)
                    self.fileHandle?.write(header)
                    self.totalDataSize = Int64(WAV_HEADER_SIZE) // Initialize size with header size
                    self.cachedWavFileSize = Int64(WAV_HEADER_SIZE) // Initialize cached size
                    Logger.debug("AudioStreamManager", "File handle opened and initial header written for \(url.path). Initial size: \(self.totalDataSize)")
                } catch {
                    Logger.debug("AudioStreamManager", "Error creating/opening file handle: \(error.localizedDescription)")
                    // No need to call cleanupPreparation here; throwing handles it
                    throw StartRecordingError.fileCreationFailed
                }
            } else {
                Logger.debug("AudioStreamManager", "Error: Failed to create recording file URL.")
                throw StartRecordingError.fileCreationFailed
            }
        } else {
            // Skip file writing mode
            recordingFileURL = nil
            fileHandle = nil
            totalDataSize = 0
            Logger.debug("AudioStreamManager", "Skip file writing mode enabled - no file will be created")
        }
        
        var newSettings = settings
        
        // Then set up audio session and tap
        do {
            Logger.debug("AudioStreamManager", "Configuring audio session with sample rate: \(settings.sampleRate) Hz")
            
            let session = AVAudioSession.sharedInstance()
            if let currentRoute = session.currentRoute.outputs.first {
                Logger.debug("AudioStreamManager", "Current audio output: \(currentRoute.portType)")
                newSettings.sampleRate = settings.sampleRate  // Keep original sample rate
            }
            
            // Configure audio session based on audio focus strategy
            try configureAudioSession(for: settings)
            // NOTE: We intentionally DO NOT call session.setPreferredSampleRate().
            // Trying to force a sample rate different from the hardware's actual rate
            // often prevents the input node's tap from receiving any buffers.
            // Instead, we let the session negotiate the rate.
            // Resampling to the desired settings.sampleRate happens later in processAudioBuffer.
            try session.setPreferredIOBufferDuration(1024 / Double(settings.sampleRate)) // Use desired rate for buffer duration hint
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            // Log session config details as single lines for clarity
            Logger.debug("AudioStreamManager", "Audio session configured:")
            Logger.debug("AudioStreamManager", "  - category: \(session.category)")
            Logger.debug("AudioStreamManager", "  - mode: \(session.mode)")
            Logger.debug("AudioStreamManager", "  - options: \(session.categoryOptions)")
            Logger.debug("AudioStreamManager", "  - keepAwake: \(settings.keepAwake)")
            Logger.debug("AudioStreamManager", "  - emission interval: \(emissionInterval * 1000)ms")
            Logger.debug("AudioStreamManager", "  - analysis interval: \(emissionIntervalAnalysis * 1000)ms")
            Logger.debug("AudioStreamManager", "  - requested sample rate: \(settings.sampleRate)Hz")
            Logger.debug("AudioStreamManager", "  - actual session sample rate: \(session.sampleRate)Hz") // Log actual rate
            Logger.debug("AudioStreamManager", "  - channels: \(settings.numberOfChannels)")
            Logger.debug("AudioStreamManager", "  - bit depth: \(settings.bitDepth)-bit")
            Logger.debug("AudioStreamManager", "  - compression enabled: \(settings.output.compressed.enabled)")

            // Use our shared tap installation method
            let tapInstall = installTapWithHardwareFormat()
            guard tapInstall.installed else {
                isPrepared = true
                cleanupPreparation()
                throw StartRecordingError.tapInstallationFailed
            }
            let tapFormat = tapInstall.format

            // Log tap configuration
            Logger.debug("AudioStreamManager", "Final Tap Configuration (Using Hardware Format):")
            Logger.debug("AudioStreamManager", "  - Tap Format: \(describeAudioFormat(tapFormat))")
            Logger.debug("AudioStreamManager", "  - Session Rate: \(session.sampleRate) Hz")
            Logger.debug("AudioStreamManager", "  - Requested Output Format: \(settings.bitDepth)-bit at \(settings.sampleRate)Hz")

            recordingSettings = newSettings  // Keep original settings with desired sample rate

            // audioEngine.prepare() is already called inside installTapWithHardwareFormat()
            // (default prepareEngine: true). Don't call it twice.

            // Setup compressed recording if enabled
            if settings.output.compressed.enabled {
                let isAACCompressedOutput = settings.output.compressed.format == "aac"
                let compressedSampleRate: Double
                if isAACCompressedOutput {
                    compressedSampleRate = Self.compatibleAACCompressedSampleRate(
                        requestedSampleRate: settings.sampleRate,
                        sessionSampleRate: session.sampleRate
                    )
                } else {
                    compressedSampleRate = settings.sampleRate
                }
                if isAACCompressedOutput && compressedSampleRate != settings.sampleRate {
                    Logger.debug(
                        "AudioStreamManager",
                        "Adjusted compressed AAC sample rate from \(settings.sampleRate)Hz to \(compressedSampleRate)Hz for AVAudioRecorder compatibility"
                    )
                }

                // Create compressed settings
                let compressedSettings: [String: Any] = [
                    AVFormatIDKey: isAACCompressedOutput ? kAudioFormatMPEG4AAC : kAudioFormatOpus,
                    AVSampleRateKey: compressedSampleRate,
                    AVNumberOfChannelsKey: settings.numberOfChannels,
                    AVEncoderBitRateKey: settings.output.compressed.bitrate,
                    AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
                    AVEncoderBitDepthHintKey: settings.bitDepth
                ]
                
                
                Logger.debug("AudioStreamManager", "Initializing compressed recording with settings: \(compressedSettings)")
                
                // Create file for compressed recording
                compressedFileURL = createRecordingFile(isCompressed: true)
                
                if let url = compressedFileURL {
                    Logger.debug("AudioStreamManager", "Using compressed file URL: \(url.path)")
                    
                    // Initialize recorder with proper error handling
                    do {
                        compressedRecorder = try AVAudioRecorder(url: url, settings: compressedSettings)
                        if let recorder = compressedRecorder {
                            recorder.delegate = self
                            
                            if !recorder.prepareToRecord() {
                                Logger.debug("AudioStreamManager", "Failed to prepare recorder")
                                compressedFileURL = nil
                                compressedRecorder = nil
                            } else {
                                // Note: We don't start the recorder yet, just prepare it
                                Logger.debug("AudioStreamManager", "Compressed recording prepared successfully")
                                            compressedFormat = settings.output.compressed.format
            compressedBitRate = settings.output.compressed.bitrate
                            }
                        }
                    } catch {
                        Logger.debug("AudioStreamManager", "Failed to initialize compressed recorder: \(error)")
                        compressedFileURL = nil
                        compressedRecorder = nil
                    }
                } else {
                    Logger.debug("AudioStreamManager", "Failed to create compressed recording file")
                }
            }
            
        } catch let error as StartRecordingError {
            // A reason thrown from inside this block — a tap that would not install, for
            // example — already names its cause. The generic catch below would replace it
            // with .preparationFailed and lose that.
            throw error
        } catch {
            Logger.debug("AudioStreamManager", "Error: Failed to set up audio session with preferred settings: \(error.localizedDescription)")
            throw StartRecordingError.preparationFailed
        }
        
        NotificationCenter.default.addObserver(self, selector: #selector(handleAudioSessionInterruption), name: AVAudioSession.interruptionNotification, object: nil)
        
        if settings.enableProcessing == true {
            // Initialize the AudioProcessor for buffer-based processing
            self.audioProcessor = AudioProcessor(resolve: { result in
                // Handle the result here if needed
            }, reject: { code, message in
                // Handle the rejection here if needed
            })
            Logger.debug("AudioStreamManager", "AudioProcessor activated successfully.")
        }
        
        // initializeNotifications schedules a Timer that needs main's RunLoop,
        // and notificationManager must exist before prepareRecording returns
        // (the recursive startRecording → prepareRecording path uses it
        // immediately). .sync is safe: nothing on main blocks on audioLifecycleQueue.
        if settings.showNotification {
            if Thread.isMainThread {
                initializeNotifications()
            } else {
                DispatchQueue.main.sync {
                    self.initializeNotifications()
                }
            }
        }
        
        // Mark preparation as complete
        isPrepared = true
        Logger.debug("Recording prepared successfully. Ready to start.")
    }

    /// Starts a new audio recording with the specified settings.
    /// - Parameters:
    ///   - settings: The recording settings to use.
    /// - Returns: A `StartRecordingResult` describing the started recording.
    /// - Throws: `StartRecordingError` naming why recording could not start.
    func startRecording(settings: RecordingSettings) throws -> StartRecordingResult {
        // If already prepared, use the prepared state
        if isPrepared {
            Logger.debug("Using prepared recording state")
            
            // Install tap with hardware format
            let tapInstall = installTapWithHardwareFormat()
            guard tapInstall.installed else {
                Logger.debug("Failed to install recording tap")
                cleanupPreparation()
                throw StartRecordingError.tapInstallationFailed
            }
            Logger.debug("Tap was reinstalled during recording start")
        } else {
            // If not prepared, prepare now
            Logger.debug("Not prepared, preparing recording first")
            // prepareRecording throws a specific StartRecordingError; let it propagate
            // rather than flattening a phone call or a tap failure into one code.
            try prepareRecording(settings: settings)
        }
        
        // Rest of the method remains unchanged
        // Check for active phone call again, in case one started after preparation
        if isPhoneCallActive() {
            Logger.debug("Cannot start recording during an active phone call")
            delegate?.audioStreamManager(self, didFailWithError: "Cannot start recording during an active phone call")
            cleanupPreparation()
            throw StartRecordingError.phoneCallActive
        }
        
        guard !isRecording else {
            Logger.debug("Recording already in progress")
            throw StartRecordingError.alreadyRecording
        }
        
        guard let settings = recordingSettings else {
            Logger.debug("Missing settings")
            throw StartRecordingError.missingSettings
        }
        
        // File URI is optional when primary output is disabled
        let fileUri = recordingFileURL?.absoluteString ?? ""
        
        do {
            enableWakeLock()
            
            // Set recording state *before* starting engine to avoid race condition
            // Always reset startTime to now — ensures duration reflects actual recording,
            // not time since prepareRecording() was called (#298)
            startTime = Date()
            totalPausedDuration = 0
            currentPauseStart = nil
            lastEmissionTime = Date()
            lastEmissionTimeAnalysis = Date()
            isRecording = true
            isPaused = false
            pausedBySystemInterruption = false
            startMaxDurationTimer(settings: settings)
            
            // Start the audio engine
            try audioEngine.start()
            
            // Start the compressed recorder if prepared
            compressedRecorder?.record()
            
            // Show notifications if enabled
            if settings.showNotification {
                notificationManager?.startUpdates(startTime: startTime ?? Date())
                updateNowPlayingInfo(isPaused: false)
            }
            
            Logger.debug("Recording started successfully")
            
            var compression = compressedRecorder != nil ? CompressedRecordingInfo(
                compressedFileUri: compressedFileURL?.absoluteString ?? "",
                mimeType: compressedFormat == "aac" ? "audio/aac" : "audio/opus",
                bitrate: compressedBitRate,
                format: compressedFormat
            ) : nil

            // Get the size separately since it's not part of the initializer
            if let compressedPath = compressedFileURL?.path,
               let attributes = try? FileManager.default.attributesOfItem(atPath: compressedPath),
               let fileSize = attributes[.size] as? Int64 {
                compression?.size = fileSize
            }

            return StartRecordingResult(
                fileUri: fileUri,
                mimeType: mimeType,
                channels: settings.numberOfChannels,
                bitDepth: settings.bitDepth,
                sampleRate: settings.sampleRate,
                compression: compression
            )
            
        } catch {
            Logger.debug("Error starting audio engine: \(error.localizedDescription)")
            isRecording = false
            cancelMaxDurationTimer()
            cleanupPreparation()
            throw StartRecordingError.engineStartFailed(underlying: error)
        }
    }

    /// Cleans up resources if preparation was done but recording didn't start.
    private func cleanupPreparation() {
        // Only run if prepared but not recording
        guard isPrepared && !isRecording else { return }
        
        Logger.debug("Cleaning up prepared resources that weren't used")
        cancelMaxDurationTimer()
        
        // Remove input tap
        audioEngine.inputNode.removeTap(onBus: 0)
        
        // Stop compressed recorder if created but not started
        compressedRecorder?.stop()
        compressedRecorder = nil
        
        // Delete created files that weren't used
        if let fileURL = recordingFileURL, FileManager.default.fileExists(atPath: fileURL.path) {
            try? FileManager.default.removeItem(at: fileURL)
        }
        
        if let compressedURL = compressedFileURL, FileManager.default.fileExists(atPath: compressedURL.path) {
            try? FileManager.default.removeItem(at: compressedURL)
        }
        
        // Reset audio session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            Logger.debug("Error deactivating audio session: \(error)")
        }
        
        // Clear notification setup if it was initialized
        notificationManager?.stopUpdates()
        notificationManager = nil
        
        // --- Restore missing cleanup lines and remove log ---
        // Logger.debug("cleanupPreparation: Clearing recordingSettings. Current deviceId: \(recordingSettings?.deviceId ?? \"nil\")")
        recordingFileURL = nil // Restore
        compressedFileURL = nil // Restore
        audioProcessor = nil // Restore
        recordingSettings = nil
        pausedBySystemInterruption = false
        isPrepared = false // Restore
        // --- End restored lines and removed log ---
        
        Logger.debug("Preparation cleanup completed")
    }

    /// Pauses the current audio recording.
    func pauseRecording(isSystemInterruption: Bool = false) {
        guard isRecording, !isPaused else { return }
        
        Logger.debug("Pausing recording...")
        
        // Emit any remaining audio data before pausing
        let finalData = takeAccumulatedSnapshot()
        if !finalData.isEmpty {
            Logger.debug("Emitting final audio chunk of \(finalData.count) bytes before pausing")
            let recordingTime = currentRecordingDuration()
            let finalTotalSize = self.totalDataSize

            delegate?.audioStreamManager(
                self,
                didReceiveAudioData: finalData,
                recordingTime: recordingTime,
                totalDataSize: finalTotalSize,
                compressionInfo: buildCompressionInfo()
            )
        }

        // Store when we paused
        currentPauseStart = Date()
        pauseMaxDurationTimer()
        
        // Update state
        isPaused = true
        pausedBySystemInterruption = isSystemInterruption
        
        // Stop the engine but don't remove the tap
        audioEngine.pause()
        
        // Pause the compressed recorder if active
        compressedRecorder?.pause()
        
        // Update notification state if enabled
        if recordingSettings?.showNotification == true {
            updateNotificationState(isPaused: true)
        }
        
        // Store valid duration for notifications
        lastValidDuration = currentRecordingDuration()
        
        // Notify delegate
        delegate?.audioStreamManager(self, didPauseRecording: Date())
        
        Logger.debug("Recording paused")
    }
    
    /// Resumes a paused recording.
    /// Verify the primary WAV file handle still accepts writes, reopening it if not.
    ///
    /// Runs on `fileWriteQueue` so it cannot race the background appends.
    ///
    /// An interruption can leave the persistent fileHandle unusable while the
    /// compressed recorder recovers fine. Appends then failed silently on the
    /// background queue, so the M4A kept growing while the WAV — used as a
    /// crash-recovery backup — silently stopped (issue #420). If the handle cannot
    /// be restored the failure is surfaced to the delegate instead of being lost.
    private func reopenPrimaryFileHandleIfNeeded() {
        guard recordingFileURL != nil else { return }

        fileWriteQueue.sync {
            if let handle = self.fileHandle {
                do {
                    try handle.seekToEnd()
                    return // Still usable.
                } catch {
                    Logger.debug(
                        "AudioStreamManager",
                        "Primary file handle unusable after interruption: \(error.localizedDescription). Reopening."
                    )
                }
            }

            do {
                try self.reopenPrimaryFileHandle()
                Logger.debug("AudioStreamManager", "Primary file handle reopened after interruption.")
            } catch {
                self.reportPrimaryWriteFailureOnce(error)
            }
        }
    }

    /// Reopens the primary WAV handle for appending. Caller must be on `fileWriteQueue`.
    ///
    /// Every byte this recording has accounted for is kept — the header is only rewritten
    /// at stop, so starting over would discard the recording so far. Bytes past that point
    /// are not: a write can commit a prefix before throwing, and those uncounted bytes are
    /// cut so the retry cannot duplicate them.
    private func reopenPrimaryFileHandle() throws {
        guard let url = recordingFileURL else {
            throw NSError(
                domain: "AudioStreamManager",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "No primary recording file to reopen"]
            )
        }

        // Drop the old handle first: keeping it on failure would leave a descriptor that
        // every later append retries against.
        self.fileHandle = nil

        let reopened = try FileHandle(forWritingTo: url)

        // Resume at the logical end, not the physical one. A write can commit a prefix
        // before throwing, so the file on disk may already hold part of the buffer that
        // is about to be retried; seeking to the physical end would append the whole
        // buffer again and leave duplicated audio that the header's size field does not
        // describe. totalDataSize counts the header plus every byte this recording has
        // accounted for, so it is the only trustworthy length here.
        let logicalEnd: UInt64
        do {
            logicalEnd = try self.logicalEndOffset()
        } catch {
            try? reopened.close()
            throw error
        }
        let physicalEnd = try reopened.seekToEnd()

        switch PrimaryWriteFailurePolicy.resume(physicalEnd: physicalEnd, logicalEnd: logicalEnd) {
        case .truncateTo(let offset):
            try reopened.truncate(atOffset: offset)
        case .refuse:
            try? reopened.close()
            throw NSError(
                domain: "AudioStreamManager",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey:
                    "Primary WAV is shorter than the bytes already recorded "
                    + "(\(physicalEnd) < \(logicalEnd)); refusing to append"]
            )
        case .append:
            break
        }

        try reopened.seek(toOffset: logicalEnd)
        self.fileHandle = reopened
    }

    /// Where this recording's accounted-for bytes end. Caller must be on `fileWriteQueue`.
    ///
    /// Refuses rather than clamping a counter below the header size. `stopRecording()`
    /// resets `totalDataSize` from another queue, so a value that low means the counter no
    /// longer describes this file — and clamping it to 44 would seek to the top and
    /// overwrite real audio, which is exactly the corruption this path exists to avoid.
    private func logicalEndOffset() throws -> UInt64 {
        guard self.totalDataSize >= WAV_HEADER_SIZE else {
            throw NSError(
                domain: "AudioStreamManager",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey:
                    "Primary WAV byte count (\(self.totalDataSize)) is below the header size; "
                    + "refusing to write"]
            )
        }
        return UInt64(self.totalDataSize)
    }

    /// Appends one buffer to the primary WAV. Caller must be on `fileWriteQueue`.
    private func appendToPrimary(_ data: Data) throws {
        guard let handle = self.fileHandle else {
            throw NSError(
                domain: "AudioStreamManager",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Primary file handle is nil"]
            )
        }
        let logicalEnd = try self.logicalEndOffset()

        // Reconcile against what is physically there before every write, not only after a
        // failure. Seeking past EOF succeeds and writes a zero-filled hole, so a file that
        // shrank underneath a still-valid descriptor would silently gain silence; a file
        // that is longer would keep bytes the header does not describe. This costs the same
        // seekToEnd the original implementation already paid per buffer.
        let physicalEnd = try handle.seekToEnd()
        switch PrimaryWriteFailurePolicy.resume(physicalEnd: physicalEnd, logicalEnd: logicalEnd) {
        case .truncateTo(let offset):
            try handle.truncate(atOffset: offset)
        case .refuse:
            throw NSError(
                domain: "AudioStreamManager",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey:
                    "Primary WAV is shorter than the bytes already recorded "
                    + "(\(physicalEnd) < \(logicalEnd)); refusing to append"]
            )
        case .append:
            break
        }

        try handle.seek(toOffset: logicalEnd)
        try handle.write(contentsOf: data)
        self.totalDataSize += Int64(data.count)
        self.cachedWavFileSize = self.totalDataSize
    }

    /// Recovers from a failed append, or reports that the WAV has stopped.
    ///
    /// Caller must be on `fileWriteQueue`.
    private func handlePrimaryWriteFailure(_ error: Error, retrying data: Data) {
        // Once recovery has failed, stop trying. Every buffer would otherwise reopen a
        // file that is not coming back — filesystem work dozens of times a second, and a
        // longer barrier for stopRecording() to drain.
        guard !self.primaryWriteFailureReported else { return }

        Logger.debug(
            "AudioStreamManager",
            "Primary WAV append failed: \(error.localizedDescription). Reopening."
        )
        do {
            try self.reopenPrimaryFileHandle()
            try self.appendToPrimary(data)
            Logger.debug("AudioStreamManager", "Primary WAV handle recovered mid-recording.")
        } catch {
            self.reportPrimaryWriteFailureOnce(error)
        }
    }

    /// Reports that the primary WAV has stopped, at most once per recording.
    ///
    /// Caller must be on `fileWriteQueue`, which is what makes the once-only check safe.
    private func reportPrimaryWriteFailureOnce(_ error: Error) {
        self.fileHandle = nil

        guard PrimaryWriteFailurePolicy.shouldReport(
            alreadyReported: self.primaryWriteFailureReported
        ) else { return }
        self.primaryWriteFailureReported = true

        Logger.debug(
            "AudioStreamManager",
            "Primary WAV output stopped: \(error.localizedDescription)"
        )
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.delegate?.audioStreamManager(
                self,
                didFailWithError: "Primary WAV output stopped and could not be recovered: \(error.localizedDescription). Compressed output, if enabled, is unaffected."
            )
        }
    }

    func resumeRecording() {
        guard isRecording, isPaused else { return }
        
        Logger.debug("Resuming recording...")
        
        // Calculate and add the pause duration if we have a pause start time
        if let pauseStart = currentPauseStart {
            let pauseDuration = Date().timeIntervalSince(pauseStart)
            totalPausedDuration += pauseDuration
            currentPauseStart = nil // Reset pause start time
            Logger.debug("Added pause duration: \(pauseDuration), total paused: \(totalPausedDuration)")
        }
        
        do {
            // Check and reinstall tap with hardware format
            let tapInstall = installTapWithHardwareFormat()
            guard tapInstall.installed else {
                Logger.debug("Failed to install recording tap for resume")
                currentPauseStart = Date()
                return
            }
            Logger.debug("Tap reinstalled for resume")

            // Revalidate the primary WAV handle BEFORE starting the engine.
            // Once the engine runs, a tap callback can enqueue a write; if that
            // lands against a stale handle the first resumed PCM buffer is lost
            // (issue #420).
            if recordingSettings?.output.primary.enabled == true {
                reopenPrimaryFileHandleIfNeeded()
            }

            // Try to restart the engine
            try audioEngine.start()
            
            // Resume the compressed recorder if active
            compressedRecorder?.record()
            
            // Update state
            isPaused = false
            pausedBySystemInterruption = false
            
            // Update notification state if enabled
            if recordingSettings?.showNotification == true {
                updateNotificationState(isPaused: false)
            }
            
            // Clear the stored valid duration
            lastValidDuration = nil
            resumeMaxDurationTimer()
            
            // Reset emission timers to ensure emission starts immediately after resume
            lastEmissionTime = Date()
            lastEmissionTimeAnalysis = Date()
            
            // Notify delegate
            delegate?.audioStreamManager(self, didResumeRecording: Date())
            
            Logger.debug("Recording resumed successfully")
            
        } catch {
            Logger.debug("Failed to resume recording: \(error.localizedDescription)")
            delegate?.audioStreamManager(self, didFailWithError: "Failed to resume recording: \(error.localizedDescription)")
        }
    }
    
    /// Initializes the notification manager to show recording notifications.
    private func initializeNotifications() {
        guard let settings = recordingSettings else { return }
        
        // Create notification manager
        notificationManager = AudioNotificationManager()
        notificationManager?.initialize(with: settings.notification)
        
        // Add pause/resume handlers via notification observers
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handlePauseNotification),
            name: Notification.Name("PAUSE_RECORDING"),
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleResumeNotification),
            name: Notification.Name("RESUME_RECORDING"),
            object: nil
        )
        
        // Setup media controls (iOS control center) if enabled
        setupNowPlayingInfo()
        
        // Set up timer to update media info
        mediaInfoUpdateTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.updateMediaInfo()
        }
    }
    
    /// Resample an audio buffer to a different sample rate.
    /// - Parameters:
    ///   - buffer: The source audio buffer.
    ///   - sourceRate: The source sample rate.
    ///   - targetRate: The target sample rate.
    /// - Returns: The resampled audio buffer or nil if resampling failed.
    private func resampleAudioBuffer(_ buffer: AVAudioPCMBuffer, from sourceRate: Double, to targetRate: Double) -> AVAudioPCMBuffer? {
        // If the rates are the same, no need to resample
        if sourceRate == targetRate {
            return buffer
        }
        
        // Create source and target formats
        guard let outputFormat = AVAudioFormat(
            commonFormat: buffer.format.commonFormat,
            sampleRate: targetRate,
            channels: buffer.format.channelCount,
            interleaved: buffer.format.isInterleaved
        ) else {
            Logger.debug("Failed to create output format for resampling")
            return nil
        }
        
        // Create a converter
        guard let converter = AVAudioConverter(from: buffer.format, to: outputFormat) else {
            Logger.debug("Failed to create audio converter")
            return nil
        }
        
        // Calculate new buffer size
        let ratio = targetRate / sourceRate
        let estimatedFrames = AVAudioFrameCount(Double(buffer.frameLength) * ratio)
        
        // Create output buffer
        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: estimatedFrames
        ) else {
            Logger.debug("Failed to create output buffer")
            return nil
        }
        
        // Perform conversion
        var error: NSError?
        converter.convert(to: outputBuffer, error: &error) { inNumPackets, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }
        
        if let error = error {
            Logger.debug("Error resampling audio: \(error.localizedDescription)")
            return nil
        }
        
        return outputBuffer
    }

    /// Describes the format of the given audio format.
    /// - Parameter format: The AVAudioFormat object to describe.
    /// - Returns: A string description of the audio format.
    func describeAudioFormat(_ format: AVAudioFormat) -> String {
        let formatDescription = """
            - Sample rate: \(format.sampleRate)Hz
            - Channels: \(format.channelCount)
            - Interleaved: \(format.isInterleaved)
            - Common format: \(describeCommonFormat(format.commonFormat))
            """
        return formatDescription
    }
    
    func describeCommonFormat(_ format: AVAudioCommonFormat) -> String {
        switch format {
        case .pcmFormatFloat32:
            return "32-bit float"
        case .pcmFormatFloat64:
            return "64-bit float"
        case .pcmFormatInt16:
            return "16-bit int"
        case .pcmFormatInt32:
            return "32-bit int"
        default:
            return "Unknown format"
        }
    }
    
    /// Updates the WAV header with the correct file size.
    /// - Parameters:
    ///   - fileURL: The URL of the WAV file.
    ///   - totalDataSize: The total size of the audio data.
    private func updateWavHeader(fileURL: URL, totalDataSize: Int64) {
        // Prevent negative values - minimum WAV file size should be at least the header size (WAV_HEADER_SIZE bytes)
        guard totalDataSize >= 0 else {
            Logger.debug("Invalid file size: total data size is negative")
            return
        }

        do {
            let fileHandle = try FileHandle(forUpdating: fileURL)
            defer { fileHandle.closeFile() }

            // Calculate sizes
            let fileSize = totalDataSize + WAV_HEADER_SIZE - 8 // Total file size minus 8 bytes for 'RIFF' and size field itself
            let dataSize = totalDataSize // Size of the 'data' sub-chunk

            // Update RIFF chunk size at offset 4
            fileHandle.seek(toFileOffset: 4)
            let fileSizeBytes = UInt32(fileSize).littleEndianBytes
            fileHandle.write(Data(fileSizeBytes))

            // Update data chunk size at offset 40
            fileHandle.seek(toFileOffset: 40)
            let dataSizeBytes = UInt32(dataSize).littleEndianBytes
            fileHandle.write(Data(dataSizeBytes))

        } catch let error {
            Logger.debug("Error updating WAV header: \(error)")
        }
    }
    
    private func updateNotificationDuration() {
        guard let startTime = startTime,
              recordingSettings?.showNotification == true else { return }
        
        let currentDuration = Date().timeIntervalSince(startTime) - TimeInterval(totalPausedDuration)
        
        // Update both notification manager and media player
        notificationManager?.updateDuration(currentDuration)
        
        if let notificationView = notificationView {
            var nowPlayingInfo = notificationView.nowPlayingInfo ?? [:]
            nowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentDuration
            notificationView.nowPlayingInfo = nowPlayingInfo
        }
    }
    
    /// Processes the audio buffer: handles resampling/format conversion if necessary,
    /// optionally writes the result to the WAV file on a background thread (if primary output is enabled),
    /// and triggers analysis processing and event emission based on intervals.
    /// Audio streaming happens regardless of file output settings.
    /// - Parameters:
    ///   - buffer: The audio buffer received from the input node tap.
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let settings = recordingSettings else {
            Logger.debug("processAudioBuffer: Recording settings not available")
            return
        }

        // DEBUG: Add tap and buffer info
        debugBufferCounter += 1
        
        // Log every 10th buffer to avoid excessive logs
        if debugBufferCounter % 10 == 0 {
            Logger.debug("BUFFER DEBUG: Processing buffer #\(debugBufferCounter), channelCount: \(buffer.format.channelCount), frameLength: \(buffer.frameLength)")
        }

        // targetSampleRate and targetFormat remain the user's requested final format
        let targetSampleRate = Double(settings.sampleRate)
        let targetFormat: AVAudioCommonFormat = settings.bitDepth == 32 ? .pcmFormatFloat32 : .pcmFormatInt16
        
        // Log bit depth information
        Logger.debug("""
            BIT DEPTH DEBUG:
            - Settings bitDepth: \(settings.bitDepth)
            - Target format: \(targetFormat == .pcmFormatFloat32 ? "pcmFormatFloat32" : "pcmFormatInt16")
            - Buffer format: \(buffer.format.commonFormat.rawValue)
            - Buffer sample rate: \(buffer.format.sampleRate)
            - Target sample rate: \(targetSampleRate)
        """)

        // Buffer to be processed - initially the input buffer
        var bufferToProcess: AVAudioPCMBuffer = buffer

        // 1. Resample if the buffer's sample rate doesn't match the target
        if buffer.format.sampleRate != targetSampleRate {
            if let resampled = resampleAudioBuffer(buffer, from: buffer.format.sampleRate, to: targetSampleRate) {
                bufferToProcess = resampled
            } else {
                Logger.debug("processAudioBuffer: Resampling FAILED")
                return
            }
        }

        // 2. Convert format if the (potentially resampled) buffer's format doesn't match the target
        if bufferToProcess.format.commonFormat != targetFormat {
            guard let targetAVFormat = AVAudioFormat(
                commonFormat: targetFormat,
                sampleRate: targetSampleRate, // Use target rate for final format
                channels: AVAudioChannelCount(settings.numberOfChannels),
                interleaved: bufferToProcess.format.isInterleaved // Match interleaving of current buffer
            ) else {
                Logger.debug("processAudioBuffer: Failed to create target AVAudioFormat for conversion.")
                return
            }
            if let converted = convertBufferFormat(bufferToProcess, to: targetAVFormat) {
                bufferToProcess = converted
            } else {
                Logger.debug("processAudioBuffer: Format conversion FAILED")
                return
            }
        }

        // Now bufferToProcess contains the audio data in the desired sample rate and format
        let audioData = bufferToProcess.audioBufferList.pointee.mBuffers
        guard let bufferData = audioData.mData else {
            Logger.debug("Buffer data is nil after processing.")
            return
        }

        // Create an immutable copy for background/event emission
        let dataToWrite = Data(bytes: bufferData, count: Int(audioData.mDataByteSize))

        // --- Background File Writing (Optional) ---
        // Only write to file if primary output is enabled
        if settings.output.primary.enabled {
            // Use the persistent fileHandle opened during preparation.
            // Serial queue so stopRecording() can barrier on outstanding appends.
            fileWriteQueue.async { [weak self] in
                guard let self = self else { return }
                // A failed append used to be logged and dropped. The compressed recorder
                // kept running, so the M4A grew while the WAV silently stopped — and a
                // caller using the WAV for crash recovery had no way to know it had gone
                // stale (#420). Try to recover the handle, and if that fails, say so.
                do {
                    try self.appendToPrimary(dataToWrite)
                } catch {
                    self.handlePrimaryWriteFailure(error, retrying: dataToWrite)
                }
            }
        } else {
            // Still track total size for statistics even without file writing
            self.totalDataSize += Int64(dataToWrite.count)
        }

        // --- Event Emission & Analysis (Always Happens) ---
        // Audio streaming is independent of file output settings.
        // Lock-protected append: see accumulatedDataLock for rationale.
        appendAccumulated(dataToWrite)

        if recordingSettings?.showNotification == true {
            updateNotificationDuration()
        }

        let currentTime = Date()
        let currentTotalSize = self.totalDataSize // Use the most up-to-date size for events

        // Emit AudioData event
        if let lastEmission = self.lastEmissionTime {
            if debugBufferCounter % 10 == 0 {
                let timeGap = currentTime.timeIntervalSince(lastEmission)
                let isTimeReady = timeGap >= emissionInterval
                Logger.debug("EMISSION DEBUG: Time since last: \(timeGap)s, Threshold: \(emissionInterval)s, Ready: \(isTimeReady), DataSize: \(accumulatedDataSize()) bytes")
            }

            if currentTime.timeIntervalSince(lastEmission) >= emissionInterval {
                // Atomic snapshot+clear avoids the race that crashed
                // base64EncodedString in the delegate (issue #314) and
                // stops short writes from being dropped between read
                // and clear.
                let dataToEmit = takeAccumulatedSnapshot()
                if !dataToEmit.isEmpty {
                    let recordingTime = currentRecordingDuration()
                    self.lastEmissionTime = currentTime
                    self.lastEmittedSize = currentTotalSize
                    let compressionInfo = buildCompressionInfo()

                    Logger.debug("EMISSION SUCCESS: Emitting \(dataToEmit.count) bytes at recording time \(recordingTime)s")

                    delegate?.audioStreamManager(
                        self,
                        didReceiveAudioData: dataToEmit,
                        recordingTime: recordingTime,
                        totalDataSize: currentTotalSize,
                        compressionInfo: compressionInfo
                    )
                }
            }
        } else {
            Logger.debug("EMISSION DEBUG: lastEmissionTime is nil, setting to current time")
            lastEmissionTime = currentTime
        }

        // Dispatch analysis task
        if let lastEmissionAnalysis = self.lastEmissionTimeAnalysis,
           currentTime.timeIntervalSince(lastEmissionAnalysis) >= emissionIntervalAnalysis,
           settings.enableProcessing,
           let _ = self.audioProcessor {
            let dataToAnalyze = takeAccumulatedAnalysisSnapshot()
            self.lastEmissionTimeAnalysis = currentTime

            if !dataToAnalyze.isEmpty {
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self = self, let processor = self.audioProcessor, let settings = self.recordingSettings else {
                    // Logger.debug("Analysis Dispatch SKIP: self, processor, or settings nil")
                    return
                }
                guard !dataToAnalyze.isEmpty else {
                    // Logger.debug("Analysis Dispatch SKIP: dataToAnalyze is empty")
                    return
                }

                // Logger.debug("Analysis Dispatch: Processing \(dataToAnalyze.count) bytes...")
                let processingResult = processor.processAudioBuffer(
                    data: dataToAnalyze,
                    sampleRate: Float(settings.sampleRate),
                    segmentDurationMs: settings.segmentDurationMs,
                    featureOptions: settings.featureOptions ?? [:],
                    bitDepth: settings.bitDepth,
                    numberOfChannels: settings.numberOfChannels
                )

                // Dispatch result back to main thread
                DispatchQueue.main.async {
                    if let result = processingResult {
                         // Logger.debug("Analysis Dispatch: Success, calling delegate.")
                        self.delegate?.audioStreamManager(self, didReceiveProcessingResult: result)
                    } else {
                         Logger.debug("Analysis Dispatch FAIL: processor.processAudioBuffer returned nil")
                    }
                }
            }
            }
            // Logger.debug("Dispatched analysis task.") // Optional: Re-enable if needed
        }
    }

    // Add helper function to calculate average amplitude
    private func calculateAverageAmplitude(_ data: UnsafePointer<Float>, count: Int) -> Float {
        var sum: Float = 0
        vDSP_meanv(data, 1, &sum, vDSP_Length(count))
        return sum
    }

    // Add helper function to calculate RMS
    private func calculateRMS(_ data: UnsafePointer<Float>, count: Int) -> Float {
        var sum: Float = 0
        var squaredSum: Float = 0
        for i in 0..<count {
            let value = data[i]
            sum += value
            squaredSum += value * value
        }
        let average = sum / Float(count)
        let variance = squaredSum / Float(count) - average * average
        return sqrt(variance)
    }

    // Helper function for format conversion
    private func convertBufferFormat(_ buffer: AVAudioPCMBuffer, to targetFormat: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard let converter = AVAudioConverter(from: buffer.format, to: targetFormat),
              let outputBuffer = AVAudioPCMBuffer(
                pcmFormat: targetFormat,
                frameCapacity: buffer.frameLength
        ) else {
            return nil
        }
        
        outputBuffer.frameLength = buffer.frameLength
        var error: NSError?
        
        converter.convert(to: outputBuffer, error: &error) { inNumPackets, outStatus in
            outStatus.pointee = AVAudioConverterInputStatus.haveData
            return buffer
        }
        
        if let error = error {
            Logger.debug("Format conversion failed: \(error.localizedDescription)")
            return nil
        }
        
        return outputBuffer
    }

    /// Performs the full engine stop → reset → reinstall tap → restart cycle for a device switch.
    /// Pass `nil` to revert to the system-default input.
    /// This is the single source of truth for all device-switch paths (Bug 1 + Bug 2 fixes).
    public func performDeviceSwitch(port: AVAudioSessionPortDescription?) {
        let wasRunning = audioEngine.isRunning
        do {
            if wasRunning { audioEngine.stop() }
            audioEngine.inputNode.removeTap(onBus: 0)
            try AVAudioSession.sharedInstance().setPreferredInput(port)
            Thread.sleep(forTimeInterval: 0.15)
            audioEngine.reset()
            let tapInstall = installTapWithHardwareFormat()
            guard tapInstall.installed else {
                throw NSError(
                    domain: "AudioStreamManager",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "Failed to install audio tap after device switch"]
                )
            }
            if wasRunning {
                audioEngine.prepare()
                try audioEngine.start()
                lastEmissionTime = Date()
                lastEmissionTimeAnalysis = Date()
                Logger.debug("AudioStreamManager", "Device switch complete; engine restarted (port: \(port?.portName ?? "default"))")
            }
        } catch {
            Logger.debug("AudioStreamManager", "Device switch failed: \(error.localizedDescription)")
            if wasRunning {
                do {
                    let tapInstall = installTapWithHardwareFormat()  // Bug 2 fix: reinstall tap in recovery path
                    guard tapInstall.installed else {
                        throw NSError(
                            domain: "AudioStreamManager",
                            code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "Failed to install audio tap during device-switch recovery"]
                        )
                    }
                    audioEngine.prepare()
                    try audioEngine.start()
                    Logger.debug("AudioStreamManager", "Engine recovery after device switch succeeded")
                } catch {
                    Logger.debug("AudioStreamManager", "Engine recovery failed: \(error.localizedDescription)")
                }
            }
        }
    }

    /// Attempts to update the audio session with the preferred input device from current settings.
    /// Called externally when the device selection changes.
    public func updateAudioSessionWithCurrentSettings() {
        guard let settings = self.recordingSettings, let deviceId = settings.deviceId else {
            Logger.debug("Cannot update audio session preference, settings or deviceId missing")
            return
        }

        let session = AVAudioSession.sharedInstance()
        let selectedPort = session.availableInputs?.first { port in
            deviceManager.normalizeBluetoothDeviceId(port.uid) == deviceManager.normalizeBluetoothDeviceId(deviceId)
        }

        guard let portToSet = selectedPort else {
            Logger.debug("Could not find device with ID \(deviceId)")
            return
        }

        performDeviceSwitch(port: portToSet)
    }

    /// Stops the current audio recording.
    /// - Returns: A RecordingResult object if the recording stopped successfully, or nil otherwise.
    /// - Throws: An error if recording stops with a problem.
    func stopRecording() -> RecordingResult? {
        guard isRecording || isPrepared else { return nil }
        
        // Set stopping flag to prevent race conditions with background/foreground transitions
        stopping = true
        cancelMaxDurationTimer()
        
        Logger.debug("Stopping recording...")
        
        // IMPORTANT: Emit any remaining audio data before stopping the engine.
        // Atomic snapshot avoids the race documented in #314.
        if isRecording {
            let finalData = takeAccumulatedSnapshot()
            if !finalData.isEmpty {
                Logger.debug("Emitting final audio chunk of \(finalData.count) bytes before stopping")
                let recordingTime = currentRecordingDuration()
                let finalTotalSize = self.totalDataSize

                delegate?.audioStreamManager(
                    self,
                    didReceiveAudioData: finalData,
                    recordingTime: recordingTime,
                    totalDataSize: finalTotalSize,
                    compressionInfo: buildCompressionInfo()
                )
            }
        }

        disableWakeLock()
        
        // Handle audio engine operations directly - no need for try-catch
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        
        // Stop compressed recording if active and update cached size
        if let recorder = compressedRecorder {
            recorder.stop()
            
            // Update cached compressed file size after stopping
            if let compressedURL = compressedFileURL {
                do {
                    let attributes = try FileManager.default.attributesOfItem(atPath: compressedURL.path)
                    if let size = attributes[.size] as? Int64 {
                        cachedCompressedFileSize = size
                        Logger.debug("Updated compressed file size after stop: \(size) bytes")
                    }
                } catch {
                    Logger.debug("Failed to update compressed file size: \(error)")
                }
            }
        }
        
        // Get the final duration before changing state
        let finalDuration = currentRecordingDuration()
        
        let wasRecording = isRecording
        isRecording = false
        isPaused = false
        pausedBySystemInterruption = false
        isPrepared = false // Reset preparation state
        
        // If we were only prepared but never started recording, clean up and return nil
        if !wasRecording {
            cleanupPreparation()
            stopping = false // Reset stopping flag
            return nil
        }
        
        // PERFORMANCE OPTIMIZATION: Capture current state for immediate return
        let capturedFileURL = recordingFileURL
        let capturedSettings = recordingSettings
        let capturedWavFileSize = cachedWavFileSize
        let capturedCompressedFileSize = cachedCompressedFileSize
        let capturedCompressedURL = compressedFileURL
        
        // PERFORMANCE OPTIMIZATION: Move all slow operations to background
        let capturedShowNotification = recordingSettings?.showNotification == true
        
        // Queue notification and audio session cleanup for background
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            
            if capturedShowNotification {
                // Clean up notifications on main queue but don't wait
                DispatchQueue.main.async {
                    self.mediaInfoUpdateTimer?.invalidate()
                    self.mediaInfoUpdateTimer = nil
                    
                    // Clean up notification manager
                    self.notificationManager?.stopUpdates()
                    self.notificationManager = nil
                    
                    // Clean up media controls
                    UIApplication.shared.endReceivingRemoteControlEvents()
                    self.remoteCommandCenter?.pauseCommand.isEnabled = false
                    self.remoteCommandCenter?.playCommand.isEnabled = false
                    self.notificationView?.nowPlayingInfo = nil
                }
            }
            
            // Reset audio session in background
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                Logger.debug("Background: Error deactivating audio session: \(error)")
            }
            
            // Reset audio engine in background
            DispatchQueue.main.async {
                self.audioEngine.reset()
            }
        }
        
        guard let settings = recordingSettings else {
            Logger.debug("Recording settings is nil.")
            stopping = false // Reset stopping flag before returning nil
            return nil
        }
        
        // For streaming-only mode (no primary output), create a result without file validation
        if !settings.output.primary.enabled {
            let durationMs = Int64(finalDuration * 1000)
            
            // Check for compressed output using cached size
            var compression: CompressedRecordingInfo?
            if settings.output.compressed.enabled, 
               let compressedURL = capturedCompressedURL,
               capturedCompressedFileSize > 0 {
                compression = CompressedRecordingInfo(
                    compressedFileUri: compressedURL.absoluteString,
                    mimeType: compressedFormat == "aac" ? "audio/aac" : "audio/opus",
                    bitrate: compressedBitRate,
                    format: compressedFormat,
                    size: capturedCompressedFileSize
                )
                
                Logger.debug("""
                    Compressed File (cached - primary disabled):
                    - Format: \(compressedFormat)
                    - Size: \(capturedCompressedFileSize) bytes
                    - Bitrate: \(compressedBitRate) bps
                    """)
            }
            
            let result = RecordingResult(
                fileUri: compression?.compressedFileUri ?? "",  // Use compressed URI if available
                filename: compression != nil ? (compressedFileURL?.lastPathComponent ?? "compressed-audio") : "stream-only",
                mimeType: compression?.mimeType ?? mimeType,
                duration: durationMs,
                size: compression?.size ?? totalDataSize,
                channels: settings.numberOfChannels,
                bitDepth: settings.bitDepth,
                sampleRate: settings.sampleRate,
                compression: compression
            )
            
            // Cleanup
            recordingSettings = nil
            startTime = nil
            totalPausedDuration = 0
            currentPauseStart = nil
            lastEmissionTime = nil
            lastEmissionTimeAnalysis = nil
            lastEmittedSize = 0
            lastEmittedSizeAnalysis = 0
            lastEmittedCompressedSize = 0
            resetAccumulated()
            recordingUUID = nil
            totalDataSize = 0
            
            stopping = false
            return result
        }
        
        guard let fileURL = capturedFileURL else {
            Logger.debug("Recording file URL is nil.")
            stopping = false // Reset stopping flag before returning nil
            return nil
        }
        
        // PERFORMANCE OPTIMIZATION: Create result immediately with cached values
        let durationMs = Int64(finalDuration * 1000)
        
        // Check compressed output
        var compression: CompressedRecordingInfo?
        if capturedSettings?.output.compressed.enabled == true, 
           let compressedURL = capturedCompressedURL,
           capturedCompressedFileSize > 0 {
            compression = CompressedRecordingInfo(
                compressedFileUri: compressedURL.absoluteString,
                mimeType: compressedFormat == "aac" ? "audio/aac" : "audio/opus",
                bitrate: compressedBitRate,
                format: compressedFormat,
                size: capturedCompressedFileSize
            )
        }
        
        // Finalize the WAV header BEFORE returning. Consumers routinely parse or
        // convert the returned file immediately, and finalizing asynchronously let
        // stopRecording() resolve while the RIFF/data sizes could still be stale
        // (issue #424). Running synchronously on fileWriteQueue also drains any PCM
        // appends still queued, so the reported size matches the bytes on disk.
        //
        // This is a bounded write (a seek plus WAV_HEADER_SIZE bytes at the head of
        // the file), not a re-encode. State teardown below stays asynchronous.
        var finalWavFileSize = capturedWavFileSize
        var degradedPrimary: String?
        var primaryUnusable = false
        var alreadyReported = false
        fileWriteQueue.sync {
            // The write path may already have reported a failure it could observe while
            // running. One report per recording is the documented contract.
            alreadyReported = self.primaryWriteFailureReported

            // Reconcile the counters against the file. Once writes stop being accepted —
            // an unrecoverable handle, or a file that shrank below what was counted (#420)
            // — totalDataSize keeps the length the recording *would* have had, and sizing
            // the header from it describes audio that is not there. The file can also be
            // longer, when a write committed a prefix and neither recovery nor truncation
            // cleaned it up; those bytes are not known to be whole frames.
            let physicalSize = (
                try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber
            )??.int64Value

            let accountedSize = self.cachedWavFileSize
            finalWavFileSize = PrimaryWriteFailurePolicy.finalSize(
                physicalSize: physicalSize,
                accountedSize: accountedSize
            )

            if physicalSize == nil {
                degradedPrimary = "the primary WAV could not be measured at stop, "
                    + "so its reported size may not match the file"
            } else if let physicalSize = physicalSize, physicalSize != accountedSize {
                degradedPrimary = "the primary WAV holds \(physicalSize) bytes but "
                    + "\(accountedSize) were recorded"
                Logger.debug(
                    "AudioStreamManager",
                    "Primary WAV mismatch: physical \(physicalSize), accounted \(accountedSize); "
                    + "finalizing at \(finalWavFileSize)."
                )
            }

            guard PrimaryWriteFailurePolicy.isUsableWav(finalSize: finalWavFileSize) else {
                // Shorter than a header: nothing will open it. Leave the file alone and
                // let the caller-facing check below refuse to return it as a recording.
                primaryUnusable = true
                degradedPrimary = "the primary WAV is \(finalWavFileSize) bytes, "
                    + "too short to contain a header"
                Logger.debug("AudioStreamManager", "Primary WAV unusable at \(finalWavFileSize) bytes.")
                return
            }

            if let physicalSize = physicalSize, physicalSize > finalWavFileSize {
                // Drop the unaccounted tail so the file matches the header written below.
                // A failure here leaves the file longer than the header describes, which
                // is the corruption this is preventing, so it is not swallowed.
                do {
                    let handle = try FileHandle(forWritingTo: fileURL)
                    defer { try? handle.close() }
                    try handle.truncate(atOffset: UInt64(finalWavFileSize))

                    let remeasured = (
                        try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber
                    )??.int64Value
                    if remeasured != finalWavFileSize {
                        throw NSError(
                            domain: "AudioStreamManager",
                            code: 5,
                            userInfo: [NSLocalizedDescriptionKey:
                                "Primary WAV is \(remeasured.map(String.init) ?? "unreadable") bytes "
                                + "after truncating to \(finalWavFileSize)"]
                        )
                    }
                } catch {
                    primaryUnusable = true
                    degradedPrimary = "the primary WAV could not be trimmed to the bytes that "
                        + "were recorded: \(error.localizedDescription)"
                    Logger.debug(
                        "AudioStreamManager",
                        "Failed to truncate primary WAV: \(error.localizedDescription)"
                    )
                    return
                }
            }

            let finalDataChunkSize = finalWavFileSize - Int64(WAV_HEADER_SIZE)
            if finalDataChunkSize >= 0 {
                self.updateWavHeader(fileURL: fileURL, totalDataSize: finalDataChunkSize)
                Logger.debug("WAV header finalized before return. Data chunk size: \(finalDataChunkSize)")
            }
        }


        // A degradation only detectable at stop — a file that shrank, grew past what was
        // counted, or cannot be measured — has not been reported yet: the write path
        // reports what it observes while running, and these were not observable there.
        // The returned size is truthful either way, but silence would read as a healthy
        // recording, which is the failure #420 is about.
        // Suppressed only when the write path already reported and the file is still
        // usable — that is the same failure said twice. An unusable file is a different,
        // worse fact than "writes stopped", so it is always reported.
        if let degradedPrimary = degradedPrimary, !alreadyReported || primaryUnusable {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.delegate?.audioStreamManager(
                    self,
                    didFailWithError: "Primary WAV output degraded: \(degradedPrimary)."
                )
            }
        }

        // Create result once the file is final, so `size` matches what is on disk.
        let result = RecordingResult(
            fileUri: fileURL.absoluteString,
            filename: fileURL.lastPathComponent,
            mimeType: mimeType,
            duration: durationMs,
            size: finalWavFileSize,
            channels: capturedSettings?.numberOfChannels ?? 1,
            bitDepth: capturedSettings?.bitDepth ?? 16,
            sampleRate: capturedSettings?.sampleRate ?? 44100,
            compression: compression
        )

        // Remaining state teardown stays asynchronous after returning result
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            
            // Cleanup
            self.recordingSettings = nil
            self.startTime = nil
            self.totalPausedDuration = 0
            self.currentPauseStart = nil
            self.lastEmissionTime = nil
            self.lastEmissionTimeAnalysis = nil
            self.lastEmittedSize = 0
            self.lastEmittedSizeAnalysis = 0
            self.lastEmittedCompressedSize = 0
            self.resetAccumulated()
            self.recordingUUID = nil
            self.totalDataSize = 0
            self.cachedWavFileSize = 0
            self.cachedCompressedFileSize = 0
            self.recordingFileURL = nil
            self.compressedFileURL = nil
            self.fileHandle = nil
        }
        
        stopping = false

        // A primary WAV too short to hold a header, or one that could not be trimmed to
        // the bytes recorded, is not a file a caller can use. Pointing the result at it
        // would resolve stopRecording() with something nothing can open — the silent
        // success this issue is about.
        //
        // Fail the stop rather than substituting the compressed sidecar. The top-level
        // result fields are documented as the primary output, and callers derive paths
        // from them: the playground writes metadata to
        // `fileUri.replace(/\.wav$/, '.json')`, which against an `.m4a` URI is a no-op
        // that overwrites the surviving audio with JSON. A resolved promise carrying a
        // different file is worse than a rejected one. The compressed file stays on disk,
        // and the delegate error names what failed.
        if primaryUnusable {
            Logger.debug("AudioStreamManager", "Refusing to return an unusable primary WAV.")
            return nil
        }

        return result
    }


    // MARK: - AudioDeviceManagerDelegate Implementation

    func audioDeviceManager(_ manager: AudioDeviceManager, didDetectDisconnectionOfDevice disconnectedDeviceId: String) {
        // This method will be called by AudioDeviceManager when a disconnection occurs
        // Run on main thread to safely interact with AVAudioEngine and state
        DispatchQueue.main.async {
            self.handleDeviceDisconnection(disconnectedDeviceId: disconnectedDeviceId)
        }
    }

    // MARK: - Device Disconnection Handling

    // Define interruption reasons matching AudioStudio.types.ts
    enum RecordingInterruptionReason: String {
        case deviceDisconnected = "deviceDisconnected"
        case deviceFallback = "deviceFallback"
        case deviceSwitchFailed = "deviceSwitchFailed"
        // Add other reasons if needed (e.g., from handleAudioSessionInterruption)
        case audioFocusLoss = "audioFocusLoss"
        case audioFocusGain = "audioFocusGain"
        case phoneCall = "phoneCall"
        case phoneCallEnded = "phoneCallEnded"
        case recordingStopped = "recordingStopped"
        case deviceConnected = "deviceConnected"
    }

    private func handleDeviceDisconnection(disconnectedDeviceId: String) {
        Logger.debug("handleDeviceDisconnection entered. isRecording: \(isRecording), settingsExist: \(recordingSettings != nil), deviceIdExists: \(recordingSettings?.deviceId != nil), currentDeviceId: \(recordingSettings?.deviceId ?? "nil")")

        // --- Modify Guard: Only require settings object, handle nil deviceId later ---
        guard let settings = recordingSettings else {
             // If settings are nil, we truly can't determine behavior, so pause.
             Logger.debug("Device disconnected (\(disconnectedDeviceId)), but recordingSettings object is missing. Pausing.")
             performPauseAction(reason: .deviceDisconnected)
             return
        }
        // We now have settings, proceed even if deviceId might be nil inside it.
        let currentRecordingDeviceId = settings.deviceId // This might be nil, handle below
        // --- End Modify Guard ---

        // Normalize BOTH IDs for reliable comparison
        // Use "nil" if currentRecordingDeviceId is actually nil
        let normalizedCurrentId = deviceManager.normalizeBluetoothDeviceId(currentRecordingDeviceId ?? "nil") 
        let normalizedDisconnectedId = deviceManager.normalizeBluetoothDeviceId(disconnectedDeviceId)

        Logger.debug("Handling disconnection. Current device: \(normalizedCurrentId), Disconnected device: \(normalizedDisconnectedId)")

        // Check if the disconnected device is the one we *thought* we were recording from
        if normalizedCurrentId == normalizedDisconnectedId || currentRecordingDeviceId == nil {
            // If the IDs match OR if the stored deviceId was nil (meaning we lost track),
            // assume this disconnection applies to our current recording session.
            
            Logger.debug("Disconnection event matches current recording session (or session deviceId was lost). Applying behavior...")

            // Get the string value from settings using the correct property name
            // The property in RecordingSettings likely matches the TS interface: deviceDisconnectionBehavior
            let behaviorString = settings.deviceDisconnectionBehavior.rawValue // Get the raw value from the enum
            let behavior = DeviceDisconnectionBehavior(rawValue: behaviorString) ?? .PAUSE // Convert to enum, default to .PAUSE

            Logger.debug("Recording device disconnected! Applying behavior: \(behavior.rawValue)")

            delegate?.audioStreamManager(self, didReceiveInterruption: [
                "reason": RecordingInterruptionReason.deviceDisconnected.rawValue,
                "isPaused": isPaused
            ])

            // Switch on the *enum* value
            switch behavior {
            case .PAUSE:
                Logger.debug("Device disconnect behavior set to PAUSE. Pausing recording.")
                performPauseAction(reason: .deviceDisconnected)

            case .FALLBACK:
                Logger.debug("Device disconnect behavior set to FALLBACK. Attempting to switch to default device.")
                Task { 
                    await performFallbackAction()
                }
            }
        } else {
             Logger.debug("A different device disconnected (\(normalizedDisconnectedId)). Current recording device (\(normalizedCurrentId)) is still active. Ignoring.")
        }
    }

    private func performPauseAction(reason: RecordingInterruptionReason) {
        if !isPaused { // Only pause if not already paused
            Logger.debug("Pausing recording due to \(reason.rawValue)")
            pauseRecording() // Use existing pause function
        } else {
            Logger.debug("Recording was already paused when \(reason.rawValue) occurred.")
        }
        // Note: pauseRecording already notifies the delegate about the pause state change.
        // Send an additional interruption notification specifically for the reason
         delegate?.audioStreamManager(self, didReceiveInterruption: [
             "reason": reason.rawValue,
             "isPaused": true // Since we are pausing or were already paused
         ])
    }

    private func performFallbackAction() async {
        Logger.debug("Attempting to fallback to default device...")

        do {
            // 1. Get the new default device (using the async version)
            guard let defaultDevice = await deviceManager.getDefaultInputDevice() else {
                 Logger.debug("Fallback failed: Could not get default input device. Pausing.")
                 performPauseAction(reason: .deviceSwitchFailed) // Fallback to pause if no default
                 return
            }
            Logger.debug("Found default device for fallback: \(defaultDevice.name) (ID: \(defaultDevice.id))")

            // CRITICAL: Complete engine reset - stronger than just pausing
            audioEngine.stop()
            audioEngine.reset() // Reset the entire engine
            audioEngine.inputNode.removeTap(onBus: 0)
            
            // More aggressive session reset
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setActive(false, options: .notifyOthersOnDeactivation)
                try await Task.sleep(nanoseconds: 200_000_000) // Give system time to release resources
                
                // Reconfigure the session completely
                try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .mixWithOthers])
                try session.setActive(true, options: .notifyOthersOnDeactivation)
                try await Task.sleep(nanoseconds: 100_000_000) // Allow the session to activate fully
            } catch {
                Logger.debug("Session reset error: \(error.localizedDescription)")
            }
            
            let wasManuallyPaused = isPaused

            // 3. Update settings and select the new device in the session
            recordingSettings?.deviceId = defaultDevice.id // Update setting
            let selectionSuccess = await deviceManager.selectDevice(defaultDevice.id)
            if !selectionSuccess {
                Logger.debug("Fallback failed: Could not select default device in session. Pausing.")
                performPauseAction(reason: .deviceSwitchFailed)
                return
            }
            Logger.debug("Successfully selected default device \(defaultDevice.id) in session.")
            
            // Additional forced reset of engine to ensure clean state
            audioEngine.reset()
            audioEngine.prepare()
            
            // Create a simplified tap block for fallback - rely on processAudioBuffer for proper emission
            let fallbackTapBlock = { [weak self] (buffer: AVAudioPCMBuffer, time: AVAudioTime) -> Void in
                guard let self = self, self.isRecording else { return }
                
                // Process the buffer normally - processAudioBuffer handles all emission logic
                self.processAudioBuffer(buffer)
                self.lastBufferTime = time
            }
            
            // Use our shared tap installation method with the custom block
            let tapInstall = installTapWithHardwareFormat(customTapBlock: fallbackTapBlock)
            guard tapInstall.installed else {
                Logger.debug("Fallback failed: Could not install audio tap. Pausing.")
                performPauseAction(reason: .deviceSwitchFailed)
                return
            }
            Logger.debug("Fallback: Re-installed tap with simplified emission handling")
            
            // Force prepare engine again to ensure it's ready
            audioEngine.prepare()
            Logger.debug("Fallback: Prepared audio engine.")

            if !wasManuallyPaused {
                // Only start if it's not running (it should have been paused earlier)
                if !audioEngine.isRunning {
                    do {
                        try audioEngine.start()
                        Logger.debug("Audio engine restarted for fallback.")
                    } catch {
                        // Try ONE more time with delay
                        try await Task.sleep(nanoseconds: 200_000_000)
                        do {
                            try audioEngine.start()
                            Logger.debug("Audio engine restarted on second attempt after fallback.")
                        } catch {
                            Logger.debug("Fallback failed: Could not restart audio engine after tap reinstall. Pausing. Error: \(error)")
                            performPauseAction(reason: .deviceSwitchFailed)
                            return
                        }
                    }
                } else {
                    Logger.debug("Audio engine was already running during fallback attempt? Unexpected state.")
                }
            } else {
                Logger.debug("Recording was manually paused, leaving engine paused after fallback.")
            }

            // Emit any remaining audio data from the previous device, then
            // wipe both buffers atomically (analysis buffer is discarded since
            // we want to start fresh on the fallback device).
            let finalData = takeAccumulatedSnapshot()
            _ = takeAccumulatedAnalysisSnapshot()
            if !finalData.isEmpty {
                Logger.debug("Emitting final audio chunk of \(finalData.count) bytes from previous device")
                let recordingTime = currentRecordingDuration()
                let finalTotalSize = self.totalDataSize

                delegate?.audioStreamManager(
                    self,
                    didReceiveAudioData: finalData,
                    recordingTime: recordingTime,
                    totalDataSize: finalTotalSize,
                    compressionInfo: buildCompressionInfo()
                )
            }

            // Reset emission timers to force new data emission with the fallback device
            lastEmissionTime = Date() // Reset to force immediate emission
            lastEmissionTimeAnalysis = Date() // Reset analysis timer too
            Logger.debug("Emission timers reset. Current totalDataSize: \(totalDataSize)")

            // CRITICAL: Multiple scheduled recovery attempts
            for delaySeconds in [0.5, 1.0, 2.0, 3.0] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delaySeconds) { [weak self] in
                    guard let self = self, self.isRecording, !self.isPaused else { return }
                    Logger.debug("FALLBACK RECOVERY: Checking for data at \(delaySeconds)s")
                    
                    // Force an immediate emission if data is being received but not emitted
                    let dataToEmit = self.takeAccumulatedSnapshot()
                    if !dataToEmit.isEmpty {
                        Logger.debug("FALLBACK RECOVERY: Forcing emission from accumulated data after \(delaySeconds)s (total size: \(self.totalDataSize))")
                        let recordingTime = self.currentRecordingDuration()
                        let totalSize = self.totalDataSize

                        self.lastEmissionTime = Date() // Reset the emission timer
                        
                        // Direct delegate call with accumulated data
                        self.delegate?.audioStreamManager(
                            self,
                            didReceiveAudioData: dataToEmit,
                            recordingTime: recordingTime,
                            totalDataSize: totalSize,
                            compressionInfo: self.buildCompressionInfo()
                        )
                    }
                    
                    // If we're at the 3-second mark and the engine appears to not be running, attempt restart
                    if delaySeconds >= 3.0 && (!self.audioEngine.isRunning || self.lastEmissionTime!.timeIntervalSinceNow < -3) {
                        Logger.debug("FALLBACK RECOVERY: Emergency engine restart attempt")
                        do {
                            self.audioEngine.reset()
                            self.audioEngine.prepare()
                            try self.audioEngine.start()
                            self.lastEmissionTime = Date()
                        } catch {
                            Logger.debug("Emergency restart failed: \(error)")
                        }
                    }
                }
            }

            // 7. Notify JS about successful fallback
            delegate?.audioStreamManager(self, didReceiveInterruption: [
                "reason": RecordingInterruptionReason.deviceFallback.rawValue,
                "newDeviceId": defaultDevice.id, // Include new device ID
                "isPaused": isPaused // Report current state
            ])
            Logger.debug("Fallback to device \(defaultDevice.id) successful.")
            
            // Make the catch block reachable by throwing an error unconditionally
            // This is required to fix a compiler warning about unreachable catch block
            throw NSError(domain: "AudioStreamManager", code: 1, userInfo: [NSLocalizedDescriptionKey: "Intentional error to make catch block reachable"])

        } catch {
             Logger.debug("Fallback failed with error: \(error). Pausing.")
             performPauseAction(reason: .deviceSwitchFailed)
        }
    }

    private func configureAudioSession(for settings: RecordingSettings) throws {
        let session = AVAudioSession.sharedInstance()
        
        // Get base configuration from user settings or defaults
        var category: AVAudioSession.Category = .playAndRecord
        var mode: AVAudioSession.Mode = .default
        var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .mixWithOthers]
        
        if let audioSessionConfig = settings.ios?.audioSession {
            category = audioSessionConfig.category
            mode = audioSessionConfig.mode
            options = audioSessionConfig.categoryOptions
        }
        
        // Append necessary options for background recording if keepAwake is enabled
        if settings.keepAwake {
            Logger.debug("AudioStreamManager", "keepAwake enabled - configuring for background recording")
            // Set the category to PlayAndRecord with proper background options
            options.insert(.mixWithOthers)
            // Add duckOthers to reduce volume of other apps instead of stopping them
            options.insert(.duckOthers)
            
            // Configure audio session for background audio
            do {
                try session.setCategory(.playAndRecord, mode: .default, options: options)
                try session.setActive(true, options: .notifyOthersOnDeactivation)
                // Ensure the app has appropriate Info.plist settings for background audio
                Logger.debug("AudioStreamManager", "Audio session configured for background recording with options: \(options)")
            } catch {
                Logger.debug("AudioStreamManager", "Failed to configure audio session for background: \(error)")
                try session.setActive(true, options: .notifyOthersOnDeactivation)
            }
        } else {
            Logger.debug("AudioStreamManager", "keepAwake disabled - using standard session configuration")
            // If keepAwake is false, don't add background audio options
            try session.setActive(true)
        }
        
        // Apply the final configuration
        try session.setCategory(category, mode: mode, options: options)
        
        Logger.debug("AudioStreamManager", "Audio session configured with category: \(category), mode: \(mode), options: \(options)")
    }
}

internal struct AutoResumePolicy {
    /// Auto-resume only when a system interruption caused the pause.
    /// User-initiated pauses must remain paused after the interruption ends.
    static func shouldAutoResume(
        autoResumeAfterInterruption: Bool,
        isRecording: Bool,
        isPaused: Bool,
        pausedBySystemInterruption: Bool
    ) -> Bool {
        return autoResumeAfterInterruption &&
            isRecording &&
            isPaused &&
            pausedBySystemInterruption
    }
}

internal struct InterruptionOptionsPolicy {
    static func options(from userInfo: [AnyHashable: Any]) -> AVAudioSession.InterruptionOptions {
        guard let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt else {
            // Some background call-decline paths omit this key. Treat it as
            // "no explicit shouldResume hint" instead of skipping ended
            // handling entirely.
            return []
        }

        return AVAudioSession.InterruptionOptions(rawValue: optionsValue)
    }
}

internal struct AudioTapInstallPolicy {
    static func shouldInstallTap(
        channelCount: AVAudioChannelCount,
        sampleRate: Double
    ) -> Bool {
        channelCount > 0 && sampleRate > 0
    }
}

extension AudioStreamManager: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        switch response.actionIdentifier {
        case "PAUSE_RECORDING":
            pauseRecording()
        case "RESUME_RECORDING":
            resumeRecording()
        default:
            break
        }
        completionHandler()
    }

    // This is needed to show notifications when app is in foreground
    func userNotificationCenter(
            _ center: UNUserNotificationCenter,
            willPresent notification: UNNotification,
            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
        ) {
            if #available(iOS 14.0, *) {
                completionHandler([.banner, .sound])
            } else {
                // For iOS 13 and earlier
                completionHandler([.alert, .sound])
            }
        }
}

// Add AVAudioRecorderDelegate conformance
extension AudioStreamManager: AVAudioRecorderDelegate {
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Logger.debug("Compressed recording finished - success: \(flag)")
        if !flag {
            delegate?.audioStreamManager(self, didFailWithError: "Compressed recording failed to complete")
        } else {
            // Update cached compressed file size when recording finishes
            if let compressedURL = compressedFileURL {
                do {
                    let attributes = try FileManager.default.attributesOfItem(atPath: compressedURL.path)
                    if let size = attributes[.size] as? Int64 {
                        cachedCompressedFileSize = size
                        Logger.debug("Cached compressed file size: \(size) bytes")
                    }
                } catch {
                    Logger.debug("Failed to cache compressed file size: \(error)")
                }
            }
        }
    }
    
    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        if let error = error {
            Logger.debug("Compressed recording encode error: \(error)")
            delegate?.audioStreamManager(self, didFailWithError: "Compressed recording encode error: \(error.localizedDescription)")
        }
    }
}
