import { listCdpTargets } from '@farmslot/recipe-runner/runtime/cdp';

export async function recordingTarget({ platform, serial, simulator, device, iosDevice, cdp, metro }) {
  if (platform === 'android') {
    if (!serial) throw new Error('Android recording needs the assigned ADB_SERIAL.');
    return { kind: 'android-device', serial };
  }
  if (platform === 'ios') {
    if (iosDevice || device?.startsWith('device:')) throw new Error('Physical iOS video capture is not declared; use recording off with a reason.');
    if (!simulator && !device) throw new Error('iOS recording needs the assigned simulator.');
    return { kind: 'simulator', device: simulator || device };
  }
  const pages = (await listCdpTargets('127.0.0.1', Number(cdp))).filter(page => {
    try { return page.type === 'page' && Number(new URL(page.url).port) === Number(metro); }
    catch { return false; }
  });
  if (pages.length !== 1) throw new Error('The selected web target must have exactly one app page.');
  return { kind: 'cdp-page', host: '127.0.0.1', port: Number(cdp), targetId: pages[0].id };
}
