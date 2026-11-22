import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { validateRuntimeProof, validateRuntimeProofPlan } from '@farmslot/recipe-cli/harness';
import { validateRecipeCliInput } from '@farmslot/recipe-runner/cli/support';
import { createAudiolabHost, manifest } from './host.mjs';

// Exercise the authored graph and real artifact writer; the bridge is a disposable contract fixture.
test('navigation capture is bound to observed route proof and authored restoration', async t => {
  const recipe = JSON.parse(await fs.readFile(new URL('./recipes/playground/smoke.navigation.recipe.json', import.meta.url), 'utf8'));
  const ref = 'playground.flows.navigation-proof';
  const flow = JSON.parse(await fs.readFile(new URL('./recipes/playground/flows/navigation-proof.recipe.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateRuntimeProofPlan(recipe, new Map([[ref, flow]]), 'restored', 'navigation'), []);
  const screenshotOnly = structuredClone(flow);
  screenshotOnly.workflow.nodes['assert-more'] = { action: 'log', next: 'proof' };
  assert.ok(validateRuntimeProofPlan(recipe, new Map([[ref, screenshotOnly]]), 'restored', 'navigation')
    .some(finding => finding.code === 'proof.no_runtime_assertion' && finding.path === 'proofTargets[1]'));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-smoke-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'apps/playground');
  const scripts = path.join(appRoot, 'scripts/agentic');
  await fs.mkdir(scripts, { recursive: true });
  const route = path.join(appRoot, 'route.json');
  await fs.writeFile(route, JSON.stringify({ pathname: '/record' }));
  const image = path.join(root, 'fixture.png');
  await fs.writeFile(image, PNG.sync.write(new PNG({ width: 2, height: 2 })));
  await fs.writeFile(path.join(scripts, 'cdp-bridge.mjs'), `
    import fs from 'node:fs';
    const args = process.argv.slice(2);
    const command = args[2];
    const route = ${JSON.stringify(route)};
    let output;
    if (command === 'get-route') output = JSON.parse(fs.readFileSync(route, 'utf8'));
    else if (command === 'navigate') {
      fs.writeFileSync(route, JSON.stringify({ pathname: '/' + args[3].split('/').filter(Boolean).at(-1) }));
      output = { ok: true };
    } else if (command === 'screenshot') output = { screenshot: ${JSON.stringify(image)} };
    else throw new Error('Unsupported fixture operation: ' + command);
    console.log(JSON.stringify(output));
  `);
  const actionManifest = path.join(root, 'action-manifest.json');
  await fs.writeFile(actionManifest, JSON.stringify(manifest));
  const host = createAudiolabHost({ app: 'playground', platform: 'web', device: 'web', projectRoot: root, noHud: true });
  async function execute(document, name) {
    const artifactsDir = path.join(root, name);
    const result = await host.runner.run(host.request({ recipeDocument: document, artifactsDir }));
    assert.equal(result.status, 'pass', result.error);
    const read = async file => JSON.parse(await fs.readFile(path.join(artifactsDir, file), 'utf8'));
    const index = await read('artifact-manifest.json');
    const resolution = await read('recipe-resolution.json');
    const resolvedRecipes = Object.fromEntries(await Promise.all(resolution.dependencies.map(async dependency =>
      [dependency.digest, await read(dependency.artifact)])));
    const bundle = { recipe: await read('recipe.json'), summary: await read('summary.json'), trace: await read('trace.json'),
      manifest: index, recipeResolution: resolution, resolvedRecipes,
      artifactPaths: ['recipe.json', 'summary.json', 'trace.json', 'artifact-manifest.json', 'recipe-resolution.json',
        ...index.artifacts.map(artifact => artifact.path)],
    };
    const checked = await validateRecipeCliInput({ recipePath: path.join(artifactsDir, 'recipe.json'),
      actionManifestPath: actionManifest, artifactDir: artifactsDir });
    assert.equal(checked.status, 'valid', JSON.stringify(checked.findings));
    const claims = await read('acceptance-status.json');
    assert.deepEqual(Object.fromEntries(claims.criteria.map(claim => [claim.id, claim.verdict])),
      { runtime: 'proven', navigation: 'proven', restored: 'proven' });
    assert.deepEqual(JSON.parse(await fs.readFile(route, 'utf8')), { pathname: '/record' });
    return bundle;
  }
  const unbound = structuredClone(recipe);
  delete unbound.workflow.nodes['navigation-proof'].proves;
  const prior = await execute(unbound, 'unbound');
  assert.throws(() => validateRuntimeProof(prior, 'navigation', 'restored', { captureRequired: true }), /no capture tied to its named proof/);
  const candidate = await execute(recipe, 'bound');
  assert.deepEqual(validateRuntimeProof(candidate, 'navigation', 'restored', { captureRequired: true }),
    ['screenshots/audiolab-navigation-v1.png']);
});
