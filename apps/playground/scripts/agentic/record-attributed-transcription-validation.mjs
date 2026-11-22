#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getMetroHost } from './metro-host.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const BRIDGE = path.join(APP_ROOT, 'scripts/agentic/cdp-bridge.mjs');
const REPORT_DIR = path.join(APP_ROOT, '.agent', 'reports');
const RECIPE = 'playground.record-attributed-transcription-validation';
const WORDS_ROOT = process.env.AMI_WORDS_ROOT || '/Volumes/c910ssd/datasets/ami_public_manual_1.6.2/words';
const AMI_AUDIO_ROOT = process.env.AMI_AUDIO_ROOT || '/Volumes/c910ssd/datasets/amicorpus';
const MEETING_ID = process.env.AMI_MEETING_ID || 'IS1001a';
const START_S = Number(process.env.AMI_START_S || 340);
const END_S = Number(process.env.AMI_END_S || 380);
const SERIAL = process.env.ANDROID_SERIAL || process.env.ADB_SERIAL || '';
const DEVICE = process.env.DEVICE_NAME || process.env.BENCHMARK_DEVICE || process.env.AGENTIC_DEVICE || '';
const APP_VARIANT = process.env.APP_VARIANT || 'development';
const BUNDLE_BASE = 'net.siteed.audioplayground';
const SCHEME_BASE = 'audioplayground';
const PKG = APP_VARIANT === 'production' ? BUNDLE_BASE : `${BUNDLE_BASE}.${APP_VARIANT}`;
const DEV_CLIENT_SCHEME =
  process.env.DEV_CLIENT_SCHEME ||
  (APP_VARIANT === 'production'
    ? `exp+${SCHEME_BASE}`
    : `exp+${SCHEME_BASE}-${APP_VARIANT}`);
const METRO_PORT = Number(process.env.WATCHER_PORT || 7365);
const RELATIVE_DEVICE_CLIP = 'benchmarks/record-attributed-validation.wav';
const DEVICE_CLIP = `/data/user/0/${PKG}/files/${RELATIVE_DEVICE_CLIP}`;
const HOST_CLIP = process.env.VALIDATION_HOST_CLIP || `/tmp/${MEETING_ID}-${START_S}-${END_S}-record-attributed.wav`;
const SOURCE_WAV =
  process.env.VALIDATION_SOURCE_WAV ||
  path.join(AMI_AUDIO_ROOT, MEETING_ID, 'audio', `${MEETING_ID}.Mix-Headset.wav`);

fs.mkdirSync(REPORT_DIR, { recursive: true });

function run(command, args, { cwd = REPO_ROOT, parseJson = false, maxBuffer = 50 * 1024 * 1024 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, APP_ROOT },
    maxBuffer,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(output || `${command} ${args.join(' ')} failed`);
  }
  const stdout = (result.stdout || '').trim();
  return parseJson ? (stdout ? JSON.parse(stdout) : null) : stdout;
}

function isMetroOnline() {
  try {
    run('curl', ['-sf', `http://localhost:${METRO_PORT}/status`], {
      cwd: APP_ROOT,
      maxBuffer: 1024 * 1024,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function ensureDevClientOnline() {
  if (isMetroOnline()) return;
  run('yarn', ['android:device:launch'], { cwd: APP_ROOT, maxBuffer: 25 * 1024 * 1024 });
}

function adb(args) {
  return run('adb', SERIAL ? ['-s', SERIAL, ...args] : args);
}

function adbShell(command) {
  return adb(['shell', command]);
}

function bridge(args, parseJson = true) {
  return run('node', DEVICE ? [BRIDGE, '--device', DEVICE, ...args] : [BRIDGE, ...args], {
    cwd: APP_ROOT,
    parseJson,
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureHostClip() {
  if (!fs.existsSync(SOURCE_WAV)) {
    throw new Error(`Missing source WAV: ${SOURCE_WAV}`);
  }
  const durationS = END_S - START_S;
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error(`Invalid AMI window: ${START_S}-${END_S}`);
  }
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(START_S),
    '-t',
    String(durationS),
    '-i',
    SOURCE_WAV,
    '-ac',
    '1',
    '-ar',
    '16000',
    HOST_CLIP,
  ]);
  if (!fs.existsSync(HOST_CLIP) || fs.statSync(HOST_CLIP).size <= 0) {
    throw new Error(`Failed to create host clip: ${HOST_CLIP}`);
  }
}

function stageDeviceClip() {
  adbShell(`run-as ${PKG} sh -c "mkdir -p ${path.posix.dirname(DEVICE_CLIP)} && rm -f ${DEVICE_CLIP}"`);
  run('bash', [
    '-lc',
    `cat ${shellQuote(HOST_CLIP)} | ${SERIAL ? `adb -s ${SERIAL}` : 'adb'} shell "run-as ${PKG} sh -c 'cat > ${DEVICE_CLIP}'"`,
  ]);
  const size = Number(
    adbShell(`run-as ${PKG} sh -c "wc -c < ${DEVICE_CLIP} 2>/dev/null || echo 0"`).trim() || '0'
  );
  if (size <= 0) throw new Error(`Failed to stage clip to ${DEVICE_CLIP}`);
  return size;
}

function readSpeakerWords() {
  if (!fs.existsSync(WORDS_ROOT)) return [];
  const words = [];
  const files = fs
    .readdirSync(WORDS_ROOT)
    .filter((name) => name.startsWith(`${MEETING_ID}.`) && name.endsWith('.words.xml'))
    .sort();
  for (const name of files) {
    const speaker = name.split('.')[1];
    const xml = fs.readFileSync(path.join(WORDS_ROOT, name), 'utf8');
    const wordRegex = /<w\b([^>]*)>([^<]*)<\/w>/g;
    let match = null;
    while ((match = wordRegex.exec(xml))) {
      const attrs = match[1];
      const text = String(match[2] || '').trim();
      if (!text) continue;
      const startMatch = attrs.match(/starttime="([^"]+)"/);
      const endMatch = attrs.match(/endtime="([^"]+)"/);
      if (!startMatch || !endMatch) continue;
      const startS = Number(startMatch[1]);
      const endS = Number(endMatch[1]);
      if (startS >= END_S || endS <= START_S) continue;
      words.push({ speaker, text, startS, endS });
    }
  }
  return words.sort((a, b) => a.startS - b.startS || a.endS - b.endS);
}

function normalizeWords(text) {
  return String(text || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function wer(reference, hypothesis) {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return null;
  return editDistance(ref, hyp) / ref.length;
}

function parseMaybeNestedJson(value) {
  let current = value;
  for (let index = 0; index < 2 && typeof current === 'string'; index += 1) {
    current = JSON.parse(current);
  }
  return current;
}

function renderMarkdown(report) {
  const live = report.result.live;
  const postAsr = report.result.postAsr;
  return [
    '# Record Attributed Transcription Validation',
    '',
    `- Created: ${report.createdAt}`,
    `- Device: ${report.device || 'default CDP target'}`,
    `- Source: ${report.source.meetingId} ${report.source.startS}s-${report.source.endS}s`,
    `- Host clip: \`${report.source.hostClip}\``,
    `- Replay WAV: \`${report.source.replayWav}\``,
    `- Device clip: \`${report.source.deviceClip}\``,
    `- Reference speakers: ${report.reference.speakers.join(', ') || 'n/a'}`,
    '',
    '## Result',
    '',
    '| Stage | Metric | Value |',
    '| --- | --- | ---: |',
    `| Live Moonshine + Sherpa | Moonshine chunks | ${live.moonshineChunks} |`,
    `| Live Moonshine + Sherpa | Sherpa chunks | ${live.sherpaChunks} |`,
    `| Live Moonshine + Sherpa | Sherpa turns | ${live.sherpaTurnCount} |`,
    `| Live Moonshine + Sherpa | Attributed lines | ${live.attributedLineCount} |`,
    `| Live Moonshine + Sherpa | Transcript chars | ${live.transcriptCharCount} |`,
    `| Post-recording Sherpa ASR | Model | ${postAsr.modelId} |`,
    `| Post-recording Sherpa ASR | Segments | ${postAsr.segmentCount ?? 'n/a'} |`,
    `| Post-recording Sherpa ASR | Init | ${postAsr.initMs ?? 'n/a'} ms |`,
    `| Post-recording Sherpa ASR | Recognize | ${postAsr.recognizeMs ?? 'n/a'} ms |`,
    `| Post-recording Sherpa ASR | Transcript chars | ${postAsr.transcriptCharCount} |`,
    `| Post-recording Sherpa ASR | WER vs AMI words | ${report.scores.postAsrWer == null ? 'n/a' : `${(report.scores.postAsrWer * 100).toFixed(1)}%`} |`,
    '',
    '## Notes',
    '',
    '- This recipe injects a staged multi-speaker AMI WAV into the Record tab dev probe, so it validates the same Moonshine + Sherpa hook and UI without relying on laptop-speaker-to-phone-mic acoustics.',
    '- The post-recording row uses the same staged WAV and the segmented Sherpa ASR path; no native API changes are required.',
    `- Replay locally with: \`open ${report.source.replayWav}\``,
    '',
    '## Transcripts',
    '',
    `Reference: ${report.reference.transcript || '(not available)'}`,
    '',
    `Live Moonshine: ${live.finalTranscript || '(empty)'}`,
    '',
    `Post Sherpa ASR: ${postAsr.transcript || '(empty)'}`,
    '',
  ].join('\n');
}

async function waitForBridgeTarget(timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const devices = bridge(['list-devices']);
      if ((devices?.count ?? 0) > 0) return devices;
    } catch (_error) {
      // keep polling
    }
    await sleep(1000);
  }
  throw new Error('Timed out waiting for CDP target');
}

async function restartDevClient() {
  ensureDevClientOnline();
  const metroHost = getMetroHost(SERIAL);
  adb(['shell', 'am', 'force-stop', PKG]);
  adb([
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `${DEV_CLIENT_SCHEME}://expo-development-client/?url=${encodeURIComponent(`http://${metroHost}:${METRO_PORT}`)}`,
    PKG,
  ]);
  await sleep(5000);
  await waitForBridgeTarget();
}

async function main() {
  ensureHostClip();
  const referenceWords = readSpeakerWords();
  const speakers = Array.from(new Set(referenceWords.map((word) => word.speaker)));
  if (referenceWords.length > 0 && speakers.length < 2) {
    throw new Error(`Selected reference window has ${speakers.length} speaker(s); choose a multi-speaker AMI window`);
  }

  await restartDevClient();
  const stagedSize = stageDeviceClip();
  const devices = await waitForBridgeTarget();
  const deviceName = DEVICE || devices?.devices?.[0]?.name || '';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactsDir = `.agent/artifacts/record-attributed-transcription-validation-${timestamp}`;

  run(
    'yarn',
    ['recipe:run', RECIPE, '--platform', 'android', ...(deviceName ? ['--device', deviceName] : []), '--artifacts-dir', artifactsDir],
    { cwd: APP_ROOT, maxBuffer: 50 * 1024 * 1024 }
  );

  const lastResult = parseMaybeNestedJson(
    bridge(['eval', 'JSON.stringify(globalThis.__AGENTIC__?.getLastResult?.() || null)'])
  );
  if (lastResult?.status !== 'success') {
    throw new Error(`Validation did not succeed: ${JSON.stringify(lastResult)}`);
  }

  const referenceTranscript = referenceWords.map((word) => word.text).join(' ').trim();
  const replayWavPath = path.join(REPORT_DIR, `record-attributed-transcription-validation-${timestamp}.wav`);
  fs.copyFileSync(HOST_CLIP, replayWavPath);

  const report = {
    artifactsDir: path.join(APP_ROOT, artifactsDir),
    createdAt: new Date().toISOString(),
    device: deviceName,
    recipe: RECIPE,
    reference: {
      speakerCount: speakers.length,
      speakers,
      transcript: referenceTranscript,
      wordCount: referenceWords.length,
    },
    result: lastResult.result,
    scores: {
      postAsrWer: wer(referenceTranscript, lastResult.result?.postAsr?.transcript),
    },
    source: {
      deviceClip: DEVICE_CLIP,
      hostClip: HOST_CLIP,
      replayWav: replayWavPath,
      meetingId: MEETING_ID,
      sourceWav: SOURCE_WAV,
      stagedSize,
      startS: START_S,
      endS: END_S,
    },
  };

  const jsonPath = path.join(REPORT_DIR, `record-attributed-transcription-validation-${timestamp}.json`);
  const mdPath = path.join(REPORT_DIR, `record-attributed-transcription-validation-${timestamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));

  console.log(JSON.stringify({ json: jsonPath, markdown: mdPath, replayWav: replayWavPath, summary: report.scores, result: report.result }, null, 2));
}

await main();
