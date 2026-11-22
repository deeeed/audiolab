import XCTest
@testable import AudioStudio

/// Regression coverage for issue #423.
///
/// The Expo bridge hands JS numbers to Swift as `Double`, so reading them with
/// `dict["x"] as? Int` returned nil and every numeric option silently fell back
/// to its default — `onAudioStream` stayed pinned at the 1s default no matter
/// what `interval` was requested.
///
/// These tests feed the same shapes the bridge actually delivers. Reverting
/// `bridgedInt` to `as? Int` fails `testDoubleBackedIntIsReadAsInt`,
/// `testInt64ReadsLargeDurations`, and the `fromDictionary` cases; reverting
/// `bridgedDouble` to `as? Double` fails `testDoubleReadsSampleRate` (the
/// Int-backed input). The pre-existing `EventEmissionIntervalTests` could not
/// catch #423 at all: it builds a Swift `RecordingConfig` directly and never
/// crosses the dictionary boundary where the bug lived.
///
/// Run with `yarn workspace @siteed/audio-studio test:ios`, which compiles these
/// through `packages/audio-studio/Package.swift` against the real sources in
/// `ios/` — so the assertions run on shipped code, never a copy.
final class BridgedNumericOptionsTests: XCTestCase {

    // MARK: - The exact failure mode from #423

    func testDoubleBackedIntIsReadAsInt() {
        // This is what Expo actually delivers for `interval: 100`.
        let dict: [String: Any] = ["interval": Double(100)]

        XCTAssertNil(
            dict["interval"] as? Int,
            "Precondition: `as? Int` must fail on a Double — this is the bug being guarded"
        )
        XCTAssertEqual(
            bridgedInt(dict, "interval"), 100,
            "bridgedInt must read a Double-backed numeric option"
        )
    }

    func testNativeIntAndNSNumberStillWork() {
        XCTAssertEqual(bridgedInt(["v": Int(42)], "v"), 42)
        XCTAssertEqual(bridgedInt(["v": NSNumber(value: 42)], "v"), 42)
    }

    func testMissingKeyReturnsNilSoCallerDefaultApplies() {
        XCTAssertNil(bridgedInt([:], "interval"))
        XCTAssertNil(bridgedDouble([:], "sampleRate"))
        XCTAssertNil(bridgedInt64([:], "maxDurationMs"))
    }

    func testNonNumericValuesReturnNil() {
        // The TS API never promises numeric strings; anything non-numeric must
        // fall through to the caller's default rather than be coerced.
        XCTAssertNil(bridgedInt(["v": "100"], "v"))
        XCTAssertNil(bridgedInt(["v": ["nested": 1]], "v"))
    }

    func testBoolBridgesAsNumber() {
        // Bool is NSNumber-backed on this platform, so it reads as 1/0 rather
        // than nil. No caller passes a Bool where a number is expected; this is
        // pinned so any future change to that behavior is a deliberate one.
        XCTAssertEqual(bridgedInt(["v": true], "v"), 1)
    }

    func testInt64ReadsLargeDurations() {
        // maxDurationMs exceeds Int32 for long recordings.
        let dict: [String: Any] = ["maxDurationMs": Double(9_000_000_000)]
        XCTAssertEqual(bridgedInt64(dict, "maxDurationMs"), 9_000_000_000)
    }

    func testDoubleReadsSampleRate() {
        XCTAssertEqual(bridgedDouble(["sampleRate": Double(44100)], "sampleRate"), 44100.0)
        XCTAssertEqual(bridgedDouble(["sampleRate": Int(16000)], "sampleRate"), 16000.0)
    }

    // MARK: - End-to-end through RecordingSettings.fromDictionary

    func testFromDictionaryParsesBridgedNumbers() {
        // Every numeric value arrives as Double, exactly as the bridge sends it.
        let dict: [String: Any] = [
            "sampleRate": Double(16000),
            "channels": Double(2),
            "bitDepth": Double(32),
            "interval": Double(250),
            "intervalAnalysis": Double(500),
            "segmentDurationMs": Double(150),
            "maxDurationMs": Double(60000),
        ]

        guard case .success(let settings) = RecordingSettings.fromDictionary(dict) else {
            return XCTFail("fromDictionary rejected a valid bridged payload")
        }

        XCTAssertEqual(settings.interval, 250, "interval must survive the bridge (#423)")
        XCTAssertEqual(settings.intervalAnalysis, 500)
        XCTAssertEqual(settings.numberOfChannels, 2)
        XCTAssertEqual(settings.bitDepth, 32)
        XCTAssertEqual(settings.segmentDurationMs, 150)
        XCTAssertEqual(settings.maxDurationMs, 60000)
        XCTAssertEqual(settings.sampleRate, 16000.0)
    }

    func testFromDictionaryFallsBackWhenOptionsAbsent() {
        // Defaults must still apply when the caller omits values entirely.
        guard case .success(let settings) = RecordingSettings.fromDictionary([:]) else {
            return XCTFail("fromDictionary rejected an empty payload")
        }

        XCTAssertNil(settings.interval, "absent interval stays nil so the manager default applies")
        XCTAssertEqual(settings.numberOfChannels, 1)
        XCTAssertEqual(settings.bitDepth, 16)
        XCTAssertEqual(settings.sampleRate, 44100.0)
    }

    func testCompressedBitrateSurvivesTheBridge() {
        let dict: [String: Any] = [
            "output": [
                "compressed": [
                    "enabled": true,
                    "format": "aac",
                    "bitrate": Double(96000),
                ] as [String: Any]
            ] as [String: Any]
        ]

        guard case .success(let settings) = RecordingSettings.fromDictionary(dict) else {
            return XCTFail("fromDictionary rejected a valid compressed payload")
        }
        XCTAssertEqual(settings.output.compressed.bitrate, 96000)
    }

    func testPreferRawStreamSurvivesTheBridge() {
        // #505: the compressed file extension, and so the AAC container, follows this flag.
        let compressed: [String: Any] = ["enabled": true, "format": "aac", "preferRawStream": true]
        guard case .success(let raw) = RecordingSettings.fromDictionary(["output": ["compressed": compressed]]),
              case .success(let absent) = RecordingSettings.fromDictionary(["output": ["compressed": ["enabled": true]]]) else {
            return XCTFail("fromDictionary rejected a valid compressed payload")
        }
        XCTAssertTrue(raw.output.compressed.preferRawStream)
        XCTAssertFalse(absent.output.compressed.preferRawStream, "absent flag keeps the M4A default")
    }

    // MARK: - Range guards (regression from the #423 bridging fix)

    func testNegativeChannelsFallsBackToDefault() {
        // Before bridging was fixed, `channels: -1` failed the `as? Int` cast and
        // silently defaulted to 1. Once the value parsed, it reached
        // `UInt32(numberOfChannels)` in createWavHeader, which TRAPS on a negative
        // value. The range guard restores the safe fallback deliberately.
        guard case .success(let settings) = RecordingSettings.fromDictionary(["channels": Double(-1)]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.numberOfChannels, 1, "negative channels must not reach UInt32()")
    }

    func testTrapProneValuesFallBackToDefaults() {
        let dict: [String: Any] = [
            "channels": Double(99),
            "bitDepth": Double(-8),
            "sampleRate": Double(-1),
            "segmentDurationMs": Double(0),
        ]
        guard case .success(let settings) = RecordingSettings.fromDictionary(dict) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.numberOfChannels, 1)
        XCTAssertEqual(settings.bitDepth, 16)
        XCTAssertEqual(settings.sampleRate, 44100.0)
        XCTAssertEqual(settings.segmentDurationMs, 100)
    }

    func testNonFiniteValuesAreRejected() {
        // NSNumber.doubleValue happily returns NaN/inf, and UInt32(Double.nan) traps.
        XCTAssertNil(bridgedDouble(["v": Double.nan], "v", in: 1...100))
        XCTAssertNil(bridgedDouble(["v": Double.infinity], "v", in: 1...100))

        guard case .success(let settings) = RecordingSettings.fromDictionary(["sampleRate": Double.nan]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.sampleRate, 44100.0, "NaN sampleRate must fall back")
    }

    func testInRangeValuesStillParse() {
        // The guards must not reject legitimate input.
        XCTAssertEqual(bridgedInt(["v": Double(2)], "v", in: 1...2), 2)
        XCTAssertEqual(bridgedDouble(["v": Double(48000)], "v", in: 1...768_000), 48000.0)
    }

    func testNegativeMaxDurationIsIgnored() {
        guard case .success(let settings) = RecordingSettings.fromDictionary(["maxDurationMs": Double(-5000)]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.maxDurationMs, 0, "negative maxDurationMs must not be applied")
    }

    // MARK: - Blockers found in cross-review of the guard commit

    func testLargeButValidValuesAreNotCapped() {
        // Guards must reject only what traps or corrupts. Inventing a ceiling the
        // public API never documented would silently disable a caller's setting —
        // the same silent-default failure mode as #423.
        let thirtyDaysMs = Double(30 * 24 * 60 * 60 * 1000)
        guard case .success(let settings) = RecordingSettings.fromDictionary([
            "maxDurationMs": thirtyDaysMs,
            "interval": Double(7_200_000),
            "sampleRate": Double(768_000),
        ]) else {
            return XCTFail("fromDictionary rejected large but valid values")
        }
        XCTAssertEqual(settings.maxDurationMs, Int64(thirtyDaysMs), "no invented maxDurationMs cap")
        XCTAssertEqual(settings.interval, 7_200_000, "no invented interval cap")
        XCTAssertEqual(settings.sampleRate, 768_000.0)
    }

    func testInfiniteMaxDurationIsRejected() {
        // NSNumber.int64Value maps +inf to Int64.max, which then traps when
        // scheduleMaxDurationTimer narrows it back to Int.
        XCTAssertNil(bridgedInt64(["v": Double.infinity], "v"))
        XCTAssertNil(bridgedInt64(["v": Double.nan], "v"))

        guard case .success(let settings) = RecordingSettings.fromDictionary(["maxDurationMs": Double.infinity]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.maxDurationMs, 0, "infinite maxDurationMs must not be applied")
    }

    func testUnsupportedBitDepthFallsBackTo16() {
        // AudioStreamManager writes every non-32 depth as pcmFormatInt16, so
        // accepting 8 or 24 would advertise a depth the file does not have.
        for depth in [Double(8), Double(9), Double(24)] {
            guard case .success(let settings) = RecordingSettings.fromDictionary(["bitDepth": depth]) else {
                return XCTFail("fromDictionary rejected bitDepth \(depth)")
            }
            XCTAssertEqual(settings.bitDepth, 16, "unsupported bitDepth \(depth) must fall back to 16")
        }
    }

    func testSupportedBitDepthsAreKept() {
        for depth in [Double(16), Double(32)] {
            guard case .success(let settings) = RecordingSettings.fromDictionary(["bitDepth": depth]) else {
                return XCTFail("fromDictionary rejected bitDepth \(depth)")
            }
            XCTAssertEqual(settings.bitDepth, Int(depth))
        }
    }

    // MARK: - Representability (round 3 blockers)

    func testHugeFiniteValuesAreRejectedBeforeNarrowing() {
        // 1e30 is finite, so an isFinite check alone lets it through — and then
        // Int(1e30) / AVAudioFramePosition(1e30) TRAP. Representability is the
        // real requirement, not an invented ceiling.
        XCTAssertNil(bridgedFiniteDouble(["v": Double(1e30)], "v"))
        XCTAssertNil(bridgedFiniteDouble(["v": -Double(1e30)], "v"))
        XCTAssertNotNil(bridgedFiniteDouble(["v": Double(86_400_000)], "v"),
                        "ordinary long-form timestamps must still parse")
    }

    func testSaturatingInt64IsRejected() {
        // NSNumber.int64Value SATURATES rather than failing: 1e30 becomes
        // Int64.max, and Double(Int64.max) -> Int then traps on rounding.
        XCTAssertNil(bridgedInt64(["v": Double(1e30)], "v"))

        guard case .success(let settings) = RecordingSettings.fromDictionary(["maxDurationMs": Double(1e30)]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.maxDurationMs, 0, "unrepresentable maxDurationMs must not be applied")
    }

    func testRealisticLongDurationsStillParse() {
        // The representability guard must not become a de-facto ceiling.
        let thirtyDaysMs = Double(30 * 24 * 60 * 60 * 1000)
        XCTAssertEqual(bridgedInt64(["v": thirtyDaysMs], "v"), Int64(thirtyDaysMs))
    }

    // MARK: - UInt32 narrowing (final review blocker)

    func testSampleRateBeyondUInt32FallsBack() {
        // createWavHeader does UInt32(sampleRate) and byteRate = sampleRate * blockAlign,
        // also UInt32. Int representability is NOT enough: 5e9 is a valid Int and
        // still traps at UInt32(...).
        let hugeRate = Double(5_000_000_000)
        XCTAssertNotNil(Int(exactly: hugeRate), "precondition: passes an Int-only guard")
        XCTAssertNil(UInt32(exactly: hugeRate), "precondition: UInt32() would trap")

        guard case .success(let settings) = RecordingSettings.fromDictionary(["sampleRate": hugeRate]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(settings.sampleRate, 44100.0, "unrepresentable sampleRate must fall back")
    }

    func testRealisticSampleRatesStillParse() {
        for rate in [Double(8_000), Double(44_100), Double(48_000), Double(192_000), Double(768_000)] {
            guard case .success(let settings) = RecordingSettings.fromDictionary(["sampleRate": rate]) else {
                return XCTFail("fromDictionary rejected sampleRate \(rate)")
            }
            XCTAssertEqual(settings.sampleRate, rate, "legitimate sample rates must not be clamped")
        }
    }

    func testSegmentDurationKeepsOnlyAPositivityCheck() {
        // segmentDurationMs is narrowed as AVAudioFrameCount(sampleRate * ms / 1000),
        // so the safe value depends on the FILE's sample rate — no bound on the
        // option alone can make that conversion safe. The clamp therefore lives at
        // the narrowing site in AudioProcessor; here we only reject non-positive
        // input and confirm large values are not silently rewritten.
        guard case .success(let zero) = RecordingSettings.fromDictionary(["segmentDurationMs": Double(0)]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(zero.segmentDurationMs, 100, "non-positive must fall back to the default")

        guard case .success(let large) = RecordingSettings.fromDictionary(["segmentDurationMs": Double(3_600_000)]) else {
            return XCTFail("fromDictionary rejected the payload")
        }
        XCTAssertEqual(large.segmentDurationMs, 3_600_000, "a 1h segment is valid and must not be clamped")
    }
}
