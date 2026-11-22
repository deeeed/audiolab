const path = require('node:path');
const resolveMetroPort = (env, fallback) => Number.parseInt(env.METRO_PORT || env.WATCHER_PORT || String(fallback), 10);
const appRootFor = (root, app = process.env.AUDIOLAB_APP || 'playground') => path.join(root, 'apps', app);
const webViewport = { width: 1280, height: 720 };
module.exports = { resolveMetroPort, appRootFor, webViewport };
if (require.main === module) {
  const value = process.argv[2] === 'app-root'
    ? appRootFor(process.argv[3])
    : resolveMetroPort(process.env, process.argv[2]);
  process.stdout.write(String(value) + '\n');
}
