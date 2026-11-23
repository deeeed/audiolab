import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAudiolabHost } from './host.mjs';

// Run 1ad82ba1 (#526) proved Android and iOS, but completion refused the Android capture:
// publication accepts another attempt's evidence only when that attempt carries
// product-provenance.json, and Audiolab attempts (run.mjs drives the runner directly) had none.
test('an Audiolab recipe attempt records the product checkout provenance', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provenance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('checkout', '-q', '-b', 'feat/526');
  await fs.mkdir(path.join(root, 'apps/playground'), { recursive: true });
  await fs.writeFile(path.join(root, 'apps/playground/README.md'), 'fixture\n');
  await fs.writeFile(path.join(root, '.gitignore'), 'attempt*/\n');
  git('add', '.');
  git('-c', 'user.email=fixture@example.com', '-c', 'user.name=fixture', 'commit', '-qm', 'fixture');
  const host = createAudiolabHost({ app: 'playground', platform: 'web', device: 'web', projectRoot: root, noHud: true });
  const artifactsDir = path.join(root, 'attempt');
  const recipeDocument = { $schema: 'https://farmslot.io/schemas/recipe-v1.schema.json', description: 'Provenance fixture.',
    workflow: { entry: 'done', nodes: { done: { action: 'end', status: 'pass' } } } };
  const result = await host.runner.run(host.request({ recipeDocument, artifactsDir }));
  assert.equal(result.status, 'pass', result.error);
  const provenance = JSON.parse(await fs.readFile(path.join(artifactsDir, 'product-provenance.json'), 'utf8'));
  assert.deepEqual(
    { git_ref: provenance.git_ref, branch: provenance.branch, dirty: provenance.dirty },
    { git_ref: git('rev-parse', 'HEAD'), branch: 'feat/526', dirty: false },
  );
  const manifest = JSON.parse(await fs.readFile(path.join(artifactsDir, 'artifact-manifest.json'), 'utf8'));
  assert.ok(manifest.artifacts.some(entry => entry.path === 'product-provenance.json'), 'publication finds it through the manifest');

  // Dirty when the run started, clean at closeout: the capture is not clean-head evidence.
  await fs.writeFile(path.join(root, 'apps/playground/README.md'), 'edited\n');
  const dirtyRequest = host.request({ recipeDocument, artifactsDir: path.join(root, 'attempt-dirty') });
  git('checkout', '-q', '--', 'apps/playground/README.md');
  assert.equal((await host.runner.run(dirtyRequest)).status, 'pass');
  const recorded = JSON.parse(await fs.readFile(path.join(root, 'attempt-dirty/product-provenance.json'), 'utf8'));
  assert.equal(recorded.dirty, true);
});
