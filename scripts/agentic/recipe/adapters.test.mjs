import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRecipeRunner } from '@farmslot/recipe-runner';
import { validateRecipeCliInput } from '@farmslot/recipe-runner/cli/support';
import { PNG } from 'pngjs';
import { manifest, selectMatrixDevice, resolveDevice, createAudiolabHost, captureFailureDiagnostics } from './host.mjs';
import { createAdapters, getQueryCatalogue, validateQueryCatalogue } from './adapters.mjs';

async function fixture(t, platform = 'web', screenshot = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-adapter-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'scripts/agentic');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'cdp-bridge.mjs'), `
    const args = process.argv.slice(2);
    const command = args[2];
    const expression = args[3] ?? '';
    if (expression === 'recover') {
      const fs = await import('node:fs');
      const mark = ${JSON.stringify(path.join(root, 'recovered'))};
      if (!fs.existsSync(mark)) { fs.writeFileSync(mark, '1'); process.exit(1); }
    }
    const output = command === 'eval-async' ? { timeout: Number(process.env.EVAL_TIMEOUT) }
      : command === 'eval' && expression.includes('testExtractPreview') ? { previous: null, started: { status: 'pending' } }
      : command === 'eval' && expression.includes('getLastResult') ? { status: 'success', op: 'extractPreview' }
      : command === 'eval' ? { ready: true, failed: true }
      : command === 'press-test-id' ? { ok: true, args }
      : command === 'screenshot' ? { screenshot: ${JSON.stringify(screenshot)} } : {};
    console.log(JSON.stringify(JSON.stringify(output)));
  `);
  const adapters = createAdapters({ app: 'playground', appRoot: root, device: 'web', platform,
    actions: ['ui.press', 'ui.screenshot', 'app.hud'] });
  const select = action => adapters.find(adapter => adapter.action === action);
  select.root = root;
  return select;
}

function testRunner(adapters) {
  const actions = [...adapters.map(adapter => adapter.action), 'end'];
  return createRecipeRunner({
    actionManifest: { ...manifest, actions: Object.fromEntries(actions.map(action => [action, manifest.actions[action]])) },
    adapters, defaultSource: { kind: 'operator', trust: 'trusted' }, hud: false,
  });
}

test('probe failure wins over its successful condition', async t => {
  const adapter = await fixture(t);
  await assert.rejects(adapter('audiolab.query').execute({ expression: 'probe',
    assert: { field: 'ready', operator: 'eq', value: true },
    fail_when: { field: 'failed', operator: 'eq', value: true }, poll: true }), /failed early/);
});

test('offline validation rejects unknown named queries before runtime access', async () => {
  const host = createAudiolabHost({ app: 'playground', platform: 'web', device: 'web', noHud: true });
  await assert.rejects(host.runner.preflight(host.request({
    recipeDocument: { $schema: 'https://farmslot.io/schemas/recipe-v1.schema.json', title: 'Typo in readiness query',
      workflow: { entry: 'inspect', nodes: {
        inspect: { action: 'audiolab.query', ref: 'missing-query', intent: 'Read app readiness.', next: 'done' },
        done: { action: 'end', status: 'pass' },
      } },
    }, artifactsDir: '/tmp/unused-audiolab-query-validation',
  })), /enum|manifest|invalid/i);
});

test('offline readiness fixtures reject a contradictory catalogue assertion', t => {
  const query = getQueryCatalogue('playground')['playground.record_screen_visible'];
  const original = query.assert;
  t.after(() => { query.assert = original; });
  assert.equal(validateQueryCatalogue('playground'), 2);
  assert.equal(validateQueryCatalogue('sherpa-voice'), 2);
  query.assert = { field: 'visible', operator: 'eq', value: false };
  assert.throws(() => validateQueryCatalogue('playground'), /fixtures disagree/);
});

test('failed-run diagnostics retain bounded Metro and browser logs', async t => {
  const adapter = await fixture(t);
  const artifacts = path.join(adapter.root, 'artifacts');
  await fs.mkdir(path.join(adapter.root, '.agent'), { recursive: true });
  await fs.mkdir(artifacts, { recursive: true });
  await fs.writeFile(path.join(artifacts, 'artifact-manifest.json'), JSON.stringify({ artifacts: [] }));
  const lines = Array.from({ length: 800 }, (_, index) => `startup line ${index}`).join('\n');
  for (const name of ['metro.log', 'web-browser.log']) await fs.writeFile(path.join(adapter.root, '.agent', name), lines);
  await captureFailureDiagnostics({ appRoot: adapter.root, platform: 'web', device: 'web', artifactsDir: artifacts });
  const index = JSON.parse(await fs.readFile(path.join(artifacts, 'artifact-manifest.json'), 'utf8'));
  for (const name of ['metro.log', 'web-browser.log']) {
    const relative = `diagnostics/${name}`;
    assert.equal(index.artifacts.find(entry => entry.path === relative).type, 'log');
    const retained = await fs.readFile(path.join(artifacts, relative), 'utf8');
    assert.equal(retained.split('\n').length, 500);
    assert.ok(retained.startsWith('startup line 300'));
  }
});

test('boolean false reaches the real bridge command', async t => {
  const adapter = await fixture(t);
  const result = await adapter('ui.press').execute({ test_id: 'toggle', value: false }, {});
  assert.deepEqual(result.output.args.slice(-2), ['--value', 'false']);
});

test('branching uses the last observation and selected platform', async t => {
  const adapter = await fixture(t);
  const result = await adapter('audiolab.choose').execute({ rules: [
    { field: 'last.enabled', operator: 'eq', value: true },
    { field: 'env.platform', operator: 'eq', value: 'web' },
  ] }, { outputs: new Map([['first', { enabled: true }], ['last', { enabled: false }]]) });
  assert.equal(result.case, 'case-1');
  assert.deepEqual(result.output, { enabled: false });
  const next = await adapter('audiolab.choose').execute({ rules: [{ field: 'last.enabled', operator: 'eq', value: false }] }, { outputs: new Map([['choose', result.output]]) });
  assert.equal(next.case, 'case-0');
});

test('missing screenshots fail instead of producing empty evidence', async t => {
  const adapter = await fixture(t);
  await assert.rejects(adapter('ui.screenshot').execute({}, { nodeId: 'proof' }), /did not produce a screenshot/);
});

test('native preview refuses a web target', async t => {
  const adapter = await fixture(t);
  await assert.rejects(adapter('audiolab.native_preview').execute({}), /requires iOS or Android/);
});

test('unknown probes fail before contacting a runtime', async t => {
  const adapter = await fixture(t);
  await assert.rejects(adapter('audiolab.query').execute({ ref: 'missing' }), /Unknown playground probe/);
});

test('native preview drives testExtractPreview and waits for its result', async t => {
  const adapter = await fixture(t, 'ios');
  const result = await adapter('audiolab.native_preview').execute({ timeout_ms: 1000 });
  assert.equal(result.output.op, 'extractPreview');
  assert.equal(result.output.status, 'success');
});

test('a no-match branch follows the recipe default destination', async t => {
  const adapter = await fixture(t);
  const branch = adapter('audiolab.choose');
  const result = await branch.execute({ rules: [{ field: 'env.platform', operator: 'eq', value: 'ios' }] }, { outputs: new Map() });
  assert.equal(Object.hasOwn(result, 'case'), false);
  const runner = testRunner([branch]);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-branch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = await runner.run({ artifactsDir: root, recipeDocument: { $schema: 'https://farmslot.io/schemas/recipe-v1.schema.json', workflow: { entry: 'choose', nodes: { choose: { action: 'audiolab.choose', intent: 'Choose the expected recording state.', rules: [{ field: 'env.platform', operator: 'eq', value: 'ios' }], cases: { 'case-0': 'fail' }, default: 'pass' }, fail: { action: 'end', status: 'fail' }, pass: { action: 'end', status: 'pass' } } } } });
  assert.equal(run.status, 'pass');
});

test('polling recovers after a transient bridge failure', async t => {
  const adapter = await fixture(t);
  const result = await adapter('audiolab.query').execute({ expression: 'recover', poll: true, poll_ms: 1, timeout_ms: 1000, assert: { field: 'ready', operator: 'eq', value: true } });
  assert.equal(result.output.ready, true);
});

test('async probes preserve the requested evaluation timeout', async t => {
  const adapter = await fixture(t);
  const result = await adapter('audiolab.query').execute({ expression: 'async-result', async: true, timeout_ms: 600000 });
  assert.ok(result.output.timeout > 590000);
});

test('matrix selection keeps separate platform targets', () => {
  const devices = [{ name: 'web', platform: 'web' }, { name: 'iPhone', platform: 'ios', targetType: 'simulator' }, { name: 'Pixel 6a', platform: 'android', targetType: 'physical' }];
  assert.equal(selectMatrixDevice('web', devices, 'Pixel 6a').name, 'web');
  assert.equal(selectMatrixDevice('ios', devices, 'Pixel 6a').name, 'iPhone');
  assert.equal(selectMatrixDevice('android', devices, 'Pixel 6a').name, 'Pixel 6a');
});

test('Android serials resolve to the Metro model name', async () => {
  let invocation;
  const device = await resolveDevice({ platform: 'android', serial: 'emulator-5580' }, async (file, args) => {
    invocation = { file, args };
    return { stdout: 'sdk_gphone64_arm64\r\n' };
  });
  assert.equal(device, 'sdk_gphone64_arm64');
  assert.deepEqual(invocation, { file: 'adb', args: ['-s', 'emulator-5580', 'shell', 'getprop', 'ro.product.model'] });
  assert.equal(await resolveDevice({ platform: 'ios', simulator: 'audiolab-6' }), 'audiolab-6');
  assert.equal(await resolveDevice({ platform: 'web' }), 'web');
});

test('a dimension mismatch retains a valid failed artifact package', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-visual-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const screenshot = path.join(root, 'actual.png');
  await fs.writeFile(screenshot, PNG.sync.write(new PNG({ width: 10, height: 10 })));
  await fs.writeFile(path.join(root, 'baseline.png'), PNG.sync.write(new PNG({ width: 12, height: 10 })));
  const adapter = await fixture(t, 'web', screenshot);
  const artifactsDir = path.join(root, 'artifacts');
  const recipe = { $schema: 'https://farmslot.io/schemas/recipe-v1.schema.json', workflow: { entry: 'capture', nodes: {
    capture: { action: 'ui.screenshot', intent: 'Preserve the recorder for visual comparison.', path: 'screenshots/actual.png', baseline: 'baseline.png', next: 'done' },
    done: { action: 'end', status: 'pass' },
  } } };
  const result = await testRunner([adapter('ui.screenshot')]).run({ projectRoot: root, artifactsDir, recipeDocument: recipe, recordVideo: 'off', recordingReason: 'Screenshot-diff contract test without a live recorder.' });
  assert.equal(result.status, 'fail');
  const packageManifest = JSON.parse(await fs.readFile(path.join(artifactsDir, 'artifact-manifest.json'), 'utf8'));
  assert.ok(packageManifest.artifacts.some(artifact => artifact.path === 'screenshots/actual.png'));
  assert.ok(!packageManifest.artifacts.some(artifact => artifact.path.endsWith('.diff.png')));
  const manifestPath = path.join(root, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const validation = await validateRecipeCliInput({ recipePath: path.join(artifactsDir, 'recipe.json'), actionManifestPath: manifestPath, artifactDir: artifactsDir });
  assert.equal(validation.status, 'valid', JSON.stringify(validation.findings));
});
