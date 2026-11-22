import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'audiolab-ci-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  for (const name of ['audio-studio', 'moonshine.rn', 'sherpa-onnx.rn']) {
    const directory = path.join(repo, 'packages', name);
    mkdirSync(path.join(directory, 'src'), { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@siteed/${name}`, scripts: { typecheck: 'tsc --noEmit', lint: 'eslint src', test: 'jest' } }));
    writeFileSync(path.join(directory, 'src/index.ts'), 'export const value = 1;\n');
  }
  const recipes = path.join(repo, 'scripts/agentic/recipe');
  mkdirSync(recipes, { recursive: true });
  writeFileSync(path.join(repo, 'scripts/package-manifest.sh'), '#!/bin/sh\necho "package manifest checked"\n');
  mkdirSync(path.join(repo, 'packages/audio-studio/plugin/src'), { recursive: true });
  writeFileSync(path.join(repo, 'packages/audio-studio/plugin/src/index.ts'), 'export const value = 1;\n');
  mkdirSync(path.join(repo, 'apps/playground/config'), { recursive: true });
  writeFileSync(path.join(repo, 'apps/playground/config/validate-env.test.ts'), 'export const value = 1;\n');
  writeFileSync(path.join(recipes, 'validate-all.mjs'), 'console.log("recipe protocol checked");\n');
  writeFileSync(path.join(recipes, 'adapters.mjs'), 'export const value = 1;\n');
  writeFileSync(path.join(recipes, 'adapters.test.mjs'), 'import assert from "node:assert/strict"; import { value } from "./adapters.mjs"; assert.equal(value,1);\n');
  const log = path.join(root, 'calls.jsonl');
  writeFileSync(path.join(bin, 'yarn'), `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(process.env.AUDIO_CI_TEST_LOG,JSON.stringify(args)+'\\n');
process.exit(args.includes('test')&&process.env.AUDIO_CI_TEST_UNIT_FAIL?7:0);
`, { mode: 0o755 });
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--no-gpg-sign', '-qm', 'Initial']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const run = (extra = {}) => {
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, AUDIOLAB_NODE_BIN: bin, AUDIO_CI_TEST_LOG: log, ...extra };
    // This fixture launches the standalone worker command, outside node:test.
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [path.join(scriptDir, 'ci-local.mjs')], { cwd: repo, env, encoding: 'utf8' });
  };
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
  return { root, repo, bin, log, run, calls };
}

test('a library source change runs its CI types, changed-file lint and related tests only', (t) => {
  const { repo, run, calls } = fixture(t);
  const file = 'packages/audio-studio/src/space name.ts';
  writeFileSync(path.join(repo, file), 'export {};\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const commands = calls();
  assert.equal(commands.length, 3);
  assert.deepEqual(commands[0], ['workspace', '@siteed/audio-studio', 'typecheck', '--incremental', 'false']);
  assert.ok(commands[1].includes('src/space name.ts'));
  assert.ok(commands[2].includes('--findRelatedTests'));
  assert.ok(commands[2].includes(path.join(realpathSync(repo), file)));
  assert.ok(commands.every((args) => !args.includes('@siteed/moonshine.rn')));
  assert.match(result.stdout, /package manifest checked/);
});

test('a related-unit failure refuses the parity check with its exit code', (t) => {
  const { repo, run } = fixture(t);
  writeFileSync(path.join(repo, 'packages/moonshine.rn/src/index.ts'), 'export const value = 2;\n');
  assert.equal(run({ AUDIO_CI_TEST_UNIT_FAIL: '1' }).status, 7);
});

test('recipe implementation changes execute unchanged adapter tests', (t) => {
  const { repo, run } = fixture(t);
  writeFileSync(path.join(repo, 'scripts/agentic/recipe/adapters.mjs'), 'export const value = 2;\n');
  const result = run();
  assert.notEqual(result.status, 0, result.stdout + '\n' + result.stderr);
  assert.match(result.stderr, /Recipe adapter tests failed/);
});

test('deleting library source still selects its typecheck and package inventory', (t) => {
  const { repo, run, calls } = fixture(t);
  rmSync(path.join(repo, 'packages/moonshine.rn/src/index.ts'));
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), [['workspace', '@siteed/moonshine.rn', 'typecheck', '--incremental', 'false']]);
  assert.match(result.stdout, /package manifest checked/);
});

test('plugin changes select plugin types, strict lint and related plugin unit tests', (t) => {
  const { repo, run, calls } = fixture(t);
  const file = 'packages/audio-studio/plugin/src/index.ts';
  writeFileSync(path.join(repo, file), 'export const value = 2;\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const commands = calls();
  assert.ok(commands.some((args) => args.includes('packages/audio-studio/plugin/tsconfig.json')));
  assert.ok(commands.some((args) => args.includes('--max-warnings=0')));
  assert.ok(commands.some((args) => args.includes('--findRelatedTests') && args.includes(path.join(realpathSync(repo), file))));
});

test('app config-test edits use the actual CI config tests without unsupported typed lint', (t) => {
  const { repo, run, calls } = fixture(t);
  writeFileSync(path.join(repo, 'apps/playground/config/validate-env.test.ts'), 'export const value = 2;\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), [['workspace', '@siteed/audio-studio', 'typecheck', '--incremental', 'false'], ['workspace', 'audio-playground', 'test:config']]);
});

test('native additions run the package manifest guard', (t) => {
  const { repo, run } = fixture(t);
  mkdirSync(path.join(repo, 'packages/audio-studio/ios'), { recursive: true });
  writeFileSync(path.join(repo, 'packages/audio-studio/ios/NewHeader.h'), '// Header\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /package manifest checked/);
});

test('checked-in package inventory edits run the manifest guard', (t) => {
  const { repo, run } = fixture(t);
  mkdirSync(path.join(repo, '.package-manifests'));
  writeFileSync(path.join(repo, '.package-manifests/studio.txt'), 'src/index.ts\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /package manifest checked/);
});

test('each PR-producing catalog entry uses the shared step and the portable prepared command', () => {
  const project = path.dirname(scriptDir);
  const config = JSON.parse(readFileSync(path.join(project, 'project.json'), 'utf8'));
  assert.equal(config.ci.local_check, 'bash apps/playground/.agent/ci-parity');
  assert.equal(Object.hasOwn(config.vars, 'mark_cmd'), false, 'Use the connected-node SDK mark helper default.');
  for (const flow of ['dev', 'fix-bug', 'pr-complete', 'update-branch']) {
    const text = readFileSync(path.join(project, 'checklists', flow, 'default.md'), 'utf8');
    assert.equal((text.match(/\[DETERMINISTIC: ci\.local_check\]/g) || []).length, 1, flow);
    assert.doesNotMatch(text, /CI_PARITY_STEP/);
  }
});

test('the prepared CI shell uses configured farm and Node paths with spaces', t => {
  const { root, repo, bin, log, calls } = fixture(t);
  const farm = path.join(root, 'configured farm');
  const scripts = path.join(farm, 'projects/audiolab-farm/scripts');
  mkdirSync(scripts, { recursive: true });
  for (const file of ['ci-local.mjs', 'configured-paths.sh']) copyFileSync(path.join(scriptDir, file), path.join(scripts, file));
  const tools = path.join(root, 'configured node');
  mkdirSync(tools);
  symlinkSync(process.execPath, path.join(tools, 'node'));
  copyFileSync(path.join(bin, 'yarn'), path.join(tools, 'yarn'));
  writeFileSync(path.join(repo, '.git/info/exclude'), 'apps/playground/.agent/\n');
  const wrapper = path.join(repo, 'apps/playground/.agent/ci-parity');
  mkdirSync(path.dirname(wrapper), { recursive: true });
  copyFileSync(path.join(scriptDir, '../fixtures/ci-parity'), wrapper);
  const env = { ...process.env, AUDIOLAB_FARM_ROOT: farm, AUDIOLAB_NODE_BIN: tools, AUDIO_CI_TEST_LOG: log, IOS_DEVICE_UDID: '' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FARMSLOT_ROOT;
  const result = spawnSync('/bin/bash', [wrapper], { cwd: repo, env, encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(), []);
  for (const configured of [undefined, '']) {
    const missing = { ...env };
    if (configured === undefined) delete missing.AUDIOLAB_FARM_ROOT;
    else missing.AUDIOLAB_FARM_ROOT = configured;
    const refused = spawnSync('/bin/bash', [wrapper], { cwd: repo, env: missing, encoding: 'utf8', timeout: 1000 });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Set AUDIOLAB_FARM_ROOT in pool.env to the Audiolab pack installation root/);
  }
  assert.equal(calls().length, 0, 'Missing root configuration ran a CI command.');
});
