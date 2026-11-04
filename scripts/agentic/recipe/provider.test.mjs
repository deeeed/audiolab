import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { createServer } from 'node:http';
import { handleCall, recipeHarnessPath, sourceSnapshot, withProjectRecipeHost } from '@farmslot/recipe-cli/harness';
import { withRecipeExecutionSignal } from '@farmslot/recipe-runner/adapters/core';
import { createProvider } from './provider.mjs';
import { createBridge } from './adapters.mjs';
import { repoRoot, createAudiolabManifest, createAudiolabHost } from './host.mjs';

function context(app = 'playground', platform = 'web') {
  return { project: { checkoutRoot: repoRoot, app: `apps/${app}` },
    target: { value: path.join(repoRoot, 'apps', app) }, adapter: { value: platform },
    options: { watcherPort: '19746', cdpPort: '19767', ...(platform === 'ios' ? { device: 'assigned-simulator' } : {}) } };
}

test('provider factories are read-only and preserve app-scoped handler declarations', async () => {
  const keys = ['METRO_PORT', 'WATCHER_PORT', 'CDP_PORT', 'PLATFORM', 'AUDIOLAB_APP'];
  const before = keys.map(key => process.env[key]);
  for (const app of ['playground', 'sherpa-voice']) {
    const provider = createProvider(context(app));
    assert.deepEqual(provider.commandOptions, { task: { stepGates: [] } });
    assert.equal(provider.engine, undefined);
    assert.equal(provider.runtime.sdkVersion, 1);
    assert.equal(provider.runtime.id, 'web');
    assert.equal(provider.runtime.harness.kind, 'built-in');
    assert.equal('install' in provider.runtime.harness, false);
    assert.equal('cleanup' in provider.runtime.harness, false);
    const handlers = await provider.runtime.actions.adapters();
    assert.deepEqual(handlers.map(h => h.action), ['audiolab.query', 'audiolab.choose', 'audiolab.logs', 'audiolab.native_preview']);
    const allowed = createAudiolabManifest(app).actions['audiolab.query'].schema.properties.ref.enum;
    assert.equal(provider.runtime.actions.inputFindings('read', { action: 'audiolab.query', ref: allowed[0] }).length, 0);
    assert.equal(provider.runtime.actions.inputFindings('read', { action: 'audiolab.query', ref: 'foreign-app-query' })[0].severity, 'error');
  }
  assert.ok(keys.every((key, i) => process.env[key] === before[i]), 'Factory changed runtime settings.');
});


test('the provider workspace reloads with its sibling imports and installed dependencies', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-frozen-provider-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = JSON.parse(await fs.readFile(path.join(repoRoot, 'farmslot/projects/audiolab-farm/project.json'), 'utf8'));
  const declaration = config.recipe.provider;
  const retained = path.join(root, 'provider');
  const workspace = path.join(repoRoot, 'scripts/agentic');
  await fs.cp(workspace, retained, { recursive: true });
  const script = `
    const { createProvider } = await import(process.argv[1]);
    const checkout = process.argv[2];
    const provider = createProvider({ project: { checkoutRoot: checkout, app: 'apps/playground' },
      target: { value: checkout + '/apps/playground' }, adapter: { value: 'web' },
      options: { watcherPort: '19746', cdpPort: '19767' } });
    console.log(JSON.stringify(provider.commandOptions));
  `;
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', script, path.join(retained, path.relative(workspace, path.join(repoRoot, declaration.root.projectPath, declaration.module))), root],
    { cwd: root, timeout: 4000, env: { ...process.env, NODE_PATH: '' } });
  assert.deepEqual(JSON.parse(stdout), { task: { stepGates: [] } });
});

test('provider rejects unsupported or ambiguous app/device targeting before execution', () => {
  assert.throws(() => createProvider(context('minimal')), /Unknown app/);
  assert.throws(() => createProvider(context('playground', 'mobile')), /Select web, ios or android/);
  const missing = context('playground', 'ios');delete missing.options.device;
  const env = process.env.IOS_SIMULATOR;const phone = process.env.IOS_DEVICE_UDID;
  delete process.env.IOS_SIMULATOR;delete process.env.IOS_DEVICE_UDID;
  try { assert.throws(() => createProvider(missing), /assigned iOS device/); }
  finally { if (env !== undefined) process.env.IOS_SIMULATOR = env;if (phone !== undefined) process.env.IOS_DEVICE_UDID = phone; }
  const wrong = context();wrong.target.value = repoRoot;
  assert.throws(() => createProvider(wrong), /selected app checkout/);
});

test('clean-environment slot ports stay consistent with the shared host', t => {
  const portKeys = ['TERMINAL_APP_PORT', 'RECIPE_WATCHER_PORT', 'WATCHER_PORT', 'METRO_PORT', 'RECIPE_CDP_PORT', 'CDP_PORT'];
  const keys = [...portKeys, 'APP_ROOT', 'AUDIOLAB_APP', 'PLATFORM', 'LOG_EVENTS', 'EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE', 'HEADLESS', 'WEB_HEADLESS', 'WEB_BROWSER_CHANNEL'];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key];else process.env[key] = saved[i]; }));
  portKeys.forEach(key => delete process.env[key]);
  const selected = context();selected.options = {};
  selected.slot = { value: 'owned-slot', ports: { port: 19745, metro_port: 19746, cdp_port: 19767 } };
  const provider = createProvider(selected);
  assert.ok(portKeys.every(key => process.env[key] === undefined), 'Factory changed port settings.');
  provider.runtime.resolveSlotPorts();
  assert.equal(process.env.METRO_PORT, '19745');
  assert.equal(process.env.WATCHER_PORT, '19745');
  assert.equal(process.env.CDP_PORT, '19767');
});

test('explicit unpooled iOS selection reaches the native launch environment', t => {
  const keys = ['IOS_SIMULATOR', 'IOS_DEVICE_UDID', 'APP_ROOT', 'AUDIOLAB_APP', 'PLATFORM', 'LOG_EVENTS', 'METRO_PORT', 'WATCHER_PORT', 'EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE', 'HEADLESS', 'WEB_HEADLESS', 'WEB_BROWSER_CHANNEL'];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key];else process.env[key] = saved[i]; }));
  delete process.env.IOS_SIMULATOR;delete process.env.IOS_DEVICE_UDID;
  const provider = createProvider(context('playground', 'ios'));
  provider.runtime.resolveSlotPorts();
  assert.equal(process.env.IOS_SIMULATOR, 'assigned-simulator');
});

test('native preflight retains an explicitly selected simulator UUID', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provider-simulator-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const udid = '11111111-2222-3333-4444-555555555555';
  const devices = path.join(root, 'devices.json');
  await fs.writeFile(devices, JSON.stringify({ devices: { ios: [{ name: 'Assigned iPhone', udid, isAvailable: true }] } }));
  const source = await fs.readFile(path.join(repoRoot, 'scripts/agentic/preflight.sh'), 'utf8');
  const start = source.indexOf('    SIM_UUID=$(xcrun');
  const selection = source.slice(start, source.indexOf('\n  fi\nelif', start));
  const script = `xcrun() { cat "$FIXTURE_DEVICES"; }; fail() { echo "$@" >&2; }; launch_stage() { printf '%s\\n' "$@"; };\n${selection}`;
  const { stdout } = await promisify(execFile)('/bin/bash', ['-c', script], {
    timeout: 2000, env: { ...process.env, SIM: udid, FIXTURE_DEVICES: devices },
  });
  assert.equal(stdout.trim(), `simulator-boot\n120\ndevice=${udid}`);
});

test('the declared factory resolves through the public shared host and default engine', async () => {
  await withProjectRecipeHost({ tokens: ['--project', 'audiolab-farm', '--target', repoRoot, '--app', 'apps/playground', '--adapter', 'web', '--watcher-port', '19746', '--cdp-port', '19767'],
    projectsDir: path.join(repoRoot, 'farmslot/projects'), command: 'run', options: { plan: true, watcherPort: '19746', cdpPort: '19767' } }, async host => {
    assert.equal(host.context.project.provider.module, path.join(repoRoot, 'scripts/agentic/recipe/provider.mjs'));
    assert.equal(host.provider.engine, undefined);
    const selected = await host.engine.resolveActionManifest('web');
    const runner = await host.engine.createRunner('web', selected.manifest, { source: { kind: 'operator', trust: 'trusted', name: 'audiolab-test' } });
    const plan = await runner.preflight({ projectRoot: host.context.target.value, artifactsDir: path.join(repoRoot, '.agent/provider-test'),
      recipePath: path.join(repoRoot, 'scripts/agentic/recipe/recipes/playground/smoke.navigation.recipe.json'), adapter: 'web', librarySources: host.librarySources });
    assert.ok(plan.nodes.some(n => n.action === 'assert_output'));
    assert.ok(plan.nodes.some(n => n.id === 'assert-restored' || n.nodeId === 'assert-restored'));
    const [command] = host.provider.runtime.actions.wrap([{ action: 'command', execute: (_node, ctx) => ({ output: { root: ctx.projectRoot, file: ctx.resolveProjectPath('scripts/agentic/recipe/queries.json') } }) }]);
    const output = command.execute({}, { projectRoot: host.context.target.value, resolveProjectPath: relative => path.join(host.context.target.value, relative) }).output;
    assert.equal(output.root, repoRoot);
    assert.equal(output.file, path.join(repoRoot, 'scripts/agentic/recipe/queries.json'));
  });
});

test('bridge cancellation stops the owned child instead of leaving a stalled action', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provider-cancel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts/agentic'), { recursive: true });
  const marker = path.join(root, 'pid');
  await fs.writeFile(path.join(root, 'scripts/agentic/cdp-bridge.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},100);`);
  const controller = new AbortController();
  const run = withRecipeExecutionSignal(controller.signal, () => createBridge({ appRoot: root, device: 'web', platform: 'web' })(['get-route'], 2000));
  const rejection = assert.rejects(run, /abort|cancel/i);
  t.after(() => controller.abort());
  const deadline = Date.now() + 2000;
  while (!(await fs.stat(marker).catch(() => false))) {
    assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const pid = Number(await fs.readFile(marker, 'utf8'));
  controller.abort();await rejection;
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});


test('generated app runtime logs do not drift the shared source identity', async t => {
  const appRoot = path.join(repoRoot, 'apps/playground');
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provider-log-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const generated = path.join(fixture, '.agent');
  await fs.mkdir(generated);
  await fs.writeFile(path.join(fixture, 'app.mjs'), 'export const source = 1;');
  const before = sourceSnapshot(fixture, undefined, [generated]);
  await fs.writeFile(path.join(generated, 'events.log'), 'runtime event\n');
  const after = sourceSnapshot(fixture, undefined, [generated]);
  assert.equal(before.sourceFingerprint, after.sourceFingerprint);
  await fs.writeFile(path.join(fixture, 'app.mjs'), 'export const source = 2;');
  assert.notEqual(after.sourceFingerprint, sourceSnapshot(fixture, undefined, [generated]).sourceFingerprint);
  const keys = ['APP_ROOT', 'AUDIOLAB_APP', 'PLATFORM', 'METRO_PORT', 'WATCHER_PORT', 'CDP_PORT', 'LOG_EVENTS', 'EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE', 'HEADLESS', 'WEB_HEADLESS', 'WEB_BROWSER_CHANNEL'];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key];else process.env[key] = saved[i]; }));
  createProvider(context()).runtime.resolveSlotPorts();
  assert.equal(process.env.LOG_EVENTS, path.join(appRoot, '.agent/expo-events.log'));
});

test('Expo CLI writes its event log to the declared destination', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-expo-log-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appRoot = path.join(repoRoot, 'apps/playground');
  const require = createRequire(path.join(appRoot, 'package.json'));
  const log = path.join(root, 'events.log');
  const env = { ...process.env, LOG_EVENTS: log };
  const execute = promisify(execFile);
  await execute(process.execPath, [require.resolve('expo/bin/cli'), 'config', '--type', 'public', '--json'], { cwd: appRoot, env });
  const output = await fs.readFile(log, 'utf8');
  assert.ok(output.includes('init'), 'Expo logger did not initialize at its configured destination.');
});

test('local and project-hook requests preserve screenshot validation on physical iOS', () => {
  const host = createAudiolabHost({ app: 'playground', platform: 'ios', device: 'device:Assigned iPhone' });
  const request = host.request({ recipePath: 'playground.smoke.navigation' });
  assert.equal(request.recordVideo, 'off');
  assert.match(request.recordingReason, /screenshots/);
  assert.equal(host.request({ recordVideo: 'full-run' }).recordVideo, 'full-run');
});

test('web recording selects the shared CDP recorder and binds its assigned endpoint', async t => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([{ id: 'assigned-page', type: 'page', url: 'http://localhost:19746', webSocketDebuggerUrl: 'ws://unused' }]));
  });
  t.after(async () => { server.closeAllConnections();await new Promise(resolve => server.close(resolve)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const cdp = server.address().port;
  const selected = context();selected.options.cdpPort = String(cdp);
  const recorder = await createProvider(selected).runtime.recording.videoRecorder();
  assert.equal(recorder.name, 'cdp-screencast');
  await assert.rejects(recorder.start({
    target: { kind: 'cdp-page', host: '127.0.0.1', port: cdp === 65535 ? 65534 : cdp + 1, targetId: 'assigned-page' },
    outputPath: path.join(os.tmpdir(), 'audiolab-endpoint-refusal.mp4'),
  }), /different endpoint/);
  const native = createProvider(context('playground', 'ios'));
  assert.equal((await native.runtime.recording.videoRecorder()).name, 'simctl');
  assert.deepEqual(await native.runtime.recording.target(), { kind: 'simulator', device: 'assigned-simulator' });
});

test('native recording uses the shared recorder bound to the assigned target', async t => {
  const saved = process.env.ADB_SERIAL;
  t.after(() => { if (saved === undefined) delete process.env.ADB_SERIAL;else process.env.ADB_SERIAL = saved; });
  for (const [serial, expected] of [['assigned-physical-device', 'android-recording'], ['emulator-5554', 'adb-screenrecord']]) {
    process.env.ADB_SERIAL = serial;
    const recording = createProvider(context('playground', 'android')).runtime.recording;
    assert.equal(typeof recording.videoRecorder, 'function');
    const recorder = await recording.videoRecorder();
    assert.equal(recorder.name, expected);
    assert.deepEqual(await recording.target(), { kind: 'android-device', serial });
    await assert.rejects(recorder.start({ target: { kind: 'android-device', serial: 'foreign-device' }, outputPath: '/unused.mp4' }), /does not match/);
  }
  const recording = createProvider(context('playground', 'ios')).runtime.recording;
  assert.equal(typeof recording.videoRecorder, 'function');
  assert.equal((await recording.videoRecorder()).name, 'simctl');
  const physical = context('playground', 'ios');
  physical.options.device = 'device:assigned-iphone';
  const unsupported = createProvider(physical).runtime.recording;
  assert.equal(await unsupported.videoRecorder(), undefined);
  await assert.rejects(unsupported.target(), /Physical iOS video capture is not declared/);
});

test('built-in verification observes the bound bridge and refuses missing route readiness', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provider-verify-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'apps/playground');
  const scriptRoot = path.join(appRoot, 'scripts/agentic');
  await fs.mkdir(scriptRoot, { recursive: true });
  const state = path.join(appRoot, 'observed-route.json');
  await fs.writeFile(state, JSON.stringify({ pathname: '/more' }));
  await fs.writeFile(path.join(scriptRoot, 'cdp-bridge.mjs'), `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    assert.deepEqual(process.argv.slice(2), ['--device', 'web', 'get-route']);
    assert.equal(fs.realpathSync(process.env.APP_ROOT), process.cwd());
    console.log(fs.readFileSync('observed-route.json', 'utf8'));
  `);
  const keys = ['APP_ROOT', 'AUDIOLAB_APP', 'PLATFORM', 'LOG_EVENTS', 'METRO_PORT', 'WATCHER_PORT', 'CDP_PORT', 'EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE', 'HEADLESS', 'WEB_HEADLESS', 'WEB_BROWSER_CHANNEL'];
  const saved = keys.map(key => process.env[key]);
  t.after(() => keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key];else process.env[key] = saved[i]; }));
  const selected = context();selected.project.checkoutRoot = root;selected.target.value = appRoot;
  const provider = createProvider(selected);
  const verification = provider.runtime.harness.verify(appRoot);
  assert.equal(verification.command, undefined);
  const runVerify = await verification.inProcess();
  const output = [];
  const io = { out: value => output.push(JSON.parse(value)), err: value => assert.fail(value) };
  const files = await fs.readdir(appRoot);
  assert.equal(await runVerify(['--target', '/unrelated-checkout'], io), 0, output.at(-1)?.reasons?.join('\n'));
  assert.equal(output.pop().decision, 'ready');
  assert.deepEqual(await fs.readdir(appRoot), files);
  assert.equal(await fs.stat(path.join(appRoot, '.harness')).catch(() => null), null);
  await fs.writeFile(state, '{}');
  assert.equal(await runVerify([], io), 1);
  assert.match(output.pop().reasons[0], /no observed route/);
  assert.deepEqual(await fs.readdir(appRoot), files);
});

test('the published shared host executes a default-healing call without overlay mutations', async t => {
  const parent = path.join(repoRoot, '.agent');
  await fs.mkdir(parent, { recursive: true });
  const artifacts = await fs.mkdtemp(path.join(parent, 'provider-default-heal-'));
  t.after(() => fs.rm(artifacts, { recursive: true, force: true }));
  const relative = path.relative(repoRoot, artifacts);
  await withProjectRecipeHost({
    tokens: ['--project', 'audiolab-farm', '--target', repoRoot, '--app', 'apps/playground', '--adapter', 'web',
      '--watcher-port', '19746', '--cdp-port', '19767', '--artifacts-dir', relative],
    projectsDir: path.join(repoRoot, 'farmslot/projects'), command: 'call',
    options: { json: true, watcherPort: '19746', cdpPort: '19767', artifactsDir: relative,
      recordVideo: 'off', recordingReason: 'Default-healing contract fixture without a live browser.', hud: 'hide', sourceTrust: 'trusted' },
    deferOutput: true,
  }, async host => {
    assert.equal(host.cli.heal, undefined);
    const overlay = recipeHarnessPath(host.context.target.value, 'web');
    assert.equal(await fs.stat(overlay).catch(() => null), null);
    // Only the app observation is a fixture; host healing, catalog, engine and writer are real.
    host.provider.runtime.actions.ui = () => ({ base: { execute(action) {
      assert.equal(action, 'app.status');
      return { pathname: '/record' };
    } } });
    assert.equal(await handleCall([], { parsed: { positional: ['app.status'], options: host.cli },
      engine: host.engine, librarySources: host.librarySources, signal: host.signal, beforeResult: host.finalize }), 0);
    assert.equal(await fs.stat(overlay).catch(() => null), null);
  });
  const summary = JSON.parse(await fs.readFile(path.join(artifacts, 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'pass');
  assert.deepEqual(summary.mutations, []);
});
