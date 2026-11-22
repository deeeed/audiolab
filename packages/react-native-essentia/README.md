> Deprecated: no longer maintained; kept for reference. Last published version: 0.3.2-beta.1 (beta), 0.3.1 (latest).

#  @siteed/react-native-essentia

A React Native module providing access to the [Essentia audio analysis library](https://essentia.upf.edu/) for Android and iOS. Extract advanced audio features directly within your React Native apps.

> **⚠️ USE AT YOUR OWN RISK**
>
> This package can be used in production, but entirely at your own risk. Development happens sporadically, and the API may change without notice.
>
> **Current Implementation Status:**
> - The wrapper provides access to most Essentia algorithms
> - Some algorithms (like MFCC, Key, Spectrum, Tonnetz, MelBands, HPCP, SpectralContrast) have optimized implementations
> - Other algorithms are accessible through a dynamic algorithm execution system
>
> **IMPORTANT NOTES:**
> - I strongly encourage users to build on top of existing methods rather than using the package as-is
> - Fork the repository and adapt the code to your specific needs for the best results
> - I am moving away from using Essentia due to its invasive license terms
> - This code is kept available for reference purposes for those who understand and accept Essentia's licensing requirements

## Features

- **Audio Feature Extraction**: Access 200+ Essentia audio analysis algorithms
- **Ready-to-use Methods**: Simplified APIs for common features (MFCC, key detection, pitch, tempo, etc.)
- **Performance Optimized**: Native implementation using C++ with multi-threading support
- **Cross-Platform**: Full support for both Android and iOS platforms

## Platform Support

**This module supports both Android and iOS platforms.** Web support has been discontinued.

## Installation

Install the module using npm or yarn:

```bash
npm install @siteed/react-native-essentia
```

or

```bash
yarn add @siteed/react-native-essentia
```

Since this module uses native code, rebuild your project after installation:

```bash
npx react-native run-android
```

## Prerequisites

- React Native 0.60+ (uses autolinking)
- Android SDK with NDK support (for native compilation)

## Quick Start

```typescript
import Essentia from '@siteed/react-native-essentia';

// Load audio data (PCM samples)
const audioData = new Float32Array([/* your audio samples */]);
const sampleRate = 44100;
await Essentia.setAudioData(audioData, sampleRate);

// Extract basic features
const mfccResult = await Essentia.extractMFCC();
const keyResult = await Essentia.extractKey();

console.log('MFCC:', mfccResult.mfcc);
console.log('Key:', keyResult.key, keyResult.scale);
```

## Core APIs

### 1. Individual Feature Extraction

Extract specific audio features with specialized, type-safe methods:

```typescript
// Musical properties
const key = await Essentia.extractKey();
const tempo = await Essentia.extractTempo();
const chords = await Essentia.extractChords();

// Spectral analysis
const mfcc = await Essentia.extractMFCC();
const melBands = await Essentia.extractMelBands();
const spectralFeatures = await Essentia.extractSpectralFeatures();

// Audio characteristics
const loudness = await Essentia.extractLoudness();
const energy = await Essentia.extractEnergy();
const danceability = await Essentia.extractDanceability();
```

### 2. Batch Processing API

Extract multiple features efficiently in a single operation:

```typescript
const batchResult = await Essentia.extractFeatures([
  { name: 'MFCC', params: { numberCoefficients: 13 } },
  { name: 'Key' },
  { name: 'BeatTrackerMultiFeature' },
  { name: 'Loudness' }
]);

// Access all results from a single call
const {
  mfcc,
  key,
  ticks,       // beats from BeatTrackerMultiFeature
  loudness
} = batchResult.data;
```

Key benefits of batch processing:
- **Performance**: Minimizes redundant computations and native bridge calls
- **Optimization**: Reuses intermediate results like spectra across algorithms
- **Simplicity**: Extracts multiple features with a single API call

### 3. Pipeline API

The most powerful feature - create custom audio processing workflows:

```typescript
const pipelineResult = await Essentia.executePipeline({
  // 1. PREPROCESSING STEPS
  preprocess: [
    { name: "FrameCutter", params: { frameSize: 2048, hopSize: 1024 } },
    { name: "Windowing", params: { type: "hann" } },
    { name: "Spectrum", params: { size: 2048 } }
  ],

  // 2. FEATURE EXTRACTION
  features: [
    {
      name: "MFCC",
      input: "Spectrum",  // Uses output from Spectrum preprocessing step
      params: { numberCoefficients: 13 },
      postProcess: { mean: true, variance: true }  // Compute statistics across frames
    },
    {
      name: "MelBands",
      input: "Spectrum",
      params: { numberBands: 40 },
      postProcess: { mean: true }
    }
  ],

  // 3. POST-PROCESSING
  postProcess: {
    concatenate: true  // Combine all features into a single vector
  }
});

// Access structured results
console.log('MFCC means:', pipelineResult.data.MFCC.mean);
console.log('MFCC variance:', pipelineResult.data.MFCC.variance);
console.log('MelBands means:', pipelineResult.data.MelBands.mean);
console.log('Concatenated features:', pipelineResult.data.concatenatedFeatures);
```

Benefits of the Pipeline API:
- **Complete Control**: Define custom preprocessing, feature extraction, and post-processing
- **Data Flow**: Connect algorithm outputs to inputs of subsequent algorithms
- **Statistical Analysis**: Automatically compute statistics (mean, variance) across audio frames
- **Feature Engineering**: Concatenate features for machine learning applications
- **Optimization**: Efficiently handles frame-based processing with minimal memory overhead

## Pipeline API Explained

The Pipeline API provides a three-stage architecture for audio processing workflows:

1. **Preprocessing**
   - Handles audio segmentation, windowing, and transformation
   - Common steps include frame cutting, windowing, and spectrum computation
   - Output from these steps feeds into feature extraction

2. **Feature Extraction**
   - Core audio analysis with configurable algorithms
   - Each algorithm takes input from a preprocessing step
   - Parameters can be customized for each algorithm
   - Results can be automatically summarized (mean, variance)

3. **Post-processing**
   - Works on extracted features (currently supports concatenation)
   - Prepares features for machine learning or other applications

Example use cases:
- **Music Classification**: Extract MFCCs, spectral features, and rhythm features for genre classification
- **Audio Fingerprinting**: Create compact audio signatures
- **Mood Detection**: Analyze key, tempo, and spectral features to determine emotional characteristics
- **Voice Analysis**: Extract pitch, formants, and energy for speech processing

## Direct Algorithm Access

For maximum flexibility, access any Essentia algorithm directly:

```typescript
// Execute any algorithm with custom parameters
const result = await Essentia.executeAlgorithm('SpectralCentroidTime', {
  sampleRate: 44100
});

// Get algorithm information
const info = await Essentia.getAlgorithmInfo('MFCC');
console.log('MFCC parameters:', info.parameters);

// List all available algorithms
const algorithms = await Essentia.getAllAlgorithms();
```

## Performance Optimization

```typescript
// Enable caching
await Essentia.setCacheEnabled(true);

// Set thread count for multi-threaded processing
await Essentia.setThreadCount(4);
```

## Error Handling

All methods return an EssentiaResult with `success` and potential `error` fields:

```typescript
try {
  const result = await Essentia.extractMFCC();

  if (result.success) {
    console.log('MFCC:', result.mfcc);
  } else {
    console.error('Error:', result.error.message);
  }
} catch (error) {
  console.error('Exception:', error);
}
```

## Available Feature Types

The library provides extraction methods for several categories of audio features:

- **Spectral Features**: MFCC, MelBands, BarkBands, Spectrum, SpectralContrast
- **Tonal Features**: Key, Chords, Tonnetz, HPCP, Inharmonicity
- **Rhythm Features**: Tempo, Beats, Onsets, Danceability
- **Dynamics**: Loudness, Energy, RMS, DynamicComplexity
- **Signal Properties**: Pitch, ZeroCrossingRate, SilenceRate

## Available Convenience Methods

The module provides specialized methods for common audio features:

- **Spectral**: `extractMFCC()`, `extractMelBands()`, `extractSpectralFeatures()`, `extractBarkBands()`, `extractERBBands()`
- **Tonal**: `extractKey()`, `extractChords()`, `extractHarmonics()`, `extractTonnetz()`, `extractTuningFrequency()`
- **Rhythm**: `extractTempo()`, `extractBeats()`, `extractOnsets()`, `extractDanceability()`, `extractRhythmFeatures()`
- **Dynamics**: `extractLoudness()`, `extractEnergy()`, `extractDynamics()`, `extractAttackTime()`
- **Signal**: `extractPitch()`, `extractZeroCrossingRate()`, `detectSilence()`, `extractInharmonicity()`

## Types

Key TypeScript interfaces:

- **AlgorithmParams**: `{ [key: string]: string | number | boolean | number[] | string[] | undefined }`
  Configuration object for algorithm parameters.

- **FeatureConfig**: `{ name: string; params?: AlgorithmParams }`
  Defines a feature to extract.

- **PipelineConfig**:
  ```typescript
  {
    preprocess: Array<{ name: string; params?: AlgorithmParams }>;
    features: Array<{
      name: string;
      input: string; // Source of input data (e.g., "Spectrum")
      params?: AlgorithmParams;
      postProcess?: { mean?: boolean; variance?: boolean };
    }>;
    postProcess?: { concatenate?: boolean };
  }
  ```
  Configures an audio processing pipeline with preprocessing, feature extraction, and post-processing steps.

- **PipelineResult**: `{ success: boolean; data?: Record<string, { mean?: number[]; variance?: number[] }>; error?: { code: string; message: string } }`
  Result type for pipeline operations, containing the extracted features.

- **EssentiaResult<T>**: `{ success: boolean; data?: T; error?: { code: string; message: string } }`
  Generic result type for most operations.

## Performance Considerations

Audio analysis can be resource-intensive:

- Use batch operations (extractFeatures, executeBatch) to minimize redundant computations.
- Take advantage of the automatic lazy initialization feature, which ensures the library is initialized only when needed.
- Adjust thread count based on device capabilities.
- For large audio files, consider processing in chunks or running in the background.

## Static Libraries

This package uses Essentia C++ libraries which are large binary files. To keep the package size manageable:

- By default, the package downloads pre-built binaries from [deeeed/rn-essentia-static](https://github.com/deeeed/rn-essentia-static) during installation
- The libraries are automatically configured for both iOS and Android platforms
- If you prefer to build from source, set `USE_PREBUILT = false` in `install.js`

The static libraries are located at:
- iOS: `ios/Frameworks/device/Essentia_iOS.a` and `ios/Frameworks/simulator/Essentia_Sim.a`
- Android: `android/src/main/jniLibs/<architecture>/libessentia.a`

## License and Acknowledgements

This wrapper is MIT licensed, but the compiled binary is subject to Essentia's licensing terms.

Built with the [Essentia audio analysis library](https://essentia.upf.edu/).

---
<sub>Created by [Arthur Breton](https://siteed.net) • See more projects at [siteed.net](https://siteed.net)</sub>

