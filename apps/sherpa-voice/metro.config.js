// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace directories
const projectRoot = __dirname;
// This can be replaced with `find-yarn-workspace-root`
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];
// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// 3. Force Metro to resolve (sub)dependencies only from the `nodeModulesPaths`
config.resolver.disableHierarchicalLookup = true;

const appNodeModules = path.resolve(projectRoot, 'node_modules') + path.sep;

// 4. Resolve workspace packages from source so relative imports (e.g. prebuilt/wasm/) work
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@siteed/audio-studio') {
    return {
      filePath: path.resolve(workspaceRoot, 'packages/audio-studio/src/index.ts'),
      type: 'sourceFile',
    };
  }
  // Installed packages still need their own nested dependencies: expo's HMR client
  // breaks on the pretty-format 30 that Jest 30 hoists into this app.
  if (context.originModulePath.startsWith(appNodeModules)) {
    return context.resolveRequest(
      { ...context, disableHierarchicalLookup: false },
      moduleName,
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

// add assetExts
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'm4a',
  'wav',
  'wasm',
  'data',
  'mp3',
  'bin',
  'onnx',
  'txt',
  'bz2',
  'fst',
  'far',
];

// Add assets to copy without extensions (like data directories)
config.resolver.extraNodeModules = {
  assets: path.resolve(__dirname, 'assets'),
};

module.exports = config; 