# Publishing Guide

This document outlines my release and deployment process for AudioPlayground. It covers versioning, building, and submitting to app stores.

## Current App Availability

AudioPlayground is publicly available on the following platforms:

| Platform | URL |
|----------|-----|
| App Store (iOS) | [https://apps.apple.com/app/audio-playground/id6739774966](https://apps.apple.com/app/audio-playground/id6739774966) |
| Google Play (Android) | [https://play.google.com/store/apps/details?id=net.siteed.audioplayground](https://play.google.com/store/apps/details?id=net.siteed.audioplayground) |
| Web | [https://deeeed.github.io/audiolab/playground/](https://deeeed.github.io/audiolab/playground/) |

When publishing updates, these are the destinations where the app will be updated.

## System Requirements

Before starting development or deployment, make sure your system has all the necessary dependencies installed:

```bash
# Check your system for all required dependencies
./scripts/check-system-dependencies.sh
```

This script checks for:
- Core development tools (Node.js, Yarn, Git, Watchman)
- Expo tools (Expo CLI, EAS CLI)
- Screenshot and image processing tools (ImageMagick)
- iOS development tools (Xcode, CocoaPods, Fastlane) when on macOS
- Android development tools (Android SDK, JDK)
- Web deployment tools

If any required dependencies are missing, the script will provide installation instructions.

## Versioning and Release Process

I follow semantic versioning (MAJOR.MINOR.PATCH) for releases:
- **PATCH**: Bug fixes and minor improvements (e.g., 1.0.1)
- **MINOR**: New features with backward compatibility (e.g., 1.1.0)
- **MAJOR**: Breaking changes or significant overhauls (e.g., 2.0.0)

## Update Types: Native vs. JavaScript-Only

### Identifying Native Changes

Native changes **require full app store submissions** and include:

- Expo SDK version upgrades
- React Native version upgrades
- Adding/updating native modules
- Changes to app permissions
- Changes to native configuration files

### CHANGELOG Documentation

When making changes, categorize them in CHANGELOG.md:

```markdown
## [Unreleased]

### Native Changes (Requires App Store Submission)
- Upgraded to Expo SDK 53
- Added new camera permissions

### JavaScript Changes (OTA Compatible)
- Fixed audio playback bug
- Added new UI features
```

## Interactive Deployment Script

For most deployment scenarios, I recommend using the interactive deployment script:

```bash
yarn publish
```

This script will:
1. Ask if you want to update the version number
2. Provide calculated version options (patch/minor/major)
3. Guide you through platform selection (Web/Android/iOS)
4. Handle the entire build and publishing workflow

## Manual Deployment Options

### Web Deployment

```bash
# Development environment
NODE_ENV=development APP_VARIANT=development EXPO_WEB=true expo export -p web && yarn serve dist/

# Production environment
NODE_ENV=production APP_VARIANT=production EXPO_WEB=true expo export -p web && cp playstore_policy.html dist/ && gh-pages -t -d dist --dest playground
```

### Android Deployment

#### Build Types

| Build Type | Use Case | Command |
|------------|----------|---------|
| Development | Local testing | `yarn build:android:development` |
| Preview | Testing distribution | `yarn build:android:preview` |
| Preview APK | Shareable APK | `yarn build:android:preview_apk` |
| Production | Store submission | `yarn build:android:production --local` |

#### Production builds run locally

Build the Android production AAB locally, not on EAS cloud. The native build (Skia, Reanimated, Worklets for two ABIs) takes about 45 minutes and peaks above 14 GiB. A cloud build runs out of memory on a 16 GiB worker, or is cancelled at the EAS plan's 45-minute limit.

Use a build machine with at least 32 GB of RAM and keep it from saturating the host:

```bash
yarn setup:production
nice -n 15 env GRADLE_OPTS="-Dorg.gradle.workers.max=4" yarn build:android:production --local
```

Check the AAB before you submit it: record its SHA-256, and confirm versionName and versionCode with `bundletool dump manifest --bundle <file>.aab`.

#### Submitting to Play Store

```bash
# After the local production build. `play-production` targets the production track;
# `production` uploads an internal-track draft.
eas submit --platform android --profile play-production --path "$(find . -maxdepth 1 -name "*.aab" -type f -print0 | xargs -0 ls -t | head -n1)"
```

### iOS Deployment

#### Build Types

| Build Type | Use Case | Command |
|------------|----------|---------|
| Development | Testing on devices | `yarn build:ios:development` |
| Preview | TestFlight distribution | `yarn build:ios:preview` |
| Production | App Store submission | `yarn build:ios:production --local` |

#### Registering Test Devices

For development builds on iOS, you'll need to register test devices:
```bash
eas device:create
```

#### Submitting to App Store

```bash
# After local production build
(
  source .env.production && eas submit --platform ios \
    --path "$(find . -maxdepth 1 -name "*.ipa" -type f -print0 | xargs -0 ls -t | head -n1)"
)

# Build and submit automatically
yarn build:ios:production --auto-submit

# Submit latest build to App Store
yarn dlx eas-cli submit --platform ios --latest
```

## Over-the-Air Updates with Expo

AudioPlayground uses Expo Updates for Over-The-Air updates. This allows you to publish updates directly to users without going through the app stores.

### Understanding `runtimeVersion`

- The `runtimeVersion` in app.config.ts determines compatibility between app builds and OTA updates
- Only updates with the same `runtimeVersion` will be applied to existing installations
- We sync `runtimeVersion` with our package version (in package.json) for consistency
- Our automated scripts manage this synchronization for you

### OTA Update Commands

We provide several convenience commands for OTA updates:

```bash
# 1. Increment version and update CHANGELOG
yarn update:patch   # For bug fixes
yarn update:minor   # For new features
yarn update:major   # For breaking changes

# 2. Push the update
yarn ota-update:production   # Main production branch
yarn ota-update:preview      # Preview/beta testing branch
yarn ota-update:development  # Development branch
```

Each of these commands will:
1. Update the runtimeVersion to match package.json version
2. Update the CHANGELOG.md (moving Unreleased changes to the new version)
3. Push the update to EAS using the appropriate channel

### When to Use OTA vs. Store Updates

| Change Type | Update Method | Version Change |
|-------------|---------------|----------------|
| JS-only bug fixes | OTA update | PATCH (0.12.x) |
| JS-only features | OTA update | MINOR (0.x.0) |
| Native code changes | Full rebuild | MAJOR (x.0.0) |
| Expo SDK upgrades | Full rebuild | MAJOR (x.0.0) |
| Native module updates | Full rebuild | MAJOR or MINOR |

### Workflow Example

1. Make JS-only changes to fix a bug
2. Document the changes in CHANGELOG.md under [Unreleased]
3. Run OTA update:
   ```bash
   # Update version and push update
   yarn update:patch
   yarn ota-update:production
   ```

### Background Updates

With Expo SDK 53, we've implemented background updates. The app will:
- Check for updates on launch
- Check for updates periodically while in use
- Check for updates when backgrounded (using expo-background-task)

This ensures users always have the latest version without needing to manually check.

## CI/CD Pipeline

For automated builds in CI environments:

```bash
# Non-interactive version increment
yarn version --patch  # or --minor or --major

# Automated deployment
APP_VARIANT=production NODE_ENV=production eas build --platform all --profile production --non-interactive --auto-submit
```

## App Store Screenshots

Screenshots are required for App Store and Play Store submissions. Use our automated screenshot generation workflow for consistent, high-quality images.

### One-Stop App Store Preparation

For a complete App Store preparation workflow:

```bash
yarn prepare:appstore
```

This single command:
1. Sets up the production environment with the correct app name (if not already set up)
2. Creates required device simulators
3. Generates all screenshots for iPhone and iPad
4. Processes images for App Store submission

If you need to force a clean rebuild:
```bash
yarn prepare:appstore:force
```

### Screenshot Generation

The process involves these simple steps:

1. **Set up simulator devices** (first time only):
   ```bash
   ./scripts/setup-simulators.sh
   ```
   Creates required device simulators (iPhone 16 Pro Max, iPad Pro 13-inch M4).

2. **Generate screenshots**:
   Choose one of the following shortcut commands:
   ```bash
   # Generate screenshots for development build
   yarn screenshot:development
   
   # Generate screenshots for preview build
   yarn screenshot:preview
   
   # Generate screenshots for production build (App Store)
   yarn screenshot:production
   ```

   Each command automatically:
   - Checks if the correct environment is already set up (skips rebuild if possible)
   - Creates the proper native builds with the right app name (if needed)
   - Generates screenshots for all required devices
   - Processes images for store submission

   For a forced clean rebuild, use:
   ```bash
   # Force rebuild and generate screenshots
   yarn setup:production:force && yarn screenshot:production
   ```

### Behind the Scenes

These commands combine multiple steps for convenience:
```bash
# What happens with yarn screenshot:production
yarn setup:production                       # Prepares production environment
./scripts/generate-screenshots.sh all env=production  # Generates screenshots
```

You can still run individual steps if needed:
```bash
# Manual approach
yarn setup:production                      # Set up environment first
./scripts/generate-screenshots.sh ios      # iOS screenshots only
./scripts/generate-screenshots.sh android  # Android screenshots only
```

### Requirements

- iOS: macOS with Xcode, configured simulators
- Android: Configured emulators
- ImageMagick for image processing (`brew install imagemagick`)
