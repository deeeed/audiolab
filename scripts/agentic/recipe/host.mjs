import { selectIOSDevice } from '../lib/ios-devices.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import runtimeConfig from '../lib/runtime-config.cjs';
const { appRootFor } = runtimeConfig;
export { appRootFor };

import { recordingTarget } from './recording-target.mjs';
import { createRecipeRunner } from '@farmslot/recipe-runner';
import { createAdapters, createBridge, readRecentMetroLog, readRecentLog, getQueryCatalogue, validateQueryCatalogue } from './adapters.mjs';

export const libraryRoot = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(libraryRoot, '../../..');
export const manifest = JSON.parse(await fs.readFile(path.join(libraryRoot, 'action-manifest.json'), 'utf8'));
export const actionNames = Object.keys(manifest.actions);
export const library = `audiolab=${libraryRoot}`;
const provenance = { kind: 'operator', trust: 'trusted', name: 'audiolab' };
const apps = { playground: 'playground', sherpa: 'sherpa-voice' };
export function recipeApp(name) {
  const domain = name?.replace(/^audiolab\./, '').split('.')[0];
  return apps[domain];
}
export function appDomain(app) {
  const domain = Object.keys(apps).find(key => apps[key] === app);
  if (!domain) throw new Error(`Unknown app: ${app}`);
  return domain;
}
export function createAudiolabManifest(app) {
  appDomain(app);
  validateQueryCatalogue(app);
  const probe = manifest.actions['audiolab.query'];
  return { ...manifest, actions: { ...manifest.actions, 'audiolab.query': {
    ...probe, schema: { ...probe.schema, properties: { ...probe.schema.properties,
      ref: { ...probe.schema.properties.ref, enum: Object.keys(getQueryCatalogue(app)) },
    } }, examples: probe.examples.map(example => ({ ...example, ref: 'route' })),
  } } };
}
// The product checkout each attempt ran against, in the shape the shared recipe CLI writes
// (recipe-cli run-report indexProductProvenanceArtifact). Publication accepts evidence from a
// second attempt (the other platform of a two-platform proof) only with this file; run.mjs
// drives the runner directly, so the host records it (run 1ad82ba1).
export function checkoutState(projectRoot) {
  const git = args => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { gitRef: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']) || 'detached',
      dirty: git(['status', '--porcelain', '--untracked-files=normal']).length > 0 };
  } catch {
    // A non-Git checkout keeps explicit unknown provenance.
    return { gitRef: 'unknown', branch: 'unknown', dirty: true };
  }
}

// `before` is the checkout when the request was built: a checkout that was dirty then, or
// whose HEAD moved during the run, is recorded dirty even if it is clean at closeout.
export async function recordProductProvenance(context, projectRoot, adapter, before) {
  const now = checkoutState(projectRoot);
  const dirty = now.dirty || !before || before.dirty || before.gitRef !== now.gitRef;
  const provenance = { schemaVersion: 1, adapter, repository: path.basename(path.resolve(projectRoot)), git_ref: now.gitRef, branch: now.branch, dirty };
  await fs.writeFile(path.join(context.artifactsDir, 'product-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  context.register({ path: 'product-provenance.json', type: 'json', label: 'Product checkout provenance', category: 'system',
    metadata: { adapter, git_ref: now.gitRef, branch: now.branch, dirty } });
}

export function createAudiolabHost({ app, platform, device, projectRoot = repoRoot, noHud = false, updateBaselines = false }) {
  const appRoot = appRootFor(projectRoot, app);
  const scopedManifest = createAudiolabManifest(app);
  const runner = createRecipeRunner({ actionManifest: scopedManifest,
    adapters: createAdapters({ app, appRoot, platform, device, actions: actionNames, updateBaselines }),
    defaultSource: provenance, hud: noHud ? false : { enabled: true },
    recording: { targetProvider: { resolveRecordingTarget: () => recordingTarget({ platform, device, serial: process.env.ADB_SERIAL, simulator: process.env.IOS_SIMULATOR, iosDevice: process.env.IOS_DEVICE_UDID, cdp: process.env.CDP_PORT, metro: process.env.METRO_PORT || process.env.WATCHER_PORT }) } },
    runner: { source: 'audiolab', git_ref: 'checkout', name: 'audiolab-recipe' },
  });
  return { runner, appRoot,
    request(input) {
      const before = checkoutState(projectRoot);
      // Preserve the app-local/project-hook screenshot default. The shared CLI
      // supplies its own recording admission through the default engine.
      return { recordVideo: 'off', recordingReason: 'App-local Audiolab validation captures recipe screenshots.',
        ...input, projectRoot, adapter: platform,
        librarySources: [{ name: 'audiolab', root: libraryRoot, provenance }],
        async finalizeArtifacts(context) {
          await input.finalizeArtifacts?.(context);
          await recordProductProvenance(context, projectRoot, platform, before);
        },
      };
    },
  };
}
export async function resolveDevice({ platform, device, simulator, serial, iosDevice }, execute = promisify(execFile)) {
  if (device) return device;
  if (platform === 'web') return 'web';
  if (platform === 'ios') {
    if (!iosDevice) return simulator;
    const physical = selectIOSDevice({ udid: iosDevice });
    return `device:${physical.name}`;
  }
  if (platform === 'android' && serial) {
    const { stdout } = await execute('adb', ['-s', serial, 'shell', 'getprop', 'ro.product.model']);
    return stdout.trim();
  }
}

export async function matrixDevices(appRoot) {
  const bridge = createBridge({ appRoot });
  const result = await bridge(['list-devices']);
  return result.devices ?? [];
}
export function selectMatrixDevice(platform, devices, preferred) {
  const candidates = devices.filter(device => device.platform === platform);
  return candidates.find(device => device.name === preferred)
    ?? candidates.find(device => device.targetType === (platform === 'ios' ? 'simulator' : 'emulator'))
    ?? candidates[0];
}

export async function captureFailureDiagnostics({ appRoot, device, platform, artifactsDir }) {
  const bridge = createBridge({ appRoot, device, platform });
  const report = {};
  for (const [name, command] of [['route', 'get-route'], ['state', 'get-state']]) {
    try { report[name] = await bridge([command], 5000); }
    catch (error) { report[name] = { error: error.message }; }
  }
  const entries = [];
  async function retain(file, contents, type) {
    const destination = path.join(artifactsDir, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
    entries.push({ path: file, type, category: 'diagnostic' });
  }
  try {
    const shot = await bridge(['screenshot', 'failure'], 10000);
    if (shot.screenshot) {
      await retain('diagnostics/failure.png', await fs.readFile(shot.screenshot), 'screenshot');
    }
  } catch (error) { report.screenshot = { error: error.message }; }
  for (const [name, contents] of [
    ['metro.log', await readRecentMetroLog(appRoot).catch(() => '')],
    ['web-browser.log', await readRecentLog(path.join(appRoot, '.agent/web-browser.log')).catch(() => '')],
  ]) {
    if (contents) await retain(`diagnostics/${name}`, contents, 'log');
  }
  await retain('diagnostics/state.json', JSON.stringify(report, null, 2) + '\n', 'json');
  const manifestPath = path.join(artifactsDir, 'artifact-manifest.json');
  const artifacts = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  artifacts.artifacts.push(...entries);
  await fs.writeFile(manifestPath, JSON.stringify(artifacts, null, 2) + '\n');
}
