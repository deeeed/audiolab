import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = await fs.readFile(new URL('./preflight.sh', import.meta.url), 'utf8');
const fingerprint = source.slice(source.indexOf('native_fingerprint() {'), source.indexOf('run_simctl_timeout() {'));
const build = source.slice(source.indexOf('info "Step 3:'), source.indexOf('# ── 4. Launch'));
const oldHash = '1'.repeat(40);
const newHash = '2'.repeat(40);

async function fixture(t, platform = 'android', mode = 'physical') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-preflight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const folder of ['bin', 'node_modules/expo', 'node_modules/@expo/fingerprint',
    'android/app/build/outputs/apk/debug', 'ios/build/Build/Products/Debug-iphonesimulator/Fixture.app',
    'ios/build-device/Build/Products/Debug-iphoneos/Fixture.app']) {
    await fs.mkdir(path.join(root, folder), { recursive: true });
  }
  await fs.writeFile(path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), 'apk');
  await fs.writeFile(path.join(root, 'node_modules/expo/index.js'), '');
  await fs.writeFile(path.join(root, 'node_modules/@expo/fingerprint/index.js'), `
exports.createProjectHashAsync = async (root, options) => {
  require('node:assert/strict').deepEqual(options, {
    platforms: [process.env.PLATFORM], preset: 'strict', concurrentIoLimit: 4, silent: true,
  });
  if (process.env.FAIL_FINGERPRINT === '1') throw new Error('fixture failure');
  return process.env.FIXTURE_HASH;
};
`);
  await fs.writeFile(path.join(root, 'bin/adb'), `#!/bin/bash
case "$*" in
  *'pm list packages'*) [ "$INSTALLED" = 1 ] && echo "package:net.siteed.fixture.$APP_VARIANT"; exit 0 ;;
  *' install -r '*) echo install >> "$EVENTS"; [ "\${FAIL_INSTALL:-0}" != 1 ] ;;
esac
`, { mode: 0o755 });
  await fs.writeFile(path.join(root, 'bin/xcrun'), '#!/bin/bash\necho install >> "$EVENTS"\n[ "\${FAIL_INSTALL:-0}" != 1 ]\n', { mode: 0o755 });
  const script = `set -euo pipefail
cd "$APP_ROOT"
APP_VARIANT_EFFECTIVE="$APP_VARIANT"
BUNDLE_ID_ANDROID="net.siteed.fixture.$APP_VARIANT"
BUNDLE_ID_IOS="$BUNDLE_ID_ANDROID"
SERIAL="\${FIXTURE_DEVICE:-pixel-fixture}"
SIM_UUID=sim-fixture
SIM=Fixture
IOS_DEVICE_UDID=phone-fixture
AGENTIC_SKIP_BUILD_SUPPORTED=true
AGENTIC_PRE_BUILD_HOOK=
info() { echo "$1"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; }
simulator_app_installed() { [ "$INSTALLED" = 1 ]; }
physical_ios_app_installed() { [ "$INSTALLED" = 1 ]; }
resolve_ios_workspace_and_scheme() { IOS_SCHEME_NAME=Fixture; }
launch_stage() { echo build >> "$EVENTS"; [ "\${FAIL_BUILD:-0}" != 1 ]; }
${fingerprint}
${build}`;
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, APP_ROOT: root,
    XDG_CACHE_HOME: path.join(root, 'cache'), PLATFORM: platform, IOS_DEVICE_MODE: mode,
    APP_VARIANT: 'development', SKIP_BUILD: '0', REBUILD: '0', INSTALLED: '1',
    FIXTURE_HASH: newHash, EVENTS: path.join(root, 'events') };
  const target = platform === 'android' ? 'pixel-fixture' : mode === 'physical' ? 'phone-fixture' : 'sim-fixture';
  const stamp = path.join(env.XDG_CACHE_HOME, `audiolab-dev-client/net.siteed.fixture.development/${platform}-${target}.fingerprint`);
  return {
    root, env, stamp,
    run: overrides => execute('bash', ['-c', script], { env: { ...env, ...overrides }, timeout: 10000 }),
    seed: async hash => { await fs.mkdir(path.dirname(stamp), { recursive: true }); await fs.writeFile(stamp, `${hash}\n`); },
    events: async () => fs.readFile(env.EVENTS, 'utf8').catch(() => ''),
  };
}

for (const [platform, mode] of [['android', 'physical'], ['ios', 'physical'], ['ios', 'simulator']]) {
  test(`${platform} ${mode}: missing stamp rebuilds, then matching stamp reuses, changed stamp rebuilds`, async t => {
    const f = await fixture(t, platform, mode);
    assert.match((await f.run()).stdout, /fingerprint changed \(missing →/);
    assert.equal(await fs.readFile(f.stamp, 'utf8'), `${newHash}\n`);
    assert.equal(await f.events(), 'build\ninstall\n');
    assert.match((await f.run()).stdout, /fingerprint unchanged/);
    assert.equal(await f.events(), 'build\ninstall\n');
    await f.seed(oldHash);
    assert.match((await f.run()).stdout, new RegExp(`fingerprint changed \\(${oldHash} → ${newHash}\\)`));
    assert.equal(await f.events(), 'build\ninstall\nbuild\ninstall\n');
  });
}

test('SKIP_BUILD warns without rebuilding or stamping an installed stale client', async t => {
  const f = await fixture(t);
  await f.seed(oldHash);
  assert.match((await f.run({ SKIP_BUILD: '1' })).stdout, /WARNING: dev client native fingerprint changed/);
  assert.equal(await f.events(), '');
  assert.equal(await fs.readFile(f.stamp, 'utf8'), `${oldHash}\n`);
});

test('failed build or install retains the previous fingerprint', async t => {
  for (const failure of ['FAIL_BUILD', 'FAIL_INSTALL']) {
    const f = await fixture(t);
    await f.seed(oldHash);
    await assert.rejects(f.run({ [failure]: '1' }));
    assert.equal(await fs.readFile(f.stamp, 'utf8'), `${oldHash}\n`);
  }
});

test('fingerprint failure fails safely, while SKIP_BUILD keeps its installed-client behavior', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run({ FAIL_FINGERPRINT: '1' }));
  assert.equal(await f.events(), '');
  assert.match((await f.run({ FAIL_FINGERPRINT: '1', SKIP_BUILD: '1' })).stdout, /WARNING: Could not check/);
  assert.equal(await f.events(), '');
});

test('REBUILD forces reinstall with a matching fingerprint and missing app always builds', async t => {
  const f = await fixture(t);
  await f.seed(newHash);
  await f.run({ REBUILD: '1' });
  await f.run({ INSTALLED: '0' });
  assert.equal(await f.events(), 'build\ninstall\nbuild\ninstall\n');
});

test('variants and devices do not share stamps', async t => {
  const f = await fixture(t);
  await f.seed(newHash);
  assert.match((await f.run({ APP_VARIANT: 'preview' })).stdout, /fingerprint changed \(missing →/);
  assert.equal(await f.events(), 'build\ninstall\n');
  assert.equal(await fs.readFile(f.stamp, 'utf8'), `${newHash}\n`);
  assert.match((await f.run({ FIXTURE_DEVICE: 'second-pixel' })).stdout, /fingerprint changed \(missing →/);
  assert.equal(await f.events(), 'build\ninstall\nbuild\ninstall\n');
  assert.equal(await fs.readFile(f.stamp, 'utf8'), `${newHash}\n`);
});
