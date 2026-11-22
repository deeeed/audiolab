import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execute = promisify(execFile);
const source = await fs.readFile(new URL('../preflight.sh', import.meta.url), 'utf8');
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
  require('node:fs').appendFileSync(process.env.FINGERPRINT_EVENTS, 'fingerprint\\n');
  require('node:assert/strict').deepEqual(options, {
    platforms: [process.env.PLATFORM], preset: 'strict', concurrentIoLimit: 4, silent: true,
    extraSources: [
      { type: 'dir', filePath: '../../packages/audio-studio/cpp', reasons: ['audioStudioSharedCpp'] },
      { type: 'dir', filePath: '../../packages/audio-studio/plugin/src', reasons: ['audioStudioConfigPlugin'] },
    ],
    ignorePaths: ['docs/**/*', 'src/**/*', 'lib/**/*', '*.md', 'wasm/**/*', 'wasm-src/**/*']
      .map(pattern => '../../packages/*/' + pattern)
      .concat('!../../packages/*/src/**/Native*.ts', '../../packages/moonshine.rn/prebuilt/ios/current/**/*',
        '../../packages/moonshine.rn/prebuilt/android/moonshine-voice-isolated.aar',
        '../../packages/audio-studio/plugin/src/**/*.test.ts'),
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
    FIXTURE_HASH: newHash, EVENTS: path.join(root, 'events'), FINGERPRINT_EVENTS: path.join(root, 'fingerprint-events') };
  const target = platform === 'android' ? 'pixel-fixture' : mode === 'physical' ? 'phone-fixture' : 'sim-fixture';
  const stamp = path.join(env.XDG_CACHE_HOME, `audiolab-dev-client/net.siteed.fixture.development/${platform}-${target}.fingerprint`);
  return {
    root, env, stamp,
    run: overrides => execute('bash', ['-c', script], { env: { ...env, ...overrides }, timeout: 10000 }),
    seed: async hash => { await fs.mkdir(path.dirname(stamp), { recursive: true }); await fs.writeFile(stamp, `${hash}\n`); },
    events: async () => fs.readFile(env.EVENTS, 'utf8').catch(() => ''),
    fingerprintCalls: async () => (await fs.readFile(env.FINGERPRINT_EVENTS, 'utf8').catch(() => '')).split('\n').filter(Boolean).length,
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
  await assert.rejects(f.run({ FAIL_FINGERPRINT: '1' }), error => {
    assert.match(error.stderr, /Could not compute native fingerprint: fixture failure/);
    return true;
  });
  assert.equal(await f.events(), '');
  const skipped = await f.run({ FAIL_FINGERPRINT: '1', SKIP_BUILD: '1' });
  assert.match(skipped.stdout, /WARNING: Could not check/);
  assert.match(skipped.stderr, /Could not compute native fingerprint: fixture failure/);
  assert.equal(await f.events(), '');
});

test('REBUILD forces reinstall with a matching fingerprint and missing app always builds', async t => {
  const f = await fixture(t);
  await f.seed(newHash);
  await f.run({ REBUILD: '1' });
  assert.equal(await f.fingerprintCalls(), 1);
  await f.run({ INSTALLED: '0' });
  assert.equal(await f.fingerprintCalls(), 2);
  assert.equal(await f.events(), 'build\ninstall\nbuild\ninstall\n');
});

test('SKIP_BUILD installs a missing Android client despite fingerprint failure without stamping', async t => {
  const f = await fixture(t);
  const result = await f.run({ SKIP_BUILD: '1', INSTALLED: '0', FAIL_FINGERPRINT: '1' });
  assert.match(result.stdout, /continues the build without recording a stamp/);
  assert.equal(await f.fingerprintCalls(), 1);
  assert.equal(await f.events(), 'build\ninstall\n');
  await assert.rejects(fs.access(f.stamp));
  await f.seed(oldHash);
  await f.run({ SKIP_BUILD: '1', INSTALLED: '0', FAIL_FINGERPRINT: '1' });
  assert.equal(await fs.readFile(f.stamp, 'utf8'), `${oldHash}\n`);
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

test('generated Moonshine artifacts preserve both platform fingerprints while native inputs invalidate them', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audiolab-fingerprint-probe-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appRoot = path.join(root, 'apps/playground');
  const moonshine = path.join(root, 'packages/moonshine.rn');
  for (const folder of ['node_modules/expo', 'node_modules/@expo/fingerprint']) {
    await fs.mkdir(path.join(appRoot, folder), { recursive: true });
  }
  await fs.mkdir(path.join(moonshine, 'prebuilt/ios/current'), { recursive: true });
  await fs.mkdir(path.join(moonshine, 'prebuilt/ios/Moonshine.xcframework/ios-arm64'), { recursive: true });
  await fs.mkdir(path.join(moonshine, 'prebuilt/android'), { recursive: true });
  await fs.mkdir(path.join(root, 'packages/audio-studio/cpp'), { recursive: true });
  await fs.mkdir(path.join(root, 'packages/audio-studio/plugin/src'), { recursive: true });
  await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({ name: 'fingerprint-probe', version: '1.0.0' }));
  await fs.writeFile(path.join(appRoot, 'app.json'), JSON.stringify({ expo: { name: 'Probe', slug: 'probe' } }));
  await fs.writeFile(path.join(appRoot, 'node_modules/expo/index.js'), '');
  const require = createRequire(new URL('../../../apps/playground/package.json', import.meta.url));
  const expo = require.resolve('expo');
  const realFingerprint = require.resolve('@expo/fingerprint', { paths: [expo] });
  // Supply the workspace package root as autolinking would, while retaining the preflight options.
  await fs.writeFile(path.join(appRoot, 'node_modules/@expo/fingerprint/index.js'), `
exports.createProjectHashAsync = (root, options) => require(${JSON.stringify(realFingerprint)}).createProjectHashAsync(root, {
  ...options,
  extraSources: [...options.extraSources, { type: 'dir', filePath: '../../packages/moonshine.rn', reasons: ['fixtureNativeModule'] }],
}).catch(error => { console.error(error); throw error; });
`);
  const slice = path.join(moonshine, 'prebuilt/ios/current/libmoonshine_core.a');
  const native = path.join(moonshine, 'prebuilt/ios/Moonshine.xcframework/ios-arm64/libmoonshine.a');
  const aar = path.join(moonshine, 'prebuilt/android/moonshine-voice-isolated.aar');
  const manifest = path.join(moonshine, 'package.json');
  const packageJson = { name: '@siteed/moonshine.rn', version: '1.0.0',
    moonshineArtifacts: { android: { isolatedAarSha256: '1'.repeat(64) } } };
  const plugin = path.join(root, 'packages/audio-studio/plugin/src/index.ts');
  const pluginTests = ['index.test.ts', 'nested/index.test.ts'].map(file => path.join(path.dirname(plugin), file));
  for (const file of pluginTests) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '// plugin test\n');
  }
  await fs.writeFile(manifest, JSON.stringify(packageJson));
  await fs.writeFile(plugin, '// native config plugin\n');
  await fs.writeFile(native, 'native library\n');
  await fs.writeFile(slice, 'device slice\n');
  const hash = async platform => (await execute('bash', ['-c', `${fingerprint}\nnative_fingerprint`], {
    env: { ...process.env, APP_ROOT: appRoot, APP_VARIANT_EFFECTIVE: 'development', PLATFORM: platform },
    cwd: appRoot,
    timeout: 30000,
  })).stdout;
  const baseline = {};
  for (const platform of ['android', 'ios']) baseline[platform] = await hash(platform);
  for (const file of pluginTests) await fs.writeFile(file, '// changed plugin test\n');
  for (const platform of ['android', 'ios']) {
    assert.equal(await hash(platform), baseline[platform], `${platform}: config plugin test changed fingerprint`);
  }
  await fs.writeFile(slice, 'simulator slice\n');
  for (const platform of ['android', 'ios']) {
    assert.equal(await hash(platform), baseline[platform], `${platform}: generated slice changed fingerprint`);
  }
  await fs.writeFile(aar, 'generated isolated AAR\n');
  for (const platform of ['android', 'ios']) {
    assert.equal(await hash(platform), baseline[platform], `${platform}: generated AAR changed fingerprint`);
  }
  await fs.unlink(aar);
  for (const platform of ['android', 'ios']) {
    assert.equal(await hash(platform), baseline[platform], `${platform}: removed AAR changed fingerprint`);
  }
  packageJson.moonshineArtifacts.android.isolatedAarSha256 = '2'.repeat(64);
  await fs.writeFile(manifest, JSON.stringify(packageJson));
  for (const platform of ['android', 'ios']) {
    assert.notEqual(await hash(platform), baseline[platform], `${platform}: AAR checksum change was ignored`);
  }
  packageJson.moonshineArtifacts.android.isolatedAarSha256 = '1'.repeat(64);
  await fs.writeFile(manifest, JSON.stringify(packageJson));
  await fs.writeFile(native, 'changed native library\n');
  for (const platform of ['android', 'ios']) {
    assert.notEqual(await hash(platform), baseline[platform], `${platform}: native change was ignored`);
  }
  await fs.writeFile(native, 'native library\n');
  await fs.writeFile(plugin, '// changed native config plugin\n');
  for (const platform of ['android', 'ios']) {
    assert.notEqual(await hash(platform), baseline[platform], `${platform}: config plugin source change was ignored`);
  }
});
