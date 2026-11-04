import fs from 'node:fs';
import path from 'node:path';
import { ADAPTER_SDK_VERSION } from '@farmslot/adapter-sdk';
import { createCdpVideoRecorder } from '@farmslot/recipe-runner';
import { createAndroidVideoRecorder, createIosSimulatorVideoRecorder } from '@farmslot/adapter-rn';
import { contextPorts } from '@farmslot/recipe-cli/harness';
import { recordingTarget } from './recording-target.mjs';
import { runOwnedRecipeProcess, recipeExecutionSignal } from '@farmslot/recipe-runner/adapters/core';
import { createBridge, createBridgeTransport, createAdapters } from './adapters.mjs';
import { appDomain, appRootFor, createAudiolabManifest, resolveDevice, repoRoot } from './host.mjs';
import { stopMetro, metroProcesses } from '../lib/metro-process.mjs';

export function createProvider(context) {
  const root = context.project?.checkoutRoot ?? repoRoot;
  const app = context.project?.app?.replace(/^apps\//, '');
  appDomain(app); // Explicit app selection is required; never infer another app from a recipe.
  const appRoot = appRootFor(root, app);
  if (path.resolve(context.target.value) !== appRoot) throw new Error('Provider target must be the selected app checkout.');
  const platform = context.adapter?.value;
  if (!['web', 'ios', 'android'].includes(platform)) throw new Error('Select web, ios or android.');
  const scopedManifest = createAudiolabManifest(app);
  const options = context.options ?? {};
  const configuredSlot = context.slot?.poolFile
    ? JSON.parse(fs.readFileSync(context.slot.poolFile, 'utf8')).slots.find(slot => slot.id === (context.slot.poolSlot ?? context.slot.value))
    : undefined;
  const resources = configuredSlot?.resources ?? {};
  const iosDevice = resources['ios-device']?.ios_device_udid || resources['ios-device']?.udid || process.env.IOS_DEVICE_UDID;
  const simulator = resources['ios-sim']?.simulator || process.env.IOS_SIMULATOR || (platform === 'ios' && !iosDevice ? options.device : undefined);
  const serial = resources['android-device']?.adb_serial || resources['android-emu']?.adb_serial || process.env.ADB_SERIAL;
  const explicitDevice = options.device;
  if (platform === 'ios' && simulator && explicitDevice && explicitDevice !== simulator) throw new Error('The requested iOS device differs from the assigned slot simulator.');
  if (platform === 'ios' && !explicitDevice && !simulator && !iosDevice) throw new Error('Select the assigned iOS device with --device or a configured slot target.');
  if (platform === 'android' && !serial) throw new Error('Configure the assigned Android ADB_SERIAL; no device discovery fallback is allowed.');
  const port = (value, label) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(`Select the assigned ${label} port.`);
    return number;
  };
  // The shared host loads the factory before publishing context.ports.
  // Use its read-only resolver so lifecycle and the invocation retain one target.
  const ports = context.ports ?? contextPorts(context, [
    ...(options.watcherPort !== undefined ? ['--watcher-port', String(options.watcherPort)] : []),
    ...(options.cdpPort !== undefined ? ['--cdp-port', String(options.cdpPort)] : []),
  ], { '--watcher-port': true, '--cdp-port': true }).ports;
  const metro = port(ports?.watcher?.value, 'Metro');
  const cdp = platform === 'web' ? port(ports?.cdp?.value, 'CDP') : undefined;
  const runtimeEnv = { APP_ROOT: appRoot, AUDIOLAB_APP: app, PLATFORM: platform,
    LOG_EVENTS: path.join(appRoot, '.agent/expo-events.log'),
    METRO_PORT: String(metro), WATCHER_PORT: String(metro),
    EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE: '1', HEADLESS: '1', WEB_HEADLESS: 'true', WEB_BROWSER_CHANNEL: 'chrome',
    ...(cdp ? { CDP_PORT: String(cdp) } : {}),
    ...(simulator ? { IOS_SIMULATOR: simulator } : {}),
    ...(iosDevice ? { IOS_DEVICE_UDID: iosDevice, DEVICE_MODE: 'device',
      IOS_CDP_DEVICE_ID: process.env.IOS_CDP_DEVICE_ID || resources['ios-device']?.ios_inspector_id || '' } : {}),
    ...(serial ? { ADB_SERIAL: serial, ...(serial.startsWith('emulator-') ? {} : { DEVICE_MODE: 'device' }) } : {}),
  };
  const env = { ...process.env, ...runtimeEnv };
  let device;
  let liveAdapters;
  let launchedMetro = false;
  async function selectedDevice() {
    return device ??= await resolveDevice({ platform, device: explicitDevice, simulator, serial, iosDevice }, async (command, argv) => {
      const result = await runOwnedRecipeProcess(command, argv, { cwd: appRoot, env, shell: false, signal: recipeExecutionSignal(), timeoutMs: 10000 });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'Assigned device is unavailable.');
      return result;
    });
  }
  const activate = () => { Object.assign(process.env, runtimeEnv); };
  async function bridge(args) {
    activate();
    return createBridge({ appRoot, platform, device: await selectedDevice() })(args, 10000);
  }
  async function leaf(file, args = [], timeoutMs = 540000) {
    const node = file.endsWith('.mjs');
    const result = await runOwnedRecipeProcess(node ? process.execPath : '/bin/bash',
      [path.join(root, file), ...args], { cwd: appRoot, env, shell: false, signal: recipeExecutionSignal(), timeoutMs,
        onOutput: chunk => process.stderr.write(chunk) });
    if (result.exitCode !== 0) throw new Error(result.stderr || `Audiolab lifecycle failed: ${file}`);
    return 0;
  }
  const transport = {
    async execute(action, node, execution) {
      activate();
      return createBridgeTransport({ appRoot, platform, device: await selectedDevice() }).execute(action, node, execution);
    },
  };
  async function runtimeStatus() {
    try {
      metroProcesses(appRoot, metro);
      const observed = await bridge(['get-route']);
      if (!observed.pathname) throw new Error('The selected app has no observed route.');
      return { decision: 'ready', reasons: [], devServer: { label: 'Metro', status: 'ready' } };
    } catch (error) { return { decision: 'not-ready', reasons: [error.message], nextAction: 'farmslot recipe launch --json' }; }
  }
  return {
    commandOptions: { task: { stepGates: [] } },
    runtime: {
      id: platform, targets: [platform], sdkVersion: ADAPTER_SDK_VERSION, headless: false,
      resolveSlotPorts: activate,
      runtimeStatus,
      devServer: { label: 'Metro', describe: () => 'The selected app Metro server', portEnv: ['METRO_PORT'],
        stop: () => stopMetro(appRoot, metro) },
      logSources: () => [{ label: 'Metro', path: path.join(appRoot, '.agent/metro.log') }],
      appLogSource: () => ({ label: 'App console', path: path.join(appRoot, '.agent/web-console.log') }),
      hints: { launch: 'farmslot recipe launch --json', relaunch: 'farmslot recipe launch --json', runtimeProbeRecovery: () => 'farmslot recipe status --json' },
      harness: { kind: 'built-in', verify: () => ({
        inProcess: async () => async (_args, io) => {
          const status = await runtimeStatus();
          io.out(JSON.stringify(status));
          return status.decision === 'ready' ? 0 : 1;
        },
      }) },
      runtimeContext: { forbiddenFields: [] },
      readiness: { statusRuntime: true, captureProviders: ['Audiolab CDP bridge'] },
      async launch() {
        try {
        launchedMetro = metroProcesses(appRoot, metro).length === 0;
        if (platform === 'web') {
          await leaf('scripts/agentic/start-metro.sh', [], 60000);
          const existing = await fetch(`http://127.0.0.1:${cdp}/json/version`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
          if (existing?.ok) {
            // Attach to an existing assigned app; never replace a browser to make readiness pass.
            await recordingTarget({ platform, cdp, metro });
            await bridge(['get-route']);
            return 0;
          }
          return await leaf('scripts/agentic/web-browser.mjs', ['launch', '--wait'], 180000);
        }
        // Device boot/shutdown belongs to the allocation's capability, never this provider.
        const check = platform === 'android'
          ? await runOwnedRecipeProcess('adb', ['-s', serial, 'get-state'], { cwd: appRoot, env, shell: false, timeoutMs: 10000, signal: recipeExecutionSignal() })
          : iosDevice ? { exitCode: 0 }
          : await runOwnedRecipeProcess('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { cwd: appRoot, env, shell: false, timeoutMs: 10000, signal: recipeExecutionSignal() });
        if (check.exitCode !== 0 || (platform === 'ios' && !iosDevice && !Object.values(JSON.parse(check.stdout).devices).flat().some(d => d.name === (simulator || explicitDevice) || d.udid === (simulator || explicitDevice)))) throw new Error('Acquire the assigned device capability before launch.');
        return await leaf(`apps/${app}/scripts/agentic/preflight.sh`);
        } catch (error) {
          if (launchedMetro) stopMetro(appRoot, metro);
          throw error;
        }
      },
      reload: async () => { await bridge(['reload']); return 0; },
      actions: {
        manifestPath: () => path.join(root, 'scripts/agentic/recipe/action-manifest.json'),
        semantic: [], cdpTarget: { transport: 'audiolab-bridge', probePath: '/json/list' },
        inputFindings(nodeId, node) {
          return node.action === 'audiolab.query' && node.ref && !scopedManifest.actions['audiolab.query'].schema.properties.ref.enum.includes(node.ref)
            ? [{ severity: 'error', code: 'audiolab.query_app_scope', path: `workflow.nodes.${nodeId}.ref`, message: `Query ${node.ref} is not available in ${app}.` }] : [];
        },
        async adapters() {
          const definitions = createAdapters({ app, appRoot, platform, device: explicitDevice || platform, actions: Object.keys(scopedManifest.actions) });
          return definitions.filter(adapter => adapter.action.startsWith('audiolab.')).map(adapter => ({ ...adapter,
            async execute(node, execution) {
              activate();
              liveAdapters ??= createAdapters({ app, appRoot, platform, device: await selectedDevice(), actions: Object.keys(scopedManifest.actions) });
              return liveAdapters.find(entry => entry.action === adapter.action).execute(node, execution);
            },
          }));
        },
        ui: () => ({ base: transport }),
        // Existing library paths are checkout-relative, while shared CLI selection targets the app.
        // Retain the SDK's path validation and change only the owning project root.
        wrap: adapters => adapters.map(adapter => ({ ...adapter,
          execute: (node, execution) => adapter.execute(node, { ...execution, projectRoot: root,
            resolveProjectPath: relative => path.join(root, path.relative(appRoot, execution.resolveProjectPath(relative))),
          }),
        })),
      },
      recording: { target: () => recordingTarget({ platform, serial, simulator, device: explicitDevice, iosDevice, cdp, metro }),
        videoRecorder: async () => {
          if (platform === 'web') return createCdpVideoRecorder({ cdpPort: cdp, urlIncludes: `:${metro}` });
          if (platform === 'android') return createAndroidVideoRecorder(serial);
          if (!iosDevice && !explicitDevice?.startsWith('device:'))
            return createIosSimulatorVideoRecorder(simulator || explicitDevice);
        },
      },
    },
    cancel() { if (launchedMetro) stopMetro(appRoot, metro); },
  };
}
