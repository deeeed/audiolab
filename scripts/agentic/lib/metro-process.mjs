import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const inspect = (args) => {
  try { return execFileSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 10000 }).trim(); }
  catch (error) { if (error.status === 1) return ''; throw error; }
};

const metroCwd = (pid) => {
  const args = inspect(['ps', '-p', String(pid), '-o', 'args=']);
  if (!args || !/expo|metro|start-metro\.sh/.test(args)) return null;
  return inspect(['lsof', '-nP', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    .split('\n').find(line => line.startsWith('n'))?.slice(1) ?? null;
};

// The checkout an app root belongs to; an app root outside Git is its own checkout.
const checkoutOf = (appRoot) => {
  const real = fs.realpathSync(appRoot);
  try { return fs.realpathSync(execFileSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 10000 }).trim()); }
  catch { return real; }
};

// Any app root of the same checkout owns its Metro: the slot Metro may have been started for
// another app (run 1ad82ba1: apps/sherpa-voice on the playground's port), and refusing it kept
// the slot occupied. Both sides resolve to their own checkout, so a separate repo, submodule
// or linked worktree nested under this one is still foreign.
export function ownsMetro(pid, appRoot) {
  const cwd = metroCwd(pid);
  if (cwd === null) return false;
  try { return checkoutOf(cwd) === checkoutOf(appRoot); }
  catch { return false; }
}

/** `this-app`, `other-app` (same checkout, another app root) or `none`, from port listeners only. */
export function metroBinding(appRoot, port) {
  const listeners = metroListeners(appRoot, port);
  if (listeners.length === 0) return 'none';
  const real = fs.realpathSync(appRoot);
  return listeners.every(pid => metroCwd(pid) === real) ? 'this-app' : 'other-app';
}

export function metroListeners(appRoot, port) {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Select a valid Metro port.');
  const listeners = inspect(['lsof', '-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).split('\n').filter(Boolean).map(Number);
  if (listeners.some(pid => !ownsMetro(pid, appRoot))) throw new Error(`Metro port ${port} is owned by another checkout; refusing to stop or reuse it.`);
  return listeners;
}

export function metroProcesses(appRoot, port) {
  const listeners = metroListeners(appRoot, port);
  // A PID-file entry not on the port must be this app root's own Metro, not just the checkout's.
  const pidFile = path.join(appRoot, '.agent/metro.pid');
  const saved = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8').trim()) : 0;
  const ownSaved = saved > 0 && !listeners.includes(saved) && metroCwd(saved) === fs.realpathSync(appRoot);
  return [...new Set([...listeners, ...(ownSaved ? [saved] : [])])];
}

/** Signal only the given PIDs, each rechecked as this checkout's Metro right before the signal. */
export function stopMetroPids(appRoot, pids) {
  let signalled = 0;
  for (const pid of pids) {
    if (!ownsMetro(pid, appRoot)) continue;
    try { process.kill(pid, 'SIGTERM'); signalled++; }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  return signalled;
}

export function stopMetro(appRoot, port) {
  const pids = metroProcesses(appRoot, port);
  for (const pid of pids) {
    // Recheck identity immediately before signalling a PID from disk or a port probe.
    if (ownsMetro(pid, appRoot)) {
      try { process.kill(pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  return { kind: 'stopped', status: 0, signalled: pids.length, summary: `Stopped ${pids.length} checkout-owned Metro processes.` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, appRoot, port] = process.argv.slice(2);
  if (mode === 'check') metroProcesses(appRoot, port);
  else if (mode === 'binding') console.log(metroBinding(appRoot, port));
  else if (mode === 'stop') console.log(stopMetro(appRoot, port).summary);
  else throw new Error('Use metro-process.mjs check|binding|stop <app-root> <port>.');
}
