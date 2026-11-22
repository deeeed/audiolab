import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'farmslot/projects/audiolab-farm/launch-stages.json'), 'utf8'));

export function compileStage(id, app, parameters, definitions = manifest) {
  if (!Object.hasOwn(definitions.stages, id)) throw new Error(`Unknown launch stage: ${id}`);
  if (!definitions.apps.includes(app)) throw new Error('Unknown launch app.');
  const stage = definitions.stages[id];
  for (const key of Object.keys(parameters)) {
    if (!Object.hasOwn(stage.parameters, key)) throw new Error(`Unexpected stage argument: ${key}`);
  }
  const validated = {};
  for (const [key, rule] of Object.entries(stage.parameters)) {
    const value = parameters[key];
    if (rule.optional && (value === undefined || value === '')) continue;
    if (typeof value !== 'string') throw new Error(`Missing stage argument: ${key}`);
    if (rule.enum && !rule.enum.includes(value)) throw new Error(`Invalid stage argument: ${key}`);
    if (rule.pattern && !new RegExp(rule.pattern, rule.flags).test(value)) throw new Error(`Invalid stage argument: ${key}`);
    validated[key] = value;
  }
  const appRoot = path.join(repo, 'apps', app);
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const context = { ...validated, repo, app, appRoot, node_bin: path.dirname(process.execPath),
    ...(androidHome ? { android_home: androidHome } : {}) };
  const render = text => text.replaceAll(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!Object.hasOwn(context, key)) throw new Error(`Unbound manifest argument: ${key}`);
    return context[key];
  });
  const tool = definitions.tools[stage.tool];
  if (!tool) throw new Error('The stage tool is not allow-listed.');
  const executable = tool === 'node-runtime' ? process.execPath : render(tool);
  if (!path.isAbsolute(executable)) throw new Error('Stage executables must have fixed absolute paths.');
  const argv = stage.argv.flatMap(argument => {
    if (typeof argument === 'string') return [render(argument)];
    return validated[argument.when] ? [render(argument.value)] : [];
  });
  return { ...stage, executable, argv, appRoot, cwd: stage.cwd === 'android' ? path.join(appRoot, 'android') : appRoot };
}

function signalGroup(child, signal) {
  if (!child.pid) return false;
  try { process.kill(-child.pid, signal); return true; }
  catch (error) {
    if (error.code === 'ESRCH' || (error.code === 'EPERM' && child.exitCode !== null)) return false;
    throw error;
  }
}

async function stopGroup(child) {
  signalGroup(child, 'SIGTERM');
  const grace = Date.now() + 1000;
  while (Date.now() < grace && signalGroup(child, 0)) await new Promise(resolve => setTimeout(resolve, 50));
  signalGroup(child, 'SIGKILL');
}

export function executeStageCommand(stage, timeoutMs, output = () => {}) {
  return new Promise(resolve => {
    const child = spawn(stage.executable, stage.argv, { cwd: stage.cwd, shell: false, detached: true,
      env: { ...process.env, APP_ROOT: stage.appRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let stopping;
    const stop = () => { stopping ??= stopGroup(child); return stopping; };
    const cancel = () => { cancelled = true; void stop(); };
    process.once('SIGTERM', cancel);
    process.once('SIGINT', cancel);
    const timer = setTimeout(() => { timedOut = true; void stop(); }, timeoutMs);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-2 * 1024 * 1024); output(data, false); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); output(data, true); });
    async function finish(code, error) {
      clearTimeout(timer);
      process.removeListener('SIGTERM', cancel);
      process.removeListener('SIGINT', cancel);
      if (code !== 0 || stopping) await stop();
      resolve({ code, stdout, stderr: error?.message || stderr, timedOut, cancelled });
    }
    child.once('error', error => { void finish(1, error); });
    child.once('exit', code => { void finish(code ?? 1); });
  });
}

export async function runStage(stage, seconds, label) {
  if (!(Number.isFinite(seconds) && seconds > 0)) throw new Error('A positive stage timeout is required.');
  const limit = Math.min(seconds, stage.timeoutSeconds);
  const started = Date.now();
  const deadline = started + limit * 1000;
  const report = message => (stage.dataOutput ? process.stderr : process.stdout).write(message + '\n');
  const progress = () => report(`[preflight] Waiting for ${label}: ${((Date.now() - started) / 1000).toFixed(1)}s / ${limit}s`);
  progress();
  const heartbeat = setInterval(progress, 10000);
  let last;
  try {
    while (Date.now() < deadline) {
      const timeout = Math.min(deadline - Date.now(), stage.mode === 'poll' ? 15000 : Infinity);
      const output = stage.mode === 'poll' ? () => {} : (data, error) => (error ? process.stderr : process.stdout).write(data);
      last = await executeStageCommand(stage, timeout, output);
      if (last.cancelled) return 130;
      if (last.code === 0 && (!stage.stdoutEquals || last.stdout.trim() === stage.stdoutEquals)) {
        if (stage.mode === 'poll') process.stdout.write(last.stdout);
        report(`[preflight] PASS ${label} ready after ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return 0;
      }
      if (stage.mode === 'run') break;
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - Date.now()))));
    }
    const reason = last?.timedOut || Date.now() >= deadline ? `deadline ${limit}s reached` : `command exited ${last?.code}`;
    console.error(`[preflight] FAIL ${label}: ${reason}. ${last?.stderr || ''}`);
    return 1;
  } finally { clearInterval(heartbeat); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values, positionals } = parseArgs({ allowPositionals: true,
      options: { app: { type: 'string' }, timeout: { type: 'string' }, params: { type: 'string', default: '{}' } } });
    if (positionals.length !== 1) throw new Error('One manifest stage is required.');
    const stage = compileStage(positionals[0], values.app, JSON.parse(values.params));
    process.exitCode = await runStage(stage, Number(values.timeout), positionals[0]);
  } catch (error) { console.error(`[preflight] FAIL ${error.message}`); process.exitCode = 1; }
}
