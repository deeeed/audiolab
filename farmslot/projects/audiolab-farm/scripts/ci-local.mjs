#!/usr/bin/env node
// Mirror the required JS checks in scripts/check.sh for changed product scope.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The prepared wrapper selects this node toolchain; avoid an ambient PATH lookup.
const yarnBin = path.join(process.env.AUDIOLAB_NODE_BIN || path.dirname(process.execPath), 'yarn');
const isSource = (file) => /\.[cm]?[jt]sx?$/.test(file);

function run(args) {
  console.log(`ci-parity: yarn ${args.join(' ')}`);
  const result = spawnSync(yarnBin, args, { env: { ...process.env, EXPO_NONINTERACTIVE: '1' }, stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.error || result.status !== 0) throw Object.assign(new Error(`yarn ${args[0]} failed: ${result.error?.message || result.status || result.signal}`), { exitCode: result.status || 1 });
}

try {
  const git = (args) => execFileSync('/usr/bin/git', args, { encoding: 'utf8' });
  const base = git(['merge-base', 'origin/main', 'HEAD']).trim();
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const files = [...new Set([...git(['diff', '--name-only', '-z', base]).split('\0'), ...untracked].filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const inventory = [...git(['diff', '--name-only', '--diff-filter=ADR', '-z', base]).split('\0'), ...untracked];
  const live = files.filter((file) => existsSync(file));
  const source = new Set(live.filter(isSource));
  const workspaces = ['packages/audio-studio', 'packages/moonshine.rn', 'packages/sherpa-onnx.rn'];
  let typed = false;
  for (const directory of workspaces) {
    const changed = files.filter((file) => file.startsWith(directory + '/'));
    if (!changed.length) continue;
    const manifest = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
    const workspaceSource = changed.filter((file) => source.has(file) && !file.startsWith('packages/audio-studio/plugin/'));
    if (changed.some((file) => isSource(file) || /(?:tsconfig.*\.json|package\.json)$/.test(file))) {
      run(['workspace', manifest.name, 'typecheck', '--incremental', 'false']);
      typed = true;
    }
    if (directory === 'packages/audio-studio' && workspaceSource.length) {
      // Use the workspace ESLint config on changed files, retaining CI's warning ceiling.
      run(['workspace', manifest.name, 'exec', 'eslint', ...workspaceSource.map((file) => path.relative(directory, file)), '--max-warnings=18']);
    }
    if (manifest.scripts?.test && workspaceSource.length) {
      run(['workspace', manifest.name, 'test', '--findRelatedTests', ...workspaceSource.map((file) => path.resolve(file)), '--runInBand', '--coverage=false', '--passWithNoTests']);
    }
  }
  // App source consumes the primary library; docs-only branches need no compiler.
  if (!typed && files.some((file) => file.startsWith('apps/playground/') && isSource(file))) run(['workspace', '@siteed/audio-studio', 'typecheck', '--incremental', 'false']);
  const pluginFiles = files.filter((file) => file.startsWith('packages/audio-studio/plugin/'));
  if (pluginFiles.length) {
    run(['exec', 'tsc', '--noEmit', '--incremental', 'false', '-p', 'packages/audio-studio/plugin/tsconfig.json']);
    const plugin = pluginFiles.filter((file) => source.has(file));
    if (plugin.length) {
      run(['workspace', '@siteed/audio-studio', 'exec', 'eslint', ...plugin.map((file) => path.relative('packages/audio-studio', file)), '--max-warnings=0']);
      run(['workspace', '@siteed/audio-studio', 'test', '--findRelatedTests', ...plugin.map((file) => path.resolve(file)), '--runInBand', '--coverage=false', '--passWithNoTests']);
    }
  }
  const appFiles = files.filter((file) => file.startsWith('apps/playground/'));
  if (appFiles.length) {
    // The required CI job runs these config tests; typed lint excludes config/.
    run(['workspace', 'audio-playground', 'test:config']);
  }
  if (files.some((file) => /(^|\/)package\.json$|^yarn\.lock$|^\.yarnrc\.yml$/.test(file))) run(['check:deps']);
  if (inventory.some((file) => file.startsWith('packages/')) || files.some((file) => /^(\.package-manifests\/|packages\/[^/]+\/(package\.json|[^/]+\.podspec)|scripts\/package-manifest\.sh)/.test(file))) {
    const result = spawnSync('/bin/bash', ['scripts/package-manifest.sh'], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (result.status !== 0) throw new Error('Published package contents check failed');
  }
  const recipeChanged = files.some((file) => file.startsWith('scripts/agentic/recipe/'));
  if (recipeChanged) {
    const result = spawnSync(process.execPath, ['scripts/agentic/recipe/validate-all.mjs'], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (result.status !== 0) throw new Error('Recipe protocol check failed');
    const tests = readdirSync('scripts/agentic/recipe').filter((name) => name.endsWith('.test.mjs')).map((name) => 'scripts/agentic/recipe/' + name);
    if (existsSync('scripts/agentic/cdp-bridge.origin.test.mjs')) tests.push('scripts/agentic/cdp-bridge.origin.test.mjs');
    if (tests.length) {
      const unit = spawnSync(process.execPath, ['--test', ...tests], { stdio: ['ignore', 'inherit', 'inherit'] });
      if (unit.status !== 0) throw new Error('Recipe adapter tests failed');
    }
  }
  console.log('ci-parity: PASS; native builds, device matrices and full-suite coverage remain in CI');
} catch (error) {
  console.error(`ci-parity: ${error.message}`);
  process.exitCode = error.exitCode || 1;
}
