# Audio Format Enhancement Specification

## Executive Summary

This document outlines a comprehensive enhancement to expo-audio-studio's audio format support, addressing:
1. Fixing file extension inconsistency on iOS (Issue #253)
2. Clarifying container vs codec distinctions
3. Implementing platform-appropriate format handling
4. Ensuring cross-platform consistency

## Immediate Workaround for Issue #253

**iOS Users**: The compressed AAC files are already in M4A format! Simply rename files from `.aac` to `.m4a` for proper seeking support. No conversion needed.

## Current State Analysis

### Existing Format Support

| Platform | Format | Actual Output | Current Extension | Correct Extension | Notes |
|----------|--------|---------------|-------------------|-------------------|-------|
| iOS | AAC | M4A/MP4 container | .aac | .m4a | AVAudioRecorder outputs M4A, not raw AAC |
| Android | AAC | ADTS stream | .aac | .aac | Correct - uses AAC_ADTS format |
| Web | Opus | WebM container | .webm | .webm | Correct - MediaRecorder limitation |
| All | WAV | RIFF/WAVE | .wav | .wav | Correct - uncompressed PCM |

### Current Implementation Issues

1. **iOS File Extension Mismatch**: iOS uses `kAudioFormatMPEG4AAC` which produces M4A container files, but saves with `.aac` extension
2. **No Raw AAC on iOS**: iOS cannot produce raw AAC streams directly; AVAudioRecorder always uses M4A container
3. **Inconsistent Container Behavior**: iOS produces containerized audio while Android produces raw streams
4. **Format Fallback Not Implemented**: iOS code attempts to use Opus but this isn't supported by AVAudioRecorder

## Why MP3 is Not Supported

MP3 encoding is not available in native recording APIs for several reasons:
1. **Patent History**: MP3 was heavily patented until 2017, requiring expensive licensing fees
2. **Platform Decisions**: Both iOS and Android chose AAC as their preferred format
3. **Technical Superiority**: AAC offers better quality at lower bitrates than MP3
4. **No Retrofit**: Even after patents expired, platforms haven't added MP3 encoding support

## Opus Support Analysis (Verified)

Despite `kAudioFormatOpus` being defined in iOS SDK:
1. **Constant Exists**: `kAudioFormatOpus = 1869641075` (0x6f707573 = 'opus')
2. **No Errors**: AVAudioRecorder accepts Opus settings without throwing errors
3. **Silent Failure**: Recording produces 0-byte files - no actual encoding occurs
4. **Fallback Required**: The expo-audio-studio correctly implements AAC fallback

## Proposed Enhancement

### Understanding Native Capabilities

Each platform has different capabilities for real-time audio encoding:

| Platform | Direct AAC Output | Direct M4A Output | Direct Opus Output | Container Control |
|----------|-------------------|-------------------|--------------------|-------------------|
| iOS | ❌ | ✅ (via kAudioFormatMPEG4AAC) | ❌ | Limited |
| Android | ✅ (ADTS) | ✅ (MPEG_4) | ✅ | Full |
| Web | ❌ | ❌ | ✅ (WebM) | None |

### Simplified Format Architecture

```typescript
export interface CompressedOutput {
  enabled?: boolean;
  format?: 'aac' | 'opus';  // Keep existing options
  // New field to control container behavior
  useContainer?: boolean;    // Default: platform-specific
  bitrate?: number;
}
```

### Platform-Specific Behavior

| Format Setting | iOS Output | Android Output | Web Output |
|----------------|------------|----------------|------------|
| format: 'aac', useContainer: false | M4A (.m4a)* | AAC ADTS (.aac) | Opus/WebM (.webm) |
| format: 'aac', useContainer: true | M4A (.m4a) | M4A (.m4a) | Opus/WebM (.webm) |
| format: 'opus' | M4A (.m4a)** | Opus/OGG (.opus) | Opus/WebM (.webm) |

\* iOS cannot produce raw AAC streams  
\** iOS does not support Opus encoding

### Implementation Strategy

#### Phase 1: Fix iOS File Extension (Immediate)
```swift
// iOS - AudioStreamManager.swift
private func getFileExtension(format: String, isCompressed: Bool) -> String {
    if !isCompressed {
        return "wav"
    }
    
    // iOS always produces M4A container when using AAC
    switch format.lowercased() {
    case "aac":
        return "m4a"  // Fix: use correct extension for M4A container
    case "opus":
        return "m4a"  // Fallback: iOS doesn't support Opus
    default:
        return "m4a"
    }
}
```

#### Phase 2: Add Container Control (Future)
```kotlin
// Android - AudioRecorderManager.kt
private fun configureMediaRecorder(config: RecordingConfig) {
    val useContainer = config.output.compressed.useContainer ?: false
    
    when (config.output.compressed.format) {
        "aac" -> {
            if (useContainer) {
                mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                // This produces .m4a files
            } else {
                mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS)
                // This produces .aac files
            }
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        }
        "opus" -> {
            mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.OGG)
            mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
        }
    }
}

private fun getFileExtension(format: String, useContainer: Boolean?): String {
    return when (format) {
        "aac" -> if (useContainer == true) "m4a" else "aac"
        "opus" -> "opus"
        else -> "aac"
    }
}
```

## Key Insights

### 1. iOS Already Produces M4A Files
- iOS `AVAudioRecorder` with `kAudioFormatMPEG4AAC` produces M4A container files
- Current bug: These files are saved with `.aac` extension instead of `.m4a`
- **No additional processing needed** - just fix the file extension

### 2. Platform Limitations
- **iOS**: 
  - Cannot produce raw AAC streams, only M4A containers
  - Opus format (`kAudioFormatOpus`) is defined but not functional - AVAudioRecorder produces 0-byte files
- **Android**: Can produce both raw AAC (.aac) and M4A containers (.m4a)
- **Web**: Limited to WebM/Opus, no AAC support in MediaRecorder

### 3. No Post-Processing Required
- Native APIs directly output the desired format
- Android can switch between AAC_ADTS and MPEG_4 output formats
- iOS always outputs M4A when using AAC codec

## Implementation Plan

### Phase 1: Quick Fix (v2.10.7)
Simple file extension correction with no API changes:

```typescript
// No API changes - just internal fixes
export interface CompressedOutput {
  enabled?: boolean;
  format?: 'aac' | 'opus';  // Unchanged
  bitrate?: number;         // Unchanged
}
```

Platform behavior:
- **iOS**: Files saved as `.m4a` when format is "aac" (fixing current bug)
- **Android**: Continue saving as `.aac` (raw AAC stream)
- **Web**: Continue saving as `.webm` (Opus in WebM)

### Phase 2: Container Control (v2.11.0)
Add explicit container control:

```typescript
export interface CompressedOutput {
  enabled?: boolean;
  format?: 'aac' | 'opus';
  useContainer?: boolean;  // NEW: Request containerized output
  bitrate?: number;
}
```

Platform behavior with `useContainer`:
- **iOS**: `.aac` raw ADTS when the format is AAC and the flag is true (AVAudioRecorder writes ADTS for an `.aac` file); otherwise `.m4a`
- **Android**: 
  - `useContainer: true` → `.m4a` (MP4 container)
  - `useContainer: false` → `.aac` (raw AAC stream)
  - Default: `false` for backward compatibility
- **Web**: Always `.webm` (platform limitation)

## Benefits for Issue #253

The requester wants M4A for better seeking support. The good news:
- **iOS already produces M4A files** - just with wrong extension
- **Android can easily switch** to M4A with `OutputFormat.MPEG_4`
- **No slow post-processing needed** - native APIs handle it directly
- **Seeking works out of the box** with M4A container format

## Testing Requirements

1. **File Format Validation**: 
   ```bash
   # Verify actual format matches extension
   file recording.m4a  # Should show: ISO Media, MP4 Base Media v1
   file recording.aac  # Should show: ADTS, AAC
   ```

2. **Seeking Performance**: Test that M4A files support instant seeking
3. **Backward Compatibility**: Ensure existing code continues to work
4. **Cross-Platform Playback**: Verify files play correctly across platforms

## Summary

The issue reported in #253 stems from a simple file extension mismatch on iOS:
- iOS already produces M4A files (MP4 container) but saves them with `.aac` extension
- Users can immediately work around this by renaming `.aac` to `.m4a` on iOS
- A proper fix will correct the extension and add M4A support for Android
- No slow post-processing is needed - native APIs output the desired format directly

This positions expo-audio-studio to provide the seeking performance requested while maintaining backward compatibility.
