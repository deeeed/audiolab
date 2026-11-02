# Contributing to audiolab

Thanks for your interest in contributing! This monorepo contains several audio processing packages for React Native and Expo.

## Setup

```bash
# 1. Install Git LFS (needed for ONNX models)
./scripts/setup-lfs.sh

# 2. Install dependencies
yarn install

# 3. Build packages
cd apps/playground && yarn build:deps
```

## Development

The playground app is the best way to test changes across all packages:

```bash
cd apps/playground
yarn start
```

For individual package builds:

```bash
yarn workspace @siteed/audio-studio build
yarn workspace @siteed/audio-ui build
```

## Testing

```bash
./scripts/run_tests.sh
```

## Project Structure

```
packages/
  audio-studio/          # Core audio recording, analysis, processing
  audio-ui/              # Skia-based visualization components
  react-native-essentia/ # Deprecated: no longer maintained, kept for reference
  sherpa-onnx.rn/        # Speech-to-text / text-to-speech
apps/
  playground/            # Full demo app (App Store / Play Store)
  minimal/               # Minimal integration example
  essentia-demo/         # Audio analysis demo
  sherpa-voice/          # Speech recognition demo
```

## Guidelines

- Keep diffs minimal — smallest change that solves the problem
- Fix root causes, not symptoms
- Test on both iOS and Android for UI/navigation changes
- Use `yarn` (not `npm` or `npx`) for all commands

## Docs

- [Package README](packages/audio-studio/README.md)
- [Package contribution guide](packages/audio-studio/CONTRIBUTE.md)
- [Testing strategy](packages/expo-audio-studio/docs/TESTING_STRATEGY.md)

## License

MIT — contributions are welcome under the same license.
