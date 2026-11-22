import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './host.mjs';

const execute = promisify(execFile);
const renderHook = (template, variables) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!Object.hasOwn(variables, key)) throw new Error(`Unbound hook variable: ${key}`);
  return variables[key];
});
const cli = fileURLToPath(new URL('./run.mjs', import.meta.url));

test('public manifest command returns the gateway action contract', async () => {
  const { stdout } = await execute(process.execPath, [cli, 'manifest']);
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.$schema, 'https://farmslot.io/schemas/action-manifest-v1.schema.json');
  assert.ok(manifest.actions['app.hud']);
  assert.ok(manifest.actions['audiolab.native_preview']);
});

test('relative Sherpa recipe paths resolve and select the right app', async () => {
  const { stdout } = await execute(process.execPath, [cli, 'validate', 'scripts/agentic/recipe/recipes/sherpa/asr-ui-validate-qwen3.recipe.json', '--platform', 'ios'], { cwd: repoRoot });
  assert.equal(JSON.parse(stdout).status, 'pass');
  assert.equal(JSON.parse(stdout).app, 'sherpa-voice');
});

test('recipe doctor checks the selected checkout and installed bridge wiring', async t => {
  for (const app of ['playground', 'sherpa-voice']) {
    const { stdout } = await execute(process.execPath, [cli, 'doctor', '--app', app, '--project-root', repoRoot], { cwd: repoRoot });
    const result = JSON.parse(stdout);
    assert.equal(result.status, 'pass');
    assert.ok(result.checks.some(check => check.id === 'bridge-provider' && check.status === 'pass'));
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-doctor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const target of [path.join(root, 'missing'), root]) {
    if (target === root) await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'incomplete' }));
    await assert.rejects(execute(process.execPath, [cli, 'doctor', '--project-root', target], { cwd: repoRoot }), error => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.status, 'fail');
      assert.ok(result.checks.some(check => check.id === 'bridge-provider' && check.status === 'fail'));
      assert.equal(result.checks.find(check => check.id === 'checkout').status, target === root ? 'pass' : 'fail');
      return true;
    });
  }
});

test('farm bootstrap permits public installs without a token and preserves a supplied token', async () => {
  const script = path.join(repoRoot, 'farmslot/projects/audiolab-farm/scripts/env.sh');
  for (const token of [undefined, 'fixture']) {
    const env = { ...process.env, AUDIOLAB_NODE_BIN: path.dirname(process.execPath), EAS_PROJECT_ID: 'fixture', APPLE_TEAM_ID: 'fixture' };
    if (token === undefined) delete env.AUDIOLAB_NPM_TOKEN;
    else env.AUDIOLAB_NPM_TOKEN = token;
    const { stdout } = await execute('bash', ['-c',
      'launchctl() { :; }; tmux() { :; }; source "$1"; printf "%s|%s" "${AUDIOLAB_NPM_TOKEN+x}" "$AUDIOLAB_NPM_TOKEN"',
      'bash', script], { env });
    assert.equal(stdout, `x|${token ?? ''}`);
  }
});

test('farm hooks preserve quoted paths across support roots and service PATHs', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-hook-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runnerDir = path.join(root, 'scripts/agentic/recipe');
  await fs.mkdir(runnerDir, { recursive: true });
  await fs.writeFile(path.join(runnerDir, 'run.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  const recipe = path.join(root, 'input recipe.json');
  const artifacts = path.join(root, 'proof artifacts');
  const support = path.join(root, 'support space');
  await fs.symlink(path.join(repoRoot, 'farmslot'), support);
  const configDir = path.join(root, 'scripts/agentic/lib');
  await fs.mkdir(configDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, 'scripts/agentic/lib/run-farm-hook.sh'), path.join(configDir, 'run-farm-hook.sh'));
  const project = JSON.parse(await fs.readFile(path.join(repoRoot, 'farmslot/projects/audiolab-farm/project.json'), 'utf8'));
  const variables = { farmslot_dir: path.join(repoRoot, 'farmslot'), repo: root, metro_port: '7466', cdp_port: '7676', platform: 'web', simulator: '', adb_serial: '', recipe_path: `'${recipe}'`, artifacts_dir: `'${artifacts}'`, ios_device_udid: '', ios_inspector_id: '' };
  for (const farmslotRoot of [variables.farmslot_dir, support, `~/${path.relative(os.homedir(), support)}`]) {
    const scoped = { ...variables, farmslot_dir: farmslotRoot };
    const command = renderHook(project.hooks.recipe_run, scoped);
    for (const shellPath of [process.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin']) {
      const { stdout } = await execute('bash', ['-c', command], { env: { ...process.env, PATH: shellPath, AUDIOLAB_NODE_BIN: path.dirname(process.execPath), AUDIOLAB_NPM_TOKEN: 'fixture', EAS_PROJECT_ID: 'fixture', APPLE_TEAM_ID: 'fixture' } });
      const args = JSON.parse(stdout);
      assert.equal(args[1], recipe);
      assert.equal(args[args.indexOf('--artifacts-dir') + 1], artifacts);
      assert.equal(args[args.indexOf('--platform') + 1], 'web');
    }
  }
});

test('prerequisites preserve deployed paths before checkout and physical hooks fail early', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-prerequisite-hook-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const support = path.join(root, 'support space');
  await fs.symlink(path.join(repoRoot, 'farmslot'), support);
  const project = JSON.parse(await fs.readFile(path.join(repoRoot, 'farmslot/projects/audiolab-farm/project.json'), 'utf8'));
  const env = { ...process.env, AUDIOLAB_NODE_BIN: path.dirname(process.execPath), AUDIOLAB_PYTHON_BIN: '',
    IOS_DEVICE_UDID: '', FARMSLOT_MACHINE: 'fixture-node' };
  // Framework #924 resolves remote home-relative roots before rendering hooks.
  const variables = { farmslot_dir: support, ios_device_udid: '' };
  const hook = renderHook(project.hooks.prerequisites, variables);
  await execute('bash', ['-c', hook], { env, cwd: root });
  const udid = '00008101-001348AC1490801E';
  for (const [script, args] of [
    ['runtime.sh', ['launch', root, '7465', '7675', 'ios', '', '', '', udid]],
    ['recipe-hook.sh', ['run', root, 'ios', '', '', 'playground.smoke.navigation', root, udid]],
  ]) {
    await assert.rejects(execute('bash', [path.join(repoRoot, 'farmslot/projects/audiolab-farm/scripts', script), ...args], { env }),
      error => /missing Python3.12 on fixture-node, set AUDIOLAB_PYTHON_BIN/.test(error.stderr));
  }
  assert.equal(await fs.access(path.join(root, '.agent')).then(() => true, () => false), false);
});

test('web preflight launches Metro and a headless browser', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-web-hook-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'apps/playground/scripts/agentic');
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(path.join(scripts, 'start-metro.sh'), 'echo metro-started\n');
  await fs.writeFile(path.join(scripts, 'preflight.sh'), 'echo native-called\n');
  await fs.writeFile(path.join(scripts, 'web-browser.mjs'), 'console.log(JSON.stringify({ stage: "browser", headless: process.env.WEB_HEADLESS, channel: process.env.WEB_BROWSER_CHANNEL, port: process.env.METRO_PORT }))');
  const configDir = path.join(root, 'scripts/agentic/lib');
  await fs.mkdir(configDir, { recursive: true });
  await fs.copyFile(path.join(repoRoot, 'scripts/agentic/lib/runtime-config.cjs'), path.join(configDir, 'runtime-config.cjs'));
  const { stdout } = await execute('bash', [path.join(repoRoot, 'farmslot/projects/audiolab-farm/scripts/runtime.sh'), 'launch', root, '7466', '7676', 'web'], { env: { ...process.env, AUDIOLAB_NODE_BIN: path.dirname(process.execPath), AUDIOLAB_NPM_TOKEN: 'fixture', EAS_PROJECT_ID: 'fixture', APPLE_TEAM_ID: 'fixture' } });
  assert.equal(stdout.split('\n')[0], 'metro-started');
  assert.deepEqual(JSON.parse(stdout.split('\n')[1]), { stage: 'browser', headless: 'true', channel: 'chrome', port: '7466' });
  assert.ok(!stdout.includes('native-called'));
});

test('file recipes cannot read outside the selected project root', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-outside-recipe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'outside.recipe.json');
  await fs.writeFile(file, JSON.stringify({ $schema: 'https://farmslot.io/schemas/recipe-v1.schema.json', workflow: { entry: 'done', nodes: { done: { action: 'end', status: 'pass' } } } }));
  await assert.rejects(execute(process.execPath, [cli, 'validate', file], { cwd: repoRoot }), /outside|escape|within|relative/i);
});

test('single-step execution does not replay earlier side effects', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-single-step-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'apps/playground'), { recursive: true });
  const recipe = path.join(root, 'recipe.json');
  const artifacts = path.join(root, 'artifacts');
  await fs.writeFile(recipe, JSON.stringify({
    $schema: 'https://farmslot.io/schemas/recipe-v1.schema.json',
    title: 'Observe without starting a recording',
    workflow: { entry: 'start', nodes: {
      start: { action: 'command', cmd: 'touch recording-started', intent: 'Start a recording.', next: 'observe' },
      observe: { action: 'command', cmd: 'printf observed', intent: 'Observe the existing state.', next: 'done' },
      done: { action: 'end', status: 'pass' },
    } },
  }));
  await execute(process.execPath, [cli, 'run', recipe, '--step', 'observe', '--no-hud', '--platform', 'web', '--device', 'web', '--project-root', root, '--artifacts-dir', artifacts], { cwd: root });
  assert.equal(await fs.access(path.join(root, 'recording-started')).then(() => true, () => false), false);
  const trace = JSON.parse(await fs.readFile(path.join(artifacts, 'trace.json'), 'utf8'));
  assert.deepEqual(trace.entries.filter(entry => entry.action === 'command').map(entry => entry.nodeId), ['observe']);
  assert.equal(JSON.parse(await fs.readFile(path.join(artifacts, 'summary.json'), 'utf8')).stopAfterNode, 'observe');
});

test('browser launch waits for its child bridge and cleans up failed startup', async t => {
  for (const scenario of ['app', 'timeout', 'stuck', 'kernel']) {
    const fail = scenario === 'timeout' || scenario === 'stuck';
    const kernel = scenario === 'kernel';
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-browser-ready-'));
    const mock = path.join(root, 'node_modules/playwright');
    await fs.mkdir(mock, { recursive: true });
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await fs.writeFile(path.join(mock, 'index.js'), `
      const fs = require('node:fs');
      exports.chromium = { launch: async () => {
        fs.writeFileSync('child-pid', String(process.pid));
        const live = setInterval(() => {}, 50);
        const page = {
          on() {}, goto: async () => {}, addInitScript: async () => {},
          evaluate: async () => ({ width: 1280, height: 720 }),
          waitForFunction: async () => {
            fs.writeFileSync('waiting', 'yes');
            while (!fs.existsSync('ready')) {
              if (fs.existsSync('closed')) throw new Error('closed');
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          },
        };
        return {
          newBrowserCDPSession: async () => ({ send: async () => ({ processInfo: [{ type: 'browser', id: process.pid }] }), detach: async () => {} }),
          newContext: async () => ({ grantPermissions: async () => {}, newPage: async () => page,
            newCDPSession: async () => ({ send: async () => ({ windowId: 1, bounds: { width: 1280, height: 720 } }), detach: async () => {} }) }),
          close: async () => {
            fs.writeFileSync('closed', 'yes');
            if (process.env.MOCK_HANG_CLOSE === '1') await new Promise(() => {});
            clearInterval(live);
          },
        };
      } };
    `);
    const result = execute(process.execPath, [path.join(repoRoot, 'scripts/agentic/web-browser.mjs'), 'launch', kernel ? '--wait-browser' : '--wait'], {
      cwd: root, env: { ...process.env, APP_ROOT: root, WEB_BROWSER_PID_FILE: path.join(root, '.agent/browser.pid'), WEB_TIMEOUT: '2000', WEB_STARTUP_TIMEOUT: fail ? '400' : '2000', MOCK_HANG_CLOSE: scenario === 'stuck' ? '1' : '', WEB_HEADLESS: 'true' },
    });
    let settled = false;
    result.then(() => { settled = true; }, () => { settled = true; });
    t.after(async () => {
      result.child.kill('SIGTERM');
      const pid = Number(await fs.readFile(path.join(root, 'child-pid'), 'utf8').catch(() => 0));
      if (pid) {
        try { process.kill(pid, 'SIGTERM'); } catch {}
        for (let attempt = 0; attempt < 100; attempt++) {
          try { process.kill(pid, 0); } catch { break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      await result.catch(() => {});
      await fs.rm(root, { recursive: true, force: true });
    });
    const deadline = Date.now() + 1500;
    while (!await fs.access(path.join(root, 'waiting')).then(() => true, () => false)) {
      assert.ok(Date.now() < deadline, 'child must reach its bridge wait');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (fail) {
      await fs.mkdir(path.join(root, '.agent'), { recursive: true });
      await fs.writeFile(path.join(root, '.agent/web-browser.json'), JSON.stringify({ pid: process.pid, browserPid: process.pid }));
      await fs.writeFile(path.join(root, '.agent/browser.pid'), String(process.pid));
      await assert.rejects(result, /Browser startup timed out/);
      assert.equal(await fs.readFile(path.join(root, 'closed'), 'utf8'), 'yes');
      assert.equal(JSON.parse(await fs.readFile(path.join(root, '.agent/web-browser.json'), 'utf8')).pid, process.pid);
      assert.equal(await fs.readFile(path.join(root, '.agent/browser.pid'), 'utf8'), String(process.pid));
    } else {
      if (kernel) await result;
      else assert.equal(settled, false, 'launch must wait for the child bridge');
      await fs.writeFile(path.join(root, 'ready'), 'yes');
      assert.match((await result).stdout, /Browser ready in background/);
      const readyDeadline = Date.now() + 1500;
      while (!await fs.access(path.join(root, '.agent/web-browser.json')).then(() => true, () => false)) {
        assert.ok(Date.now() < readyDeadline, 'daemon must survive the kernel acknowledgement');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      process.kill(Number(await fs.readFile(path.join(root, 'child-pid'), 'utf8')), 0);
      assert.equal(await fs.readFile(path.join(root, '.agent/browser.pid'), 'utf8'), await fs.readFile(path.join(root, 'child-pid'), 'utf8') + '\n');
    }
  }
});

test('file recipes resolve through a symlinked repo path', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-symlink-recipe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const alias = path.join(root, 'repo');
  await fs.symlink(repoRoot, alias, 'dir');
  const file = path.join(alias, 'scripts/agentic/recipe/recipes/playground/smoke.navigation.recipe.json');
  const { stdout } = await execute(process.execPath, [cli, 'validate', file], { cwd: repoRoot });
  assert.equal(JSON.parse(stdout).status, 'pass');
});


test('shell port resolution stays numeric under forced console colors', async () => {
  const script = path.join(repoRoot, 'scripts/agentic/lib/runtime-config.cjs');
  const { stdout } = await execute(process.execPath, [script, '7365'], {
    env: { ...process.env, FORCE_COLOR: '1', METRO_PORT: '7465' },
  });
  assert.equal(stdout, '7465\n');
});
