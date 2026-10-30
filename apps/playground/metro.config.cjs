/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
// Learn more https://docs.expo.io/guides/customizing-metro
const escape = require('escape-string-regexp')
const { getDefaultConfig } = require('expo/metro-config')
const { default: exclusionList } = require('metro-config/private/defaults/exclusionList')
const path = require('node:path')
const withStorybook = require('@storybook/react-native/metro/withStorybook')

const pakLib = require('../../packages/audio-studio/package.json')
const pakUI = require('../../packages/audio-ui/package.json')

// Find the project and workspace directories
const projectRoot = __dirname
// This can be replaced with `find-yarn-workspace-root`
const monorepoRoot = path.resolve(projectRoot, '../..')
const uiRoot = path.resolve(monorepoRoot, 'packages/audio-ui')
const libRoot = path.resolve(monorepoRoot, 'packages/audio-studio')
const playgroundApiRoot = path.resolve(monorepoRoot, 'packages/playgroundapi')
const essentiaRoot = path.resolve(monorepoRoot, 'packages/react-native-essentia')
const sherpaRoot = path.resolve(monorepoRoot, 'packages/sherpa-onnx.rn')
const agenticDevRoot = path.resolve(monorepoRoot, 'packages/agentic-dev')
const moonshineRoot = path.resolve(monorepoRoot, 'packages/moonshine.rn')

const modules = [
    'react-native-paper',
    'react-native-safe-area-context',
    'react-native-reanimated',
    '@siteed/audio-ui',
    '@siteed/audio-studio',
    'react-dom',
    'react',
    'react-native',
    '@xenova/transformers',
    ...Object.keys({ ...pakUI.peerDependencies }),
    ...Object.keys({ ...pakLib.peerDependencies }),
]

const extraNodeModules = modules.reduce((acc, name) => {
    acc[name] = path.join(__dirname, 'node_modules', name)
    return acc
}, {})

// Prevent metro from resolving duplicate packages in all workspace packages
const packageRoots = [uiRoot, libRoot, playgroundApiRoot, essentiaRoot, sherpaRoot, agenticDevRoot, moonshineRoot]
const duplicatePackageBlocks = packageRoots.flatMap((pkgRoot) =>
    modules.map(
        (m) =>
            new RegExp(
                `^${escape(path.join(pkgRoot, 'node_modules', m))}\\/.*$`
            )
    )
)

const generatedPathBlocks = [
    path.join(monorepoRoot, '.omx'),
    path.join(projectRoot, '.agent'),
    path.join(projectRoot, 'ios', 'build'),
    path.join(projectRoot, 'ios', 'build-device'),
    path.join(projectRoot, 'ios', 'build-main-compare'),
    path.join(projectRoot, 'ios', 'build-raw-branch'),
    path.join(projectRoot, 'ios', 'build-raw-main'),
].map((blockedPath) => new RegExp(`^${escape(blockedPath)}\\/.*$`))

const blockList = exclusionList([
    ...duplicatePackageBlocks,
    ...generatedPathBlocks,
])

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot]

config.server.port = 7365

// Wrap rewriteRequestUrl to fix web HMR URLs that crash Metro 0.83.
// The HMR client sends location.href as the entry point when document.currentScript
// is unavailable (e.g. after SPA navigation). This produces URLs like
// "http://localhost:7365/?platform=web" or "http://localhost:7365/record?platform=web"
// which are not valid bundle entry points. The root-only path case also crashes
// jsc-safe-url. Fix: detect non-bundle URLs and rewrite to the actual web entry point.
const originalRewriteRequestUrl = config.server.rewriteRequestUrl
config.server.rewriteRequestUrl = (url) => {
    const rewritten = originalRewriteRequestUrl(url)
    try {
        const parsed = new URL(rewritten, 'https://placeholder.dev')
        // Check if the pathname looks like a real bundle/source file
        // Valid paths have extensions like .bundle, .js, .ts, .tsx, .map, etc.
        const hasSourceExt = /\.\w+$/.test(parsed.pathname)
        const isAssetRequest = parsed.pathname.startsWith('/assets')
        if (!hasSourceExt && !isAssetRequest && parsed.protocol !== 'resolve:') {
            // Only rewrite if the URL has a "platform" query param — this indicates
            // a bundle/HMR request (Expo's HMR client always adds ?platform=web).
            // Without "platform", it's a direct browser navigation (e.g. user opens
            // /record in the address bar). Let those pass through so Metro calls
            // next() and Expo's HistoryFallbackMiddleware serves the HTML shell.
            if (!parsed.searchParams.has('platform')) {
                return rewritten
            }
            // HMR/bundle request with a SPA route pathname (no file extension).
            // Rewrite to the actual web entry point, relative to monorepo root
            // (matching what Expo's rewriteRequestUrl produces for .virtual-metro-entry URLs).
            const entryPath = '/apps/playground/src/index.web.bundle'
            if (parsed.host) {
                return parsed.protocol + '//' + parsed.host + entryPath + parsed.search
            }
            return entryPath + parsed.search
        }
    } catch {
        // If URL parsing fails, return as-is
    }
    return rewritten
}

config.transformer = {
    ...config.transformer,
    getTransformOptions: async () => ({
        transform: {
            experimentalImportSupport: false,
            inlineRequires: true,
        },
    }),
    assetPlugins: config.transformer.assetPlugins || [],
}

config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
]

config.resolver = {
    ...config.resolver,
    extraNodeModules,
    blockList,
    sourceExts: [...config.resolver.sourceExts, 'cjs', 'mjs'],
    assetExts: [
        ...config.resolver.assetExts,
        'wasm',
        'ttf',
        'bin',
        'mil',
        'wav',
        'opus',
        'mp3',
        'm4a',
        'ogg',
        'flac',
        'aac',
        'pte',
        'onnx',
        'webm',
        'm4b',
    ],
    resolveRequest: (context, moduleName, platform) => {
        // Shim Node.js built-in modules that Storybook's CJS bundles try to require.
        // Metro resolves dynamic import() targets statically, so even though Storybook
        // is only loaded when EXPO_PUBLIC_STORYBOOK=true, Metro still resolves the full
        // dependency tree including these Node builtins.
        const nodeBuiltins = ['tty', 'os', 'fs', 'path', 'util', 'stream', 'events',
            'buffer', 'crypto', 'http', 'https', 'net', 'child_process', 'module',
            'assert', 'url', 'querystring', 'string_decoder', 'zlib', 'vm',
            'perf_hooks', 'worker_threads', 'inspector']
        if (nodeBuiltins.includes(moduleName)) {
            return { type: 'empty' }
        }
        if (moduleName === '@siteed/audio-ui') {
            return {
                filePath: monorepoRoot + '/packages/audio-ui/src/index.ts',
                type: 'sourceFile',
            }
        } else if (moduleName === '@siteed/audio-studio') {
            return {
                filePath:
                    monorepoRoot + '/packages/audio-studio/src/index.ts',
                type: 'sourceFile',
            }
        } else if (moduleName === '@siteed/sherpa-onnx.rn') {
            return {
                filePath:
                    monorepoRoot + '/packages/sherpa-onnx.rn/src/index.ts',
                type: 'sourceFile',
            }
        } else if (
            moduleName === 'react' ||
            moduleName === 'react-dom' ||
            moduleName.startsWith('react/') ||
            moduleName.startsWith('react-dom/')
        ) {
            // Resolve from the playground root so the default resolver walks
            // its node_modules first. This handles subpaths (e.g. `react/jsx-runtime`,
            // `react-dom/client`) using the package's own exports/main entries
            // instead of guessing the file layout.
            return context.resolveRequest(
                { ...context, originModulePath: path.join(projectRoot, 'index.js') },
                moduleName,
                platform
            )
        }
        // Ensure you call the default resolver.
        return context.resolveRequest(context, moduleName, platform)
    },
}

// Only apply Storybook wrapper when explicitly enabled
if (process.env.EXPO_PUBLIC_STORYBOOK === 'true') {
  module.exports = withStorybook(config, {
    enabled: true,
    configPath: path.resolve(__dirname, './.rnstorybook'),
  })
} else {
  module.exports = config
}
