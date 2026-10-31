#!/usr/bin/env node
/**
 * Web Browser Bridge — Playwright-based browser lifecycle manager for web
 * agentic feedback loop.
 *
 * Mirrors the command interface of cdp-bridge.mjs but uses Playwright's
 * page.evaluate() to call globalThis.__AGENTIC__ methods.
 *
 * Two modes:
 *   Server mode (launch): Start Chromium with --remote-debugging-port,
 *     navigate to app, capture console logs, write connection info to
 *     .agent/web-browser.json, keep running.
 *   Command mode (all others): Connect to running browser via
 *     connectOverCDP, execute command, print JSON result, exit.
 *
 * Usage:
 *   node scripts/agentic/web-browser.mjs <command> [args...]
 *
 * Commands:
 *   launch                    Start browser, navigate to app, begin log capture
 *   navigate <path>           Navigate to a route (Expo Router path)
 *   get-route                 Get current route path
 *   get-state                 Get audio recorder state
 *   eval <expression>         Evaluate arbitrary JS in app context
 *   can-go-back               Check if navigation can go back
 *   go-back                   Navigate back
 *   screenshot [label]        Take a screenshot
 *   logs                      Print captured console logs
 *   close                     Close browser, cleanup
 *
 * Environment:
 *   WATCHER_PORT    Expo web dev server port (reads from agentic.conf if unset)
 *   WEB_HEADLESS    Run browser headless (default: false)
 *   WEB_TIMEOUT     Navigation/wait timeout in ms (default: 30000)
 *   WEB_STARTUP_TIMEOUT  Overall startup budget in ms (default: all stage budgets and retries)
 *   WEB_BROWSER_PID_FILE  Chrome PID path for the farm's ownership watch
 *   CDP_PORT        Chrome remote debugging port (default: 9222)
 *
 * Known limitation — live microphone on macOS:
 *   macOS TCC (privacy framework) attributes getUserMedia requests to the
 *   process that spawned Chrome (node), not to the Chrome bundle itself.
 *   The permission is silently denied and the audio stream produces silence.
 *   File-based audio testing works fine. For live mic validation use a
 *   regular browser session opened manually.
 */

import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve APP_ROOT from env or cwd
const APP_ROOT = process.env.APP_ROOT || process.cwd();

// Resolve playwright from APP_ROOT's node_modules (not this script's location)
const require = createRequire(path.join(APP_ROOT, 'package.json'));
const { chromium } = require('playwright');
const { resolveMetroPort, webViewport } = require(path.join(__dirname, 'lib/runtime-config.cjs'));

// Read a value from agentic.conf
function readConf(key, fallback) {
    const confPath = path.join(APP_ROOT, 'scripts/agentic/agentic.conf');
    try {
        const content = fs.readFileSync(confPath, 'utf8');
        const match = content.match(new RegExp(`^${key}=(\\S+)`, 'm'));
        return match ? match[1] : fallback;
    } catch {
        return fallback;
    }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = resolveMetroPort(process.env, readConf('AGENTIC_PORT', '7365'));
const HEADLESS = process.env.WEB_HEADLESS === 'true';
const DEFAULT_TIMEOUT = 30000;
const TIMEOUT = Number.parseInt(process.env.WEB_TIMEOUT || String(DEFAULT_TIMEOUT), 10);
const NAVIGATION_ATTEMPTS = 10;
const NAVIGATION_RETRY_MS = 2000;
const STARTUP_TIMEOUT = Number.parseInt(process.env.WEB_STARTUP_TIMEOUT || String(
  DEFAULT_TIMEOUT * 2 + TIMEOUT * NAVIGATION_ATTEMPTS + NAVIGATION_RETRY_MS * (NAVIGATION_ATTEMPTS - 1)
), 10);
const CDP_PORT = Number.parseInt(process.env.CDP_PORT || readConf('AGENTIC_CDP_PORT', '9222'), 10);

const AGENT_DIR = path.join(APP_ROOT, '.agent');
const CONNECTION_FILE = path.join(AGENT_DIR, 'web-browser.json');
const BROWSER_PID_FILE = process.env.WEB_BROWSER_PID_FILE;
const CONSOLE_LOG_FILE = path.join(AGENT_DIR, 'web-console.log');
const SCREENSHOT_DIR = path.join(AGENT_DIR, 'screenshots');

function ensureDirs() {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Connection persistence
// ---------------------------------------------------------------------------

function saveConnection(cdpPort, browserPid) {
  ensureDirs();
  fs.writeFileSync(
    CONNECTION_FILE,
    JSON.stringify({ cdpPort, appPort: PORT, pid: process.pid, browserPid, browserPidFile: BROWSER_PID_FILE }, null, 2)
  );
}

function readPidFile(file) {
  return Number(fs.readFileSync(file, 'utf8').trim());
}

function notifyParent(message) {
  if (process.connected) process.send(message, () => {});
}

async function getBrowserPid(browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const pid = processInfo.find(info => info.type === 'browser')?.id;
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Chrome browser PID unavailable');
    return pid;
  } finally {
    await session.detach();
  }
}

function loadConnection() {
  if (!fs.existsSync(CONNECTION_FILE)) {
    throw new Error(
      'No running browser found. Start one with: node scripts/agentic/web-browser.mjs launch'
    );
  }
  return JSON.parse(fs.readFileSync(CONNECTION_FILE, 'utf8'));
}

function clearConnection(ownerPid = process.pid) {
  if (!fs.existsSync(CONNECTION_FILE)) return;
  const connection = loadConnection();
  if (connection.pid !== ownerPid) return;
  fs.unlinkSync(CONNECTION_FILE);
  const pidFile = connection.browserPidFile;
  if (pidFile && fs.existsSync(pidFile) && readPidFile(pidFile) === connection.browserPid) {
    fs.unlinkSync(pidFile);
  }
}

// ---------------------------------------------------------------------------
// Console log capture
// ---------------------------------------------------------------------------

function setupConsoleCapture(page) {
  ensureDirs();
  fs.writeFileSync(CONSOLE_LOG_FILE, '');

  page.on('console', (msg) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${msg.type()}] ${msg.text()}\n`;
    fs.appendFileSync(CONSOLE_LOG_FILE, line);
  });

  page.on('pageerror', (err) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [ERROR] ${err.message}\n`;
    fs.appendFileSync(CONSOLE_LOG_FILE, line);
  });
}

// ---------------------------------------------------------------------------
// Wait for __AGENTIC__ bridge
// ---------------------------------------------------------------------------

async function waitForBridge(page) {
  await page.waitForFunction(
    () => globalThis.__AGENTIC__ !== undefined,
    { timeout: TIMEOUT }
  );
}

// ---------------------------------------------------------------------------
// Server mode: launch
// ---------------------------------------------------------------------------

function terminateLauncher(child) {
  const snapshot = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid='], { encoding: 'utf8' });
  const processes = (snapshot.stdout ?? '').trim().split('\n').map(line => {
    const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
    return { pid, ppid, pgid };
  });
  // Only groups led by descendants of this live child belong to this launch.
  if (processes.some(row => row.pid === child.pid && row.ppid === process.pid)) {
    const owned = new Set([child.pid]);
    let count;
    do {
      count = owned.size;
      for (const row of processes) if (owned.has(row.ppid)) owned.add(row.pid);
    } while (owned.size !== count);
    for (const row of processes.reverse()) {
      if (owned.has(row.pid) && row.pid === row.pgid) {
        try { process.kill(-row.pgid, 'SIGKILL'); } catch {}
      }
    }
  }
  child.kill('SIGKILL');
}

async function launchDaemon() {
  const waitForBrowser = process.argv.includes('--wait-browser');
  const waitForReady = waitForBrowser || process.argv.includes('--wait');
  const logFile = path.join(AGENT_DIR, 'web-browser.log');
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: waitForReady ? ['ignore', logFd, logFd, 'ipc'] : ['ignore', logFd, logFd],
    env: { ...process.env, _WEB_BROWSER_DAEMON: '1' },
  });
  fs.closeSync(logFd);
  if (!waitForReady) {
    child.unref();
    console.log('Browser launching in background. Logs → .agent/web-browser.log');
    return;
  }
  let shutdownTimer;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    child.kill('SIGTERM');
    shutdownTimer ??= setTimeout(() => terminateLauncher(child), 2000);
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    await new Promise((resolve, reject) => {
      let ready = false;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; cancel(); }, STARTUP_TIMEOUT);
      child.on('message', message => {
        if (cancelled || (message !== 'ready' && !(waitForBrowser && message === 'browser-ready'))) return;
        ready = true;
        clearTimeout(timer);
        resolve();
      });
      child.once('exit', code => {
        clearTimeout(timer);
        clearTimeout(shutdownTimer);
        if (!ready) reject(new Error(timedOut ? 'Browser startup timed out' : `Browser exited before readiness (${code})`));
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
  child.disconnect();
  child.unref();
  console.log('Browser ready in background. Logs → .agent/web-browser.log');
  return;
}

async function cmdLaunch() {
  ensureDirs();

  if (!process.env._WEB_BROWSER_DAEMON) return launchDaemon();

  const baseURL = `http://localhost:${PORT}`;

  console.log(`Launching browser (headless=${HEADLESS}, cdpPort=${CDP_PORT})...`);
  console.log(`Connecting to Expo web at ${baseURL}`);

  const launchArgs = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--window-size=${webViewport.width},${webViewport.height}`,
    '--force-device-scale-factor=1',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ];
  const launchOptions = {
    headless: HEADLESS,
    args: launchArgs,
  };
  if (process.env.WEB_BROWSER_CHANNEL || !HEADLESS) {
    launchOptions.channel = process.env.WEB_BROWSER_CHANNEL || 'chrome';
  }
  let browser;
  let browserPid;
  let stopping = false;
  let stopped;
  const stopSignal = new Promise(resolve => { stopped = resolve; });
  const shutdown = async () => {
    stopping = true;
    try { await browser?.close(); } finally { stopped(); }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    browser = await chromium.launch({ ...launchOptions, timeout: DEFAULT_TIMEOUT });
    if (stopping) return;
    browserPid = await getBrowserPid(browser);
    if (BROWSER_PID_FILE) {
      fs.mkdirSync(path.dirname(BROWSER_PID_FILE), { recursive: true });
      fs.writeFileSync(BROWSER_PID_FILE, `${browserPid}\n`);
    }
    notifyParent('browser-ready');

    const context = await browser.newContext({
      viewport: null,
    });

    await context.grantPermissions(['microphone'], { origin: `http://localhost:${PORT}` });

    const page = await context.newPage();
    // Size the native window: a detached CDP client can clear viewport emulation.
    const windowSession = await context.newCDPSession(page);
    const { windowId, bounds } = await windowSession.send('Browser.getWindowForTarget');
    const content = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await windowSession.send('Browser.setWindowBounds', { windowId, bounds: {
      width: bounds.width + webViewport.width - content.width,
      height: bounds.height + webViewport.height - content.height,
    } });
    await windowSession.detach();

    await page.addInitScript(() => {
      const _AC = window.AudioContext || window.webkitAudioContext;
      if (_AC) {
        window.AudioContext = class extends _AC {
          constructor(opts) {
            super(opts);
            if (this.state === 'suspended') {
              this.resume().catch(() => {});
            }
          }
        };
        if (window.webkitAudioContext) {
          window.webkitAudioContext = window.AudioContext;
        }
      }
    });

    setupConsoleCapture(page);

    // Retry page.goto — Metro may still be starting up
    for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt++) {
      try {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }); // NOSONAR: navigation retries must finish in sequence on the same page.
        break;
      } catch (err) {
        if (stopping) return;
        if (attempt === NAVIGATION_ATTEMPTS) throw err;
        console.log(`Waiting for web server (attempt ${attempt}/${NAVIGATION_ATTEMPTS})...`);
        await new Promise(r => setTimeout(r, NAVIGATION_RETRY_MS));
      }
    }

    console.log('Waiting for __AGENTIC__ bridge...');
    try {
      await waitForBridge(page);
    } catch {
      if (stopping) return;
      console.error(
        'ERROR: __AGENTIC__ bridge not found. Is the app running in __DEV__ mode?'
      );
      throw new Error('App bridge did not become ready');
    }

    const platform = await page.evaluate(() => globalThis.__AGENTIC__?.platform);
    console.log(`Bridge connected (platform=${platform})`);

    saveConnection(CDP_PORT, browserPid);
    notifyParent('ready');
    console.log('Browser running. Use other commands to interact, or "close" to stop.');

    await stopSignal;
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    clearConnection();
    await browser?.close();
    if (stopping) process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Command mode: connect to existing browser via CDP
// ---------------------------------------------------------------------------

async function connectBrowser(timeout = DEFAULT_TIMEOUT) {
  const cdpUrl = process.env.CDP_URL;
  const endpoint = cdpUrl || `http://localhost:${loadConnection().cdpPort}`;
  const browser = await chromium.connectOverCDP(endpoint, { timeout });
  try {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('No browser contexts found. Browser may have been closed.');
    }
    const pages = contexts[0].pages();
    if (pages.length === 0) {
      throw new Error('No pages found. Browser may have been closed.');
    }
    return { browser, page: pages[0] };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function checkBrowserLiveness() {
  if (BROWSER_PID_FILE && fs.existsSync(BROWSER_PID_FILE)) {
    try { process.kill(readPidFile(BROWSER_PID_FILE), 0); }
    catch (error) { if (error.code === 'ESRCH') throw new Error('Chrome exited before app readiness'); }
  }
}

async function cmdWaitReady() {
  const deadline = Date.now() + STARTUP_TIMEOUT;
  while (Date.now() < deadline) {
    checkBrowserLiveness();
    let attached;
    try {
      const connection = loadConnection();
      const expectedPid = BROWSER_PID_FILE ? readPidFile(BROWSER_PID_FILE) : connection.browserPid;
      if (expectedPid === connection.browserPid) {
        attached = await connectBrowser(500); // NOSONAR: readiness retries must close each connection before opening another.
        if (await getBrowserPid(attached.browser) === expectedPid) { // NOSONAR: verify ownership before reading the route on this connection.
          const route = await attached.page.evaluate(() => globalThis.__AGENTIC__?.getRoute?.());
          if (route?.pathname) return { ready: true, route };
        }
      }
    } catch {
      // The current launcher may not have published its ready connection yet.
    } finally {
      await attached?.browser.close();
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('App bridge readiness timed out');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdNavigate(args) {
  const routePath = args[0];
  if (!routePath) {
    throw new Error('Usage: navigate <path>  (e.g. /(tabs)/record, /minimal)');
  }

  const { browser, page } = await connectBrowser();
  try {
    const previousRoute = await page.evaluate(
      () => globalThis.__AGENTIC__?.getRoute()
    );

    await page.evaluate(
      (p) => globalThis.__AGENTIC__?.navigate(p),
      routePath
    );

    await page.waitForTimeout(500);

    const currentRoute = await page.evaluate(
      () => globalThis.__AGENTIC__?.getRoute()
    );

    return {
      navigated: routePath,
      previousRoute,
      currentRoute,
      platform: 'web',
    };
  } finally {
    await browser.close();
  }
}

async function cmdGetRoute() {
  const { browser, page } = await connectBrowser();
  try {
    return await page.evaluate(() => globalThis.__AGENTIC__?.getRoute());
  } finally {
    await browser.close();
  }
}

async function cmdGetState() {
  const { browser, page } = await connectBrowser();
  try {
    return await page.evaluate(() => globalThis.__AGENTIC__?.getState());
  } finally {
    await browser.close();
  }
}

async function cmdEval(args) {
  const expression = args.join(' ');
  if (!expression) {
    throw new Error('Usage: eval <expression>');
  }

  const { browser, page } = await connectBrowser();
  try {
    return await page.evaluate((expr) => {
      // eslint-disable-next-line no-eval
      return eval(expr);
    }, expression);
  } finally {
    await browser.close();
  }
}

async function cmdCanGoBack() {
  const { browser, page } = await connectBrowser();
  try {
    return await page.evaluate(() => globalThis.__AGENTIC__?.canGoBack());
  } finally {
    await browser.close();
  }
}

async function cmdGoBack() {
  const { browser, page } = await connectBrowser();
  try {
    await page.evaluate(() => globalThis.__AGENTIC__?.goBack());
    await page.waitForTimeout(300);
    const route = await page.evaluate(() => globalThis.__AGENTIC__?.getRoute());
    return { currentRoute: route };
  } finally {
    await browser.close();
  }
}

async function cmdScreenshot(args) {
  const label = args[0] || 'screenshot';
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  const filename = `${timestamp}_${label}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  const { browser, page } = await connectBrowser();
  try {
    await page.screenshot({ path: filepath, fullPage: false });

    const files = fs
      .readdirSync(SCREENSHOT_DIR)
      .filter((f) => f.endsWith('.png'))
      .sort()
      .reverse();
    for (const f of files.slice(20)) {
      fs.unlinkSync(path.join(SCREENSHOT_DIR, f));
    }

    return filepath;
  } finally {
    await browser.close();
  }
}

async function cmdLogs() {
  if (!fs.existsSync(CONSOLE_LOG_FILE)) {
    return '(no console logs captured yet)';
  }
  return fs.readFileSync(CONSOLE_LOG_FILE, 'utf8');
}

async function cmdClose() {
  // Teardown hooks call close whether or not a browser is up; nothing to stop is success.
  if (!fs.existsSync(CONNECTION_FILE)) return { closed: true, wasRunning: false };
  const conn = loadConnection();
  if (conn.pid) {
    try {
      process.kill(conn.pid, 'SIGTERM');
    } catch {
      // Process may already be dead
    }
  }
  clearConnection(conn.pid);
  return { closed: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const COMMANDS = {
  launch: { fn: cmdLaunch, printRaw: false },
  'wait-ready': { fn: cmdWaitReady, printRaw: false },
  navigate: { fn: cmdNavigate, printRaw: false },
  'get-route': { fn: cmdGetRoute, printRaw: false },
  'get-state': { fn: cmdGetState, printRaw: false },
  eval: { fn: cmdEval, printRaw: false },
  'can-go-back': { fn: cmdCanGoBack, printRaw: false },
  'go-back': { fn: cmdGoBack, printRaw: false },
  screenshot: { fn: cmdScreenshot, printRaw: true },
  logs: { fn: cmdLogs, printRaw: true },
  close: { fn: cmdClose, printRaw: false },
};

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '--help' || command === '-h') {
  console.log(`Web Browser Bridge — Playwright-based browser manager for web agentic loop

Usage:
  node scripts/agentic/web-browser.mjs <command> [args...]

Commands:
  launch [--wait|--wait-browser] Start browser; optionally await app or Chrome readiness
  wait-ready                Wait for the current owned app bridge
  navigate <path>           Navigate to a route (Expo Router path)
  get-route                 Get current route path
  get-state                 Get audio recorder state
  eval <expression>         Evaluate arbitrary JS in app context
  can-go-back               Check if navigation can go back
  go-back                   Navigate back
  screenshot [label]        Take a screenshot
  logs                      Print captured console logs
  close                     Close browser, cleanup

Environment:
  WATCHER_PORT    Expo web dev server port (default: ${PORT})
  WEB_HEADLESS    Run browser headless (default: false, set to "true" for CI)
  WEB_TIMEOUT     Navigation/wait timeout in ms (default: 30000)
  WEB_STARTUP_TIMEOUT  Overall readiness budget in ms (default: all stages and retries)
  WEB_BROWSER_PID_FILE  Optional farm Chrome PID file
  CDP_PORT        Chrome remote debugging port (default: 9222)
  CDP_URL         External Chrome CDP URL (e.g. http://192.168.1.5:9222)
                  Bypasses .agent/web-browser.json for command mode`);
  process.exit(0);
}

const cmd = COMMANDS[command];
if (!cmd) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(1);
}

if (command === 'launch') {
  await cmd.fn();
} else {
  const result = await cmd.fn(args.slice(1));

  if (cmd.printRaw) {
    console.log(typeof result === 'string' ? result : JSON.stringify(result));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}
