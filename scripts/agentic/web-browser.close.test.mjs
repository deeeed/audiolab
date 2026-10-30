/**
 * Regression coverage for `web-browser.mjs close` as a teardown hook.
 *
 * Farm slot teardown runs `close` whether or not a browser was ever launched.
 * It used to throw "No running browser found" when .agent/web-browser.json was
 * missing, so the shutdown hook failed and the slot stayed held.
 *
 * Run: node --test scripts/agentic/web-browser.close.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, it } from 'node:test';

const SCRIPT = path.join(import.meta.dirname, 'web-browser.mjs');

let appRoot;

beforeEach(() => {
  appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'web-browser-close-'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), '{}');
  // The script resolves playwright from APP_ROOT at load; close never uses it.
  const stub = path.join(appRoot, 'node_modules', 'playwright');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'index.js'), 'module.exports = { chromium: {} };');
});

afterEach(() => fs.rmSync(appRoot, { recursive: true, force: true }));

function close() {
  return spawnSync(process.execPath, [SCRIPT, 'close'], {
    env: { ...process.env, APP_ROOT: appRoot },
    encoding: 'utf8',
  });
}

it('succeeds when no browser is running', () => {
  const result = close();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { closed: true, wasRunning: false });
});

it('stops the recorded browser server and clears its connection', async () => {
  const server = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const exited = new Promise((resolve) => server.once('exit', (_code, signal) => resolve(signal)));
  const connection = path.join(appRoot, '.agent', 'web-browser.json');
  fs.mkdirSync(path.dirname(connection), { recursive: true });
  fs.writeFileSync(connection, JSON.stringify({ pid: server.pid }));

  const result = close();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { closed: true });
  assert.equal(await exited, 'SIGTERM');
  assert.equal(fs.existsSync(connection), false);
});
