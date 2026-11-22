import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileStage, executeStageCommand, runStage } from '../lib/stage-runner.mjs';
import { selectIOSDevice, physicalIOSDeviceForTarget, nativeTargetKey } from '../lib/ios-devices.mjs';

const execute = promisify(execFile);
const fixtureStage = argv => ({ executable: process.execPath, argv, cwd: process.cwd(), appRoot: process.cwd(), mode: 'run', timeoutSeconds: 2 });

test('configured prerequisites fail before mutation and require Python only for physical iOS', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-configured-tools-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const script = path.resolve(import.meta.dirname, '../../../farmslot/projects/audiolab-farm/scripts/configured-paths.sh');
  const python = path.join(directory, 'python with spaces');
  await fs.writeFile(python, '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_PYTHON_VERSION"\n', { mode: 0o755 });
  const checks = `
source "$1"
AUDIOLAB_NODE_BIN=
IOS_DEVICE_UDID=
if audiolab_check_paths; then exit 2; fi
AUDIOLAB_NODE_BIN="$2"
audiolab_check_paths || exit 3
IOS_DEVICE_UDID=00008101-001348AC1490801E
AUDIOLAB_PYTHON_BIN=
if audiolab_check_paths; then exit 4; fi
AUDIOLAB_PYTHON_BIN="$3"
export FIXTURE_PYTHON_VERSION=3.12
audiolab_check_paths || exit 5
FIXTURE_PYTHON_VERSION=3.14
if audiolab_check_paths; then exit 6; fi
printf 'checks passed'
`;
  const { stdout, stderr } = await execute('bash', ['-c', checks, 'bash', script, path.dirname(process.execPath), python], {
    env: { ...process.env, FARMSLOT_MACHINE: 'fixture-node' },
  });
  assert.equal(stdout, 'checks passed');
  assert.match(stderr, /missing Node on fixture-node, set AUDIOLAB_NODE_BIN/);
  assert.match(stderr, /missing Python3.12 on fixture-node, set AUDIOLAB_PYTHON_BIN/);
});

test('Sherpa Android validates assigned reverse mapping after cold launch', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-sherpa-launch-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, 'apps/sherpa-voice');
  const bin = path.join(directory, 'bin');
  for (const folder of ['bin', 'scripts/agentic', 'apps/sherpa-voice/scripts/agentic',
    'apps/sherpa-voice/android/app/src/main/res/values', 'apps/sherpa-voice/android/app/src/main/res/xml']) {
    await fs.mkdir(path.join(directory, folder), { recursive: true });
  }
  for (const name of ['preflight.sh', 'android-doctor.sh']) {
    await fs.copyFile(new URL(`../../../apps/sherpa-voice/scripts/agentic/${name}`, import.meta.url), path.join(app, 'scripts/agentic', name));
  }
  await fs.writeFile(path.join(app, 'scripts/sync-android-dev-config.sh'), '#!/bin/sh\nexit 0\n');
  await fs.writeFile(path.join(directory, 'scripts/agentic/preflight.sh'), '#!/bin/sh\ntouch "$LAUNCH_MARKER"\n');
  await fs.writeFile(path.join(bin, 'git'), '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_REPO"\n', { mode: 0o755 });
  await fs.writeFile(path.join(bin, 'adb'), '#!/bin/sh\ntest -f "$LAUNCH_MARKER" || exit 1\nprintf "tcp:7464 tcp:7464\\ntcp:8081 tcp:8188\\n"\n', { mode: 0o755 });
  await fs.writeFile(path.join(app, 'android/app/src/main/res/values/dev_server_port.xml'), '<integer name="react_native_dev_server_port">7464</integer>');
  await fs.writeFile(path.join(app, 'android/app/src/main/res/xml/network_security_config.xml'), '<base-config cleartextTrafficPermitted="true" />');
  await fs.writeFile(path.join(app, 'android/app/src/main/AndroidManifest.xml'), '<data android:scheme="sherpa-voice-development"/><data android:scheme="exp+sherpa-voice-development"/>');
  const { stdout } = await execute('bash', [path.join(app, 'scripts/agentic/preflight.sh')], {
    timeout: 4000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_REPO: directory,
      LAUNCH_MARKER: path.join(directory, 'launched'), PLATFORM: 'android', APP_VARIANT: 'development',
      WATCHER_PORT: '7464', ADB_SERIAL: 'assigned-pixel' },
  });
  assert.match(stdout, /adb reverse OK for assigned-pixel/);
});

test('physical capture tools recover after an interrupted package install', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-tools-retry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, '.agent/tools/ios/bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, 'python'), '#!/bin/sh\ntest -f .agent/tools/ios/ready\n', { mode: 0o755 });
  await fs.writeFile(path.join(bin, 'pip'), '#!/bin/sh\necho install >> .agent/tools/ios/attempts\ntest "$FAIL_INSTALL" != 1 || exit 1\ntouch .agent/tools/ios/ready\n', { mode: 0o755 });
  const source = await fs.readFile(new URL('../../../farmslot/projects/audiolab-farm/scripts/deps.sh', import.meta.url), 'utf8');
  const install = source.slice(source.indexOf('if [[ "${IOS_DEVICE_UDID'));
  const env = { ...process.env, IOS_DEVICE_UDID: '00008101-001348AC1490801E', FAIL_INSTALL: '1' };
  await assert.rejects(execute('bash', ['-e', '-c', install], { cwd: directory, env }));
  env.FAIL_INSTALL = '0';
  await execute('bash', ['-e', '-c', install], { cwd: directory, env });
  await execute('bash', ['-e', '-c', install], { cwd: directory, env });
  assert.equal(await fs.readFile(path.join(bin, '../attempts'), 'utf8'), 'install\ninstall\n');
});

test('stage tools use the configured SDK and the executing Node version', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-sdk with spaces-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'platform-tools');
  await fs.mkdir(bin);
  const adb = path.join(bin, 'adb');
  await fs.writeFile(adb, '#!/bin/sh\ntest "$1" = -s && test "$2" = emulator-5580 && test "$5" = sys.boot_completed || exit 1\nprintf "1\\n"\n', { mode: 0o755 });
  const previous = process.env.ANDROID_HOME;
  process.env.ANDROID_HOME = directory;
  t.after(() => { if (previous === undefined) delete process.env.ANDROID_HOME; else process.env.ANDROID_HOME = previous; });
  const stage = compileStage('android-boot', 'playground', { serial: 'emulator-5580' });
  assert.equal(stage.executable, adb);
  assert.equal(await runStage(stage, 2, 'configured-adb'), 0);
  assert.equal(compileStage('native-deps', 'playground', {}).executable, path.join(path.dirname(process.execPath), 'yarn'));
});

test('the pack stage allow-list refuses command and argument injection', () => {
  assert.throws(() => compileStage('arbitrary-command', 'playground', {}));
  assert.throws(() => compileStage('metro', '../outside', {}));
  assert.throws(() => compileStage('metro', 'playground', { executable: '/bin/sh' }));
  assert.throws(() => compileStage('native-handshake', 'playground', { name: 'iPhone; shutdown' }));
  assert.throws(() => compileStage('native-handshake', 'playground', { name: '--eval' }));
  assert.throws(() => compileStage('ios-device-build', 'playground', { scheme: 'Other', device: '00008101-001348AC1490801E' }));
  const stage = compileStage('native-handshake', 'playground', { name: 'device:Arthur’s iPhone' });
  assert.equal(stage.executable, process.execPath);
  assert.deepEqual(stage.argv.slice(-3), ['--device', 'device:Arthur’s iPhone', 'get-route']);
});

test('readiness retries a real failed first probe before accepting success', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-stage-poll-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const counter = path.join(directory, 'counter');
  const code = 'const fs=require("fs");const p=process.argv[1];const n=fs.existsSync(p)?Number(fs.readFileSync(p)):0;fs.writeFileSync(p,String(n+1));process.exit(n===0?1:0)';
  const stage = { ...fixtureStage(['-e', code, counter]), mode: 'poll' };
  assert.equal(await runStage(stage, 2, 'bridge'), 0);
  assert.equal(await fs.readFile(counter, 'utf8'), '2');
});

test('missing debug targets fail and command errors retain their cause', async () => {
  const stage = fixtureStage(['-e', 'console.error("missing debug target");process.exit(7)']);
  const result = await executeStageCommand(stage, 500);
  assert.equal(result.code, 7);
  assert.equal(result.timedOut, false);
  assert.match(result.stderr, /missing debug target/);
});

test('timeout stops a descendant that outlives its command leader', async t => {
  let child;
  t.after(() => {
    if (!child) return;
    try { process.kill(child, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  const code = 'const {spawn}=require("child_process");const c=spawn(process.execPath,["-e","process.on(\\"SIGTERM\\",()=>{});console.log(\\"ready\\");setInterval(()=>{},100)"],{stdio:["ignore","pipe","inherit"]});c.stdout.once("data",()=>console.log(c.pid));setInterval(()=>{},100)';
  const result = await executeStageCommand(fixtureStage(['-e', code]), 1200);
  child = Number(result.stdout.trim());
  assert.ok(child > 0);
  assert.equal(result.timedOut, true);
  const { stdout } = await execute('/bin/ps', ['-p', String(child), '-o', 'state=']).catch(error => error);
  assert.ok(!stdout.trim() || stdout.trim().startsWith('Z'));
});

test('default native selections reach the manifest readiness stage', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-launch-default-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'adb'), '#!/bin/sh\nprintf "Pixel_6\\n"\n', { mode: 0o755 });
  const preflight = await fs.readFile(new URL('../preflight.sh', import.meta.url), 'utf8');
  const readiness = preflight.slice(preflight.indexOf('# A successful process launch'));
  const repo = path.resolve(import.meta.dirname, '../../..');
  const stub = 'info() { :; }; launch_stage() { printf "%s\\n" "$*"; };';
  for (const [platform, expected] of [['ios', 'configured-sim'], ['android', 'Pixel_6']]) {
    const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, PLATFORM: platform,
      MONOREPO_ROOT: repo, APP_ROOT: path.join(repo, 'apps/playground'), PORT: '7466',
      SIM: 'configured-sim', SERIAL: 'assigned-serial' };
    delete env.IOS_SIMULATOR;
    delete env.ADB_SERIAL;
    delete env.IOS_DEVICE_UDID;
    const { stdout } = await execute('bash', ['-c', `${stub}\n${readiness}`], { env });
    assert.match(stdout, new RegExp(`native-handshake 180 name=${expected}`));
  }
});

test('physical screenshot selection refuses a different phone from the runtime', () => {
  const devices = [{ name: 'Connected iPhone', udid: 'assigned', identifier: 'core-device' },
    { name: 'Other iPhone', udid: 'other', identifier: 'other-core' }];
  assert.equal(selectIOSDevice({ udid: 'assigned', name: 'Connected iPhone' }, devices).udid, 'assigned');
  assert.throws(() => selectIOSDevice({ udid: 'assigned', name: 'Other iPhone' }, devices));
  const sameName = devices.map(device => ({ ...device, name: 'iPhone' }));
  assert.equal(physicalIOSDeviceForTarget({ deviceName: 'iPhone' }, sameName), undefined);
});


test('physical attribution requires the verified opaque inspector binding', () => {
  const devices = [{ name: 'iPhone', udid: 'assigned', identifier: 'core-a' },
    { name: 'iPhone', udid: 'other', identifier: 'core-b' }];
  const assigned = { deviceName: 'iPhone', reactNative: { logicalDeviceId: 'opaque-a' } };
  const other = { deviceName: 'iPhone', reactNative: { logicalDeviceId: 'opaque-b' } };
  const binding = { udid: 'assigned', inspectorId: 'opaque-a' };
  assert.equal(physicalIOSDeviceForTarget(other, [devices[0]], binding), undefined);
  assert.equal(physicalIOSDeviceForTarget(assigned, devices, binding).udid, 'assigned');
  assert.equal(physicalIOSDeviceForTarget(assigned, devices), undefined);
  for (const targets of [[other, assigned], [assigned, other]]) {
    const unique = [...new Map(targets.map(target => [nativeTargetKey(target), target])).values()];
    assert.equal(unique.length, 2);
    assert.equal(unique.filter(target => physicalIOSDeviceForTarget(target, devices, binding)).length, 1);
  }
});


test('cancellation stops the active command and does not become a retry', async () => {
  const stage = fixtureStage(['-e', 'console.log("ready");setInterval(()=>{},100)']);
  const result = await executeStageCommand(stage, 1000, data => {
    if (data.toString().includes('ready')) process.emit('SIGTERM');
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
});
