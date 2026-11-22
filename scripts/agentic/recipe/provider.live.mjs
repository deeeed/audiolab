import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopMetro } from '../lib/metro-process.mjs';

// Host process inspection belongs to the live tier, outside default/CI tests.
test('Metro stop refuses a foreign listener and stale PID but stops the owned server', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provider-metro-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const owner = path.join(root, 'owner');const foreign = path.join(root, 'foreign');
  for (const dir of [owner, foreign]) await fs.mkdir(path.join(dir, '.agent'), { recursive: true });
  const script = path.join(root, 'metro-fixture.mjs');
  await fs.writeFile(script, `import net from 'node:net';const s=net.createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`);
  const child = spawn(process.execPath, [script], { cwd: foreign, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill();await once(child, 'exit'); } });
  const port = Number((await once(child.stdout, 'data'))[0].toString().trim());
  await fs.writeFile(path.join(owner, '.agent/metro.pid'), String(child.pid));
  assert.throws(() => stopMetro(owner, port), /another checkout/);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  const exit = once(child, 'exit');
  assert.equal(stopMetro(foreign, port).signalled, 1);
  await exit;
});

// Run 1ad82ba1 (#526): the slot Metro was serving apps/sherpa-voice when a playground run's
// teardown stopped port 7464, and the "another checkout" refusal kept the slot occupied.
// Another app root in the same checkout is this checkout's Metro: stop it, and report the
// binding so a start for the selected app restarts it instead of reusing the wrong bundle.
async function twoAppCheckout(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-provider-metro-apps-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q', root]);
  const voice = path.join(root, 'apps/sherpa-voice');const playground = path.join(root, 'apps/playground');
  for (const dir of [voice, playground]) await fs.mkdir(path.join(dir, '.agent'), { recursive: true });
  const script = path.join(root, 'metro-fixture.mjs');
  await fs.writeFile(script, `import net from 'node:net';const s=net.createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`);
  const child = spawn(process.execPath, [script], { cwd: voice, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill();await once(child, 'exit'); } });
  const port = Number((await once(child.stdout, 'data'))[0].toString().trim());
  return { voice, playground, child, port };
}

test('Metro stop for one app root stops the Metro another app root of the same checkout started', async t => {
  const { playground, child, port } = await twoAppCheckout(t);
  const exit = once(child, 'exit');
  assert.equal(stopMetro(playground, port).signalled, 1);
  await exit;
});

test('Metro binding reports this app, another app of the checkout, or none', async t => {
  const { voice, playground, child, port } = await twoAppCheckout(t);
  const { metroBinding } = await import('../lib/metro-process.mjs');
  assert.equal(metroBinding(playground, port), 'other-app');
  assert.equal(metroBinding(voice, port), 'this-app');
  child.kill();await once(child, 'exit');
  assert.equal(metroBinding(playground, port), 'none');
});

test('a Metro in a separate repo nested under the app root stays foreign', async t => {
  const { playground } = await twoAppCheckout(t);
  const { execFileSync } = await import('node:child_process');
  const nested = path.join(playground, 'vendor/other');
  await fs.mkdir(nested, { recursive: true });
  execFileSync('git', ['init', '-q', nested]);
  const script = path.join(nested, 'metro-fixture.mjs');
  await fs.writeFile(script, `import net from 'node:net';const s=net.createServer();s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`);
  const child = spawn(process.execPath, [script], { cwd: nested, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill();await once(child, 'exit'); } });
  const port = Number((await once(child.stdout, 'data'))[0].toString().trim());
  assert.throws(() => stopMetro(playground, port), /another checkout/);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
});
