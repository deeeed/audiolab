import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createStandardCoreAdapters, createStandardUiAdapters } from '@farmslot/recipe-runner';
import { runOwnedRecipeProcess, recipeExecutionSignal, assertRecipeActive } from '@farmslot/recipe-runner/adapters/core';

const require = createRequire(import.meta.url);
const { checkAssert, parseRaw } = require('../lib/assert.js');
const { comparePngFiles } = require('../lib/screenshot.js');
const queries = JSON.parse(await fs.readFile(new URL('./queries.json', import.meta.url), 'utf8'));
const source = { kind: 'bundled', trust: 'trusted', name: 'audiolab' };

const nodeFile = nodeId => nodeId.replaceAll('/', '-');
export function getQueryCatalogue(app) {
  const catalogue = queries[app];
  if (!catalogue) throw new Error(`Unknown app query catalogue: ${app}`);
  return catalogue;
}

export function resolveQuery(app, node) {
  const spec = node.ref ? getQueryCatalogue(app)[node.ref] : node;
  if (!spec?.expression) throw new Error(`Unknown ${app} probe: ${node.ref ?? '<expression missing>'}`);
  return spec;
}

export function validateQueryCatalogue(app) {
  let count = 0;
  for (const ref of Object.keys(getQueryCatalogue(app))) {
    const spec = resolveQuery(app, { ref });
    if (!spec.fixtures) continue;
    if (!spec.assert || !checkAssert(parseRaw(spec.fixtures.pass), spec.assert) || checkAssert(parseRaw(spec.fixtures.fail), spec.assert)) {
      throw new Error(`Readiness fixtures disagree with ${app} probe ${ref}`);
    }
    count++;
  }
  return count;
}
export async function readRecentLog(file) {
  const log = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return log.split('\n').slice(-500).join('\n');
}
export function readRecentMetroLog(appRoot) {
  return readRecentLog(process.env.METRO_LOG ?? path.join(appRoot, '.agent/metro.log'));
}

export function createBridge({ appRoot, device, platform }) {
  return async function bridge(args, timeout = 60000) {
    const { stdout, stderr, exitCode } = await runOwnedRecipeProcess(process.execPath,
      [path.join(appRoot, 'scripts/agentic/cdp-bridge.mjs'), ...(device ? ['--device', device] : []), ...args.map(String)],
      { cwd: appRoot, timeoutMs: timeout, signal: recipeExecutionSignal(), shell: false, env: { ...process.env, ...(platform ? { AUDIOLAB_RECIPE_PLATFORM: platform } : {}), EVAL_TIMEOUT: String(timeout) } });
    if (exitCode !== 0) throw new Error(stderr.trim() || `Audiolab bridge exited ${exitCode}`);
    const result = parseRaw(stdout.trim());
    if (device && result?.devices && args[0] !== 'list-devices') throw new Error('Recipe proof requires exactly one selected device.');
    return result;
  }
}

export function createAdapters({ app, appRoot, device, platform, actions, updateBaselines = false }) {
  const bridge = createBridge({ appRoot, device, platform });
  async function query(node) {
    const spec = resolveQuery(app, node);
    const isAsync = node.async ?? spec.async;
    const timeout = node.timeout_ms ?? (node.poll ? 10000 : isAsync ? Number(process.env.EVAL_TIMEOUT ?? 30000) : 60000);
    const deadline = Date.now() + timeout;
    let output;
    do {
      assertRecipeActive(recipeExecutionSignal());
      try {
        output = await bridge([isAsync ? 'eval-async' : 'eval', spec.expression], Math.max(1, deadline - Date.now()));
      } catch (error) {
        assertRecipeActive(recipeExecutionSignal());
        if (!node.poll) throw error;
        output = { error: error.message };
        if (Date.now() >= deadline) break;
        await pause();
        continue;
      }
      if (node.fail_when && checkAssert(output, node.fail_when)) throw new Error(`Probe failed early: ${JSON.stringify(output)}`);
      if (checkAssert(output, node.assert ?? spec.assert)) return output;
      if (!node.poll) break;
      await pause();
    } while (Date.now() < deadline);
    throw new Error(`Probe assertion failed: ${JSON.stringify(output)}`);
    async function pause() {
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(node.poll_ms ?? 200, remaining)));
    }
  }
  const custom = (action, execute, capabilities = []) => ({ action, source, capabilities, execute });
  const transport = createBridgeTransport({ appRoot, device, platform, updateBaselines });
  return [
    ...createStandardCoreAdapters({ actions }),
    ...createStandardUiAdapters({ actions, transport }),
    custom('audiolab.query', async node => ({ output: await query(node) }), ['arbitrary-code', 'app-mutation']),
    custom('audiolab.choose', async (node, context) => {
      const last = [...context.outputs.values()].at(-1);
      const state = { last, env: { platform, device } };
      const index = node.rules.findIndex(rule => checkAssert(state, rule));
      return { ...(index < 0 ? {} : { case: `case-${index}` }), output: last };
    }),
    custom('audiolab.logs', async (node, context) => {
      const recent = await readRecentMetroLog(appRoot);
      const forbidden = (node.must_not_appear ?? []).filter(text => recent.toLowerCase().includes(text.toLowerCase()));
      const file = `logs/${nodeFile(context.nodeId)}.log`;
      const destination = context.resolveArtifactPath(file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, recent);
      context.registerArtifact({ path: file, type: 'log', nodeId: context.nodeId });
      if (forbidden.length) throw new Error(`Forbidden log messages: ${forbidden.join(', ')}`);
      return { output: { matches: (node.watch_for ?? []).map(text => ({ text, count: recent.toLowerCase().split(text.toLowerCase()).length - 1 })) } };
    }, ['host-read-export']),
    custom('audiolab.native_preview', async node => {
      if (platform === 'web') throw new Error('Native preview requires iOS or Android.');
      const started = await bridge(['eval', `(() => {
        const bridge = globalThis.__AGENTIC__;
        if (typeof bridge?.testExtractPreview !== 'function' || typeof bridge?.getLastResult !== 'function') throw new Error('Native preview bridge is unavailable');
        return { previous: bridge.getLastResult(), started: bridge.testExtractPreview() };
      })()`]);
      const output = await query({ expression: `JSON.stringify(globalThis.__AGENTIC__.getLastResult())`, poll: true,
        timeout_ms: node.timeout_ms ?? 30000,
        fail_when: { field: 'status', operator: 'eq', value: 'error' },
        assert: { all: [{ field: 'status', operator: 'eq', value: 'success' }, { field: 'op', operator: 'eq', value: 'extractPreview' }] } });
      if (JSON.stringify(output) === JSON.stringify(started.previous) && started.started?.status !== 'pending') throw new Error('Native preview returned a stale result.');
      if (!checkAssert(output, node.assert)) throw new Error('Native preview assertion failed.');
      return { output };
    }, ['app-mutation']),
  ];
}

function requireSuccess(result) {
  if (result?.ok === false || result?.supported === false) throw new Error(JSON.stringify(result));
  return result;
}

export function createBridgeTransport({ appRoot, device, platform, updateBaselines = false }) {
  const bridge = createBridge({ appRoot, device, platform });
  return {
    async execute(action, node, context) {
      switch (action) {
        case 'app.status': {
          const output = await bridge(['get-route']);
          if (!output?.pathname) throw new Error('The selected app bridge has no observed route.');
          return output;
        }
        case 'app.hud': {
          const command = { command: 'hud', nodeId: context.nodeId, payload: node };
          return requireSuccess(await bridge(['eval-async', `(() => {
            const bridge = globalThis.__FARMSLOT_RECIPE_BRIDGE__;
            if (typeof bridge?.handleCommand !== 'function') throw new Error('Farmslot HUD bridge is unavailable');
            return bridge.handleCommand(${JSON.stringify(command)});
          })()`]));
        }
        case 'ui.navigate': return requireSuccess(await bridge(['navigate', node.path]));
        case 'ui.press': return requireSuccess(await bridge(['press-test-id', node.test_id, ...('value' in node ? ['--value', node.value] : [])]));
        case 'ui.set_input': return requireSuccess(await bridge(['set-input', node.test_id, node.value ?? '']));
        case 'ui.scroll': return requireSuccess(await bridge(['scroll-view', '--test-id', node.test_id, '--offset', node.offset_y, '--no-animated']));
        case 'ui.screenshot': {
          const shot = await bridge(['screenshot', nodeFile(context.nodeId)]);
          if (!shot?.screenshot) throw new Error('The selected target did not produce a screenshot.');
          const relative = node.path ?? `screenshots/${nodeFile(context.nodeId)}.png`;
          const destination = context.resolveArtifactPath(relative);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(shot.screenshot, destination);
          const artifacts = [{ path: relative, type: 'screenshot', mimeType: 'image/png', nodeId: context.nodeId, label: node.label ?? context.nodeId }];
          if (node.baseline) {
            const baseline = context.resolveProjectPath(node.baseline);
            if (updateBaselines || node.update_baseline) {
              await fs.mkdir(path.dirname(baseline), { recursive: true });
              await fs.copyFile(destination, baseline);
            } else {
              context.registerArtifact(artifacts[0]);
              await fs.access(baseline).catch(error => {
                if (error.code === 'ENOENT') throw new Error(`Screenshot baseline not found: ${baseline}. Re-run with --update-baselines.`);
                throw error;
              });
              const diff = context.resolveArtifactPath(`screenshots/${nodeFile(context.nodeId)}.diff.png`);
              const comparison = comparePngFiles({ actualPath: destination, baselinePath: baseline, diffPath: diff,
                maxDiffPixels: node.max_diff_pixels ?? 0, maxDiffRatio: node.max_diff_ratio ?? 0, pixelThreshold: node.pixel_threshold ?? 16 });
              if (comparison.diffPath) context.registerArtifact({ path: path.relative(context.artifactsDir, comparison.diffPath), type: 'screenshot', mimeType: 'image/png', nodeId: context.nodeId });
              if (!comparison.pass) throw new Error(`Visual baseline differs: ${JSON.stringify(comparison)}`);
              return { kind: 'ui-transport-result', output: comparison };
            }
          }
          return { kind: 'ui-transport-result', output: { captured: true, path: relative }, control: { artifacts } };
        }
        default: throw new Error(`Unsupported UI action: ${action}`);
      }
    },
  };
}
