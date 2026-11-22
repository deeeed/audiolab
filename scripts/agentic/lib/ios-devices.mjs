import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function connectedIOSDevices() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audiolab-ios-devices-'));
  const file = path.join(directory, 'devices.json');
  try {
    execFileSync('/usr/bin/xcrun', ['devicectl', 'list', 'devices', '--json-output', file], {
      stdio: ['ignore', 'ignore', 'pipe'], timeout: 10000,
    });
    return JSON.parse(fs.readFileSync(file, 'utf8')).result.devices
      .filter(device => device.hardwareProperties.reality === 'physical'
        && device.connectionProperties.pairingState === 'paired')
      .map(device => ({ name: device.deviceProperties.name, udid: device.hardwareProperties.udid,
        identifier: device.identifier }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function selectIOSDevice({ udid, name } = {}, devices = connectedIOSDevices()) {
  const matches = devices.filter(device => {
    if (udid && device.udid !== udid && device.identifier !== udid) return false;
    return !name || device.name.toLowerCase() === name.toLowerCase();
  });
  if (matches.length !== 1) throw new Error('Select one connected physical iOS device with IOS_DEVICE_UDID.');
  return matches[0];
}

export function physicalIOSDeviceForTarget(target, devices, binding = {}) {
  if (!binding.udid || !binding.inspectorId || target.reactNative?.logicalDeviceId !== binding.inspectorId) return;
  return selectIOSDevice({ udid: binding.udid }, devices);
}

export function nativeTargetKey(target) {
  return target.reactNative?.logicalDeviceId || target.udid || target.deviceName || '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(selectIOSDevice({ udid: process.env.IOS_DEVICE_UDID })));
}
