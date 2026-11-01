// Keeo this on top
import 'ts-node/register'

// Deps
import { ConfigContext, ExpoConfig } from '@expo/config'
import { config as dotenvConfig } from 'dotenv-flow'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validatePlaygroundEnvironment } from './config/validate-env'
import { version as packageVersion } from './package.json'

dotenvConfig({
    silent: true,
    node_env: process.env.APP_VARIANT || "production", // This will use APP_VARIANT for env file selection
}) // Load variables from .env* files

const validatedEnv = validatePlaygroundEnvironment(process.env)

try {
    const ortPackageJsonPath = join(__dirname, 'node_modules/onnxruntime-web/package.json')
    const canvasKitPackageJsonPath = join(__dirname, 'node_modules/canvaskit-wasm/package.json')

    const ortPackageJson = JSON.parse(readFileSync(ortPackageJsonPath, 'utf-8'))
    const canvasKitPackageJson = JSON.parse(readFileSync(canvasKitPackageJsonPath, 'utf-8'))

    validatedEnv.ORT_VERSION = ortPackageJson.version
    validatedEnv.CANVASKIT_VERSION = canvasKitPackageJson.version

} catch (readError) {
    console.error('Error reading package.json for version injection:', readError)
    validatedEnv.ORT_VERSION = undefined
    validatedEnv.CANVASKIT_VERSION = undefined
}

// Add a helper function for logging
function logConfig(config: Record<string, unknown>, prefix = '') {
    console.log('\n🔧 Environment Configuration:')
    console.log('-----------------------------')
    Object.entries(config).forEach(([key, value]) => {
        if (value !== undefined) {
            console.log(`${prefix}${key}: ${value}`)
        }
    })
    console.log('-----------------------------\n')
}

const getAppIdentifier = (base: string, variant: string): string => {
    if (variant === 'production') return base
    return `${base}.${variant}`
}

const getAppScheme = (variant: string): string => {
    if (variant === 'production') return 'audioplayground'
    return `audioplayground-${variant}`
}

const APP_IDENTIFIER = getAppIdentifier('net.siteed.audioplayground', validatedEnv.APP_VARIANT)
const APP_SCHEME = getAppScheme(validatedEnv.APP_VARIANT)

// Log the important configuration values
logConfig({
    'App Variant': validatedEnv.APP_VARIANT,
    'App Identifier': APP_IDENTIFIER,
    'App Scheme': APP_SCHEME,
    'App Version': packageVersion,
    'EAS Project ID': validatedEnv.EAS_PROJECT_ID,
    'Apple Team ID': validatedEnv.APPLE_TEAM_ID || 'Not set',
    'Environment': process.env.NODE_ENV || 'development',
    'ORT Version (Injected)': validatedEnv.ORT_VERSION || 'Not Found',
    'CanvasKit Version (Injected)': validatedEnv.CANVASKIT_VERSION || 'Not Found',
})

export default ({ config }: ConfigContext): ExpoConfig => {
    return {
        ...config,
        name:
            validatedEnv.APP_VARIANT === 'production'
                ? 'AudioPlayground'
                : `AudioDevPlayground`,
        slug: 'audioplayground',
        version: packageVersion,
        orientation: 'portrait',
        icon: './assets/icon.png',
        userInterfaceStyle: 'light',
        scheme: APP_SCHEME,
        assetBundlePatterns: ['**/*', 'assets/audio_samples/*', 'public/audioStorage.worker.js', 'assets/silero_vad.onnx', 'assets/silero_vad_v5.onnx'],
        ios: {
            supportsTablet: true,
            bundleIdentifier: APP_IDENTIFIER,
            appleTeamId: validatedEnv.APPLE_TEAM_ID,
            infoPlist: {
                "ITSAppUsesNonExemptEncryption": false,
            },
        },
        android: {
            adaptiveIcon: {
                foregroundImage: './assets/adaptive-icon.png',
                backgroundColor:
                    validatedEnv.APP_VARIANT === 'production' ? '#98c1d9' : '#ffffff',
            },
            package: APP_IDENTIFIER,
        },
        developmentClient: {
            silentLaunch: true,
        },
        web: {
            favicon: './assets/favicon.png',
            bundler: 'metro',
        },
        experiments: {
            baseUrl:
                validatedEnv.APP_VARIANT === 'production'
                    ? '/audiolab/playground/'
                    : '',
        },
        updates: {
            url: 'https://u.expo.dev/' + validatedEnv.EAS_PROJECT_ID,
            enabled: true,
            checkAutomatically: "ON_LOAD",
            useEmbeddedUpdate: true
        },
        runtimeVersion: '2.4.0',
        owner: 'deeeed',
        plugins: [
            [
                'expo-font',
                {
                    fonts: [
                        './assets/Roboto/Roboto-Regular.ttf',
                    ],
                    // @expo/vector-icons fonts: Android only — on iOS these are already
                    // bundled by react-native-vector-icons CocoaPods resources.
                    // Adding them here for iOS causes "Multiple commands produce" archive errors.
                    android: {
                        fonts: [
                            './node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf',
                            './node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf',
                            './node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf',
                            './node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf',
                            './node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Entypo.ttf',
                        ],
                    },
                },
            ],
            [
                'expo-splash-screen',
                {
                    image: './assets/splash.png',
                    resizeMode: 'contain',
                    backgroundColor:
                        validatedEnv.APP_VARIANT === 'production' ? '#98c1d9' : '#ffffff',
                },
            ],
            [
                // We need to force use the cjs version on local monorepo plugin development since expo 53
                '../../packages/audio-studio/app.plugin.cjs',
                // '@siteed/audio-studio',
                {
                    enablePhoneStateHandling: true,
                    enableNotifications: true,
                    enableBackgroundAudio: true,
                    enableDeviceDetection: true,
                    iosBackgroundModes: {
                        useAudio: true,
                        useProcessing: true,
                        useVoIP: false,
                        useLocation: false,
                        useExternalAccessory: false
                    },
                    iosConfig: {
                        allowBackgroundAudioControls: false,
                        backgroundProcessingTitle: "Audio Processing",
                        microphoneUsageDescription: "AudioPlayground needs microphone access to record your voice and audio for creating audio samples.",
                        notificationUsageDescription: "Allow notifications to control audio recording from the notification center"
                    }
                },
            ],
            [
                'expo-build-properties',
                {
                    ios: {
                        deploymentTarget: "16.4",
                        infoPlist: {
                            ITSAppUsesNonExemptEncryption: false,
                            LSApplicationCategoryType: "public.app-category.utilities"
                        }
                    },
                    android: {
                        // Moonshine Maven AAR 0.1.5 declares minSdk 26. Source-built AARs pinned
                        // to v0.0.59 still declare 35 and will raise the merged floor.
                        minSdkVersion: 26,
                        // Keep .so files uncompressed so AGP 8.5+ can zipalign them at 16KB boundaries
                        // Required for Google Play's 16KB page size alignment check (Android 15+)
                        useLegacyPackaging: false,
                        enableProguardInReleaseBuilds: true,
                        extraProguardRules: "-keep class com.facebook.hermes.unicode.** { *; }\n-dontwarn expo.modules.kotlin.services.FilePermissionService$Permission",
                    },
                },
            ],
            ['./plugins/withCustomGradleConfig.cjs', {}],
            ['./plugins/withLibcppFix.cjs', {}],
            [
                './plugins/withVariantExpoScheme.cjs',
                {
                    variant: validatedEnv.APP_VARIANT,
                    appScheme: APP_SCHEME,
                },
            ],
            [
                'react-native-edge-to-edge',
                {
                    enableEdgeToEdge: true,
                },
            ],
            [
                '@config-plugins/detox',
                {
                    skipProguard: false,
                    subdomains: validatedEnv.APP_VARIANT === 'development'
                        ? "*"
                        : [
                            '10.0.2.2',
                            'localhost',
                            '192.168.50.10',
                            '192.168.50.11',
                            '192.168.11.1',
                            '192.168.1.39',
                        ],
                },
            ],
            ["./plugins/withMetroPort.cjs", { port: 7365 }],
            ["../../plugins/withMetroPortIOS.cjs", { port: 7365 }],
            "expo-background-task",
            'expo-localization',
            // [
            //     'expo-asset',
            //     {
            //         assets: ['./public/audio_samples/recorder_hello_world.wav'],
            //     },
            // ],
            'expo-router',
            'expo-audio',
            '@react-native-community/datetimepicker',
            'expo-sharing',
            'expo-asset',
            'expo-status-bar',
        ],
        extra: {
            eas: {
                projectId: validatedEnv.EAS_PROJECT_ID,
                channelName: validatedEnv.APP_VARIANT,
            },
            APP_VARIANT: validatedEnv.APP_VARIANT,
            ORT_VERSION: validatedEnv.ORT_VERSION,
            CANVASKIT_VERSION: validatedEnv.CANVASKIT_VERSION,
        },
    }
}
