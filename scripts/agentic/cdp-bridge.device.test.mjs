/**
 * Regression coverage for Android device selection.
 *
 * Context: with two identical emulators attached, both report the same model,
 * so the bridge drove whichever `adb devices -l` listed first, even when the
 * slot was assigned the other one. The assigned ADB_SERIAL now picks among
 * equally good matches, without overriding a request for a different model.
 *
 * Run: node --test scripts/agentic/cdp-bridge.device.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const BRIDGE = path.join(import.meta.dirname, 'cdp-bridge.mjs');
const EMULATOR = 'sdk_gphone64_arm64 - 16 - API 36';

let tmpRoot;
let bridge;

const adb = (...devices) =>
  ['List of devices attached', ...devices, ''].join('\n');
const emulator = (port) =>
  `emulator-${port}          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:${port}`;
const PIXEL_6 = '1A2B3C4D5E device usb:1-1 product:oriole model:Pixel_6 device:oriole transport_id:3';
const PIXEL_6A = '27KX0QXN1 device usb:1-2 product:bluejay model:Pixel_6a device:bluejay transport_id:4';

const pick = (output, deviceName, assigned) =>
  bridge.selectAndroidDevice(output, deviceName, assigned)?.serial;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-device-'));
  process.env.APP_ROOT = tmpRoot;
  process.env.CDP_BRIDGE_IMPORT_ONLY = '1';
  bridge = await import(`${BRIDGE}?t=${Date.now()}`);
});

after(() => {
  delete process.env.CDP_BRIDGE_IMPORT_ONLY;
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('selectAndroidDevice', () => {
  it('uses the only attached device whatever its name', () => {
    assert.equal(pick(adb(PIXEL_6A), EMULATOR, undefined), '27KX0QXN1');
  });

  it('picks the assigned serial among identical emulators', () => {
    const output = adb(emulator(5582), emulator(5584));
    assert.equal(pick(output, EMULATOR, 'emulator-5584'), 'emulator-5584');
    assert.equal(pick(output, EMULATOR, 'emulator-5582'), 'emulator-5582');
  });

  it('keeps the first identical emulator when no serial is assigned', () => {
    assert.equal(pick(adb(emulator(5582), emulator(5584)), EMULATOR, undefined), 'emulator-5582');
  });

  it('does not let "Pixel 6" claim a Pixel 6a, or the reverse', () => {
    const output = adb(PIXEL_6A, PIXEL_6);
    assert.equal(pick(output, 'Pixel 6 - 15 - API 35', undefined), '1A2B3C4D5E');
    assert.equal(pick(output, 'Pixel 6a - 16 - API 36', undefined), '27KX0QXN1');
  });

  it('never lets the assigned serial override a different requested model', () => {
    const output = adb(PIXEL_6, PIXEL_6A, emulator(5584));
    assert.equal(pick(output, 'Pixel 6a - 16 - API 36', '1A2B3C4D5E'), '27KX0QXN1');
    assert.equal(pick(output, EMULATOR, '27KX0QXN1'), 'emulator-5584');
  });

  it('fails loudly when no device matches', () => {
    assert.throws(
      () => pick(adb(PIXEL_6, emulator(5584)), 'Galaxy S24 - 14 - API 34', undefined),
      /No Android device matching "Galaxy S24/
    );
  });
});
