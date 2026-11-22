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
