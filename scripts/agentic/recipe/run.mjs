#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Command } from 'commander';
import { readRecipeCliJsonFileWithinRoot, parseRecipeParamAssignments } from '@farmslot/recipe-runner/cli/support';
import { extractWorkflowGraph } from '@farmslot/recipe-runner';
import { buildDiscoveryIndex, findRecipe, registerDiscoveryCommands } from '@farmslot/recipe-cli';
import { manifest, actionNames, library, repoRoot, createAudiolabHost, recipeApp, appDomain, appRootFor, resolveDevice, matrixDevices, selectMatrixDevice, captureFailureDiagnostics } from './host.mjs';
import { checkRecipeCheckout } from './doctor.mjs';

const args = process.argv.slice(2);

async function discovery(argv) {
  const program = new Command().name('audiolab-recipe');
  registerDiscoveryCommands(program, { commandName: 'audiolab-recipe', handlers: actionNames });
  await program.parseAsync([...argv, '--library', library], { from: 'user' });
}

if (['list', 'actions', 'describe', 'explain', 'search', 'template', 'completions'].includes(args[0])) {
  await discovery(args);
} else if (args[0] === 'manifest') {
  console.log(JSON.stringify(manifest, null, 2));
} else if (args[0] === 'run' && args.includes('--list')) {
  await discovery(['list', ...args.slice(1).filter(arg => arg !== '--list')]);
} else {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    app: { type: 'string' },
    platform: { type: 'string', default: process.env.PLATFORM ?? 'web' },
    device: { type: 'string' }, 'project-root': { type: 'string' }, 'artifacts-dir': { type: 'string' },
    param: { type: 'string', multiple: true }, matrix: { type: 'string' }, step: { type: 'string' },
    'record-video': { type: 'string' }, 'recording-reason': { type: 'string' },
    'dry-run': { type: 'boolean' }, 'no-hud': { type: 'boolean' }, 'update-baselines': { type: 'boolean' }, json: { type: 'boolean' },
    describe: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const [command = 'help', recipeName] = positionals;
  if (command === 'help' || values.help) {
    console.log('Usage: node scripts/agentic/recipe/run.mjs <list|actions|describe|explain|run|validate|doctor|device> [recipe] [--app playground|sherpa-voice] [--platform web|ios|android] [--device name] [--param key=value] [--artifacts-dir path] [--dry-run] [--matrix web,ios,android]');
  } else if (values.describe) {
    await discovery(['describe', recipeName, '--platform', values.platform, ...(values.json ? ['--json'] : [])]);
  } else {
    if (command === 'run' && !values.matrix && !values['dry-run'] && values.device && !values.device.toLowerCase().includes('web') && !process.env.PLATFORM && !args.some(arg => arg === '--platform' || arg.startsWith('--platform='))) throw new Error('Native proof requires --platform ios or android.');
    const projectRoot = path.resolve(values['project-root'] ?? repoRoot);
    const documentPath = path.resolve(recipeName ?? '');
    const isFile = Boolean(recipeName && await fs.stat(documentPath).then(info => info.isFile(), () => false)); // NOSONAR: metadata only; canonical file contents are confined by the SDK reader below.
    const canonicalRoot = isFile ? await fs.realpath(projectRoot) : projectRoot;
    const canonicalDocument = isFile ? await fs.realpath(documentPath) : documentPath;
    const recipeDocument = isFile ? await readRecipeCliJsonFileWithinRoot(canonicalRoot, path.relative(canonicalRoot, canonicalDocument)) : undefined;
    const documentDomain = Object.values(recipeDocument?.workflow?.nodes ?? {}).map(node => recipeApp(node.ref)).find(Boolean);
    const app = values.app ?? recipeApp(recipeName) ?? documentDomain ?? process.env.AUDIOLAB_APP ?? (path.basename(process.cwd()) === 'sherpa-voice' ? 'sherpa-voice' : 'playground');
    const appRoot = appRootFor(projectRoot, app);
    const domain = appDomain(app);
    const params = parseRecipeParamAssignments(values.param ?? []);
    const platforms = (values.matrix ?? values.platform).split(',').map(value => value.trim());
    for (const platform of platforms) {
      if (!['web', 'ios', 'android'].includes(platform)) throw new Error(`Unknown platform: ${platform}`);
    }
    const devices = values.matrix && command === 'run' && !values['dry-run'] ? await matrixDevices(appRoot) : [];
    const matrixTargets = values.matrix && !values['dry-run'] ? new Map(platforms.map(platform => [platform, selectMatrixDevice(platform, devices, values.device)])) : null;
    const missing = matrixTargets ? [...matrixTargets].filter(([, target]) => !target).map(([platform]) => platform) : [];
    if (missing.length) throw new Error(`Matrix run missing device(s) for: ${missing.join(', ')}`);
    const artifactRoot = path.resolve(values['artifacts-dir'] ?? path.join(appRoot, '.agent/artifacts', new Date().toISOString().replaceAll(':', '-')));
    let failed = false;
    for (const platform of platforms) {
      const device = matrixTargets ? matrixTargets.get(platform).name
        : ['validate', 'doctor'].includes(command) || values['dry-run'] ? values.device || platform
        : await resolveDevice({ platform, device: values.device || process.env.FARMSLOT_RECIPE_DEVICE, simulator: process.env.IOS_SIMULATOR, iosDevice: process.env.IOS_DEVICE_UDID, serial: process.env.ADB_SERIAL });
      if (command === 'device') {
        if (!device) throw new Error('No assigned recipe device.');
        console.log(device);
        continue;
      }
      if (!device && command === 'run' && !values['dry-run']) throw new Error('Native proof requires --device or a slot-injected device.');
      const doctorChecks = command === 'doctor' ? await checkRecipeCheckout({ projectRoot, appRoot, domain }) : [];
      if (doctorChecks.some(check => check.status === 'fail')) {
        console.log(JSON.stringify({ runner_protocol_version: 1, status: 'fail', checks: doctorChecks }, null, 2));
        failed = true;
        continue;
      }
      const index = await buildDiscoveryIndex({ libraries: [library], platform, handlers: actionNames });
      const requested = recipeName ?? `${domain}.expo.config`;
      const local = path.resolve(requested);
      const exists = isFile;
      const match = exists ? undefined : await findRecipe(index, requested);
      if (!exists && !match) throw new Error(`Unknown recipe: ${requested}`);
      const host = createAudiolabHost({ app, platform, device, projectRoot,
        updateBaselines: values['update-baselines'],
        noHud: values['no-hud'] || requested.endsWith('expo.config') || requested.endsWith('expo.config.recipe.json'),
      });
      const { runner } = host;
      const recipePath = exists ? local : match.recipe.path;
      let selectedRecipe;
      if (values.step) {
        const root = await fs.realpath(projectRoot);
        const file = await fs.realpath(recipePath);
        const document = await readRecipeCliJsonFileWithinRoot(root, path.relative(root, file));
        if (!document.workflow?.nodes?.[values.step]) throw new Error(`Unknown recipe step: ${values.step}`);
        selectedRecipe = { ...document, workflow: { ...document.workflow, entry: values.step } };
        const retained = extractWorkflowGraph(selectedRecipe).mainNodeIds;
        if (document.workflow.teardown) {
          for (const id of extractWorkflowGraph({ ...document, workflow: { ...document.workflow, entry: document.workflow.teardown } }).mainNodeIds) retained.add(id);
        }
        selectedRecipe.workflow.nodes = Object.fromEntries(Object.entries(document.workflow.nodes).filter(([id]) => retained.has(id)));
        if (document.proofTargets) {
          const linked = new Set(Object.values(selectedRecipe.workflow.nodes).flatMap(node => node.proves ?? []));
          const targets = document.proofTargets.filter(target => linked.has(target.id));
          if (targets.length) selectedRecipe.proofTargets = targets;
          else delete selectedRecipe.proofTargets;
        }
      }
      const request = host.request({ ...(selectedRecipe ? { recipeDocument: selectedRecipe } : { recipePath }),
        artifactsDir: platforms.length > 1 ? path.join(artifactRoot, platform) : artifactRoot,
        params, ...(values['record-video'] ? { recordVideo: values['record-video'], recordingReason: values['recording-reason'] } : {}), ...(values.step ? { stopAfterNode: values.step } : {}),
      });
      if (['validate', 'doctor'].includes(command) || values['dry-run']) {
        const plan = await runner.preflight(request);
        console.log(JSON.stringify(command === 'doctor' ? { runner_protocol_version: 1, status: 'pass', checks: [...doctorChecks, { id: 'recipe-plan', status: 'pass', message: 'Action manifest and complete recipe dependency graph are ready.' }] } : { status: 'pass', app, platform, plan }, null, 2));
      } else if (command === 'run') {
        const result = await runner.run(request);
        console.log(JSON.stringify(result, null, 2));
        if (result.status === 'fail' && device) {
          await captureFailureDiagnostics({ appRoot, device, platform, artifactsDir: request.artifactsDir }).catch(error => console.error(`Diagnostics unavailable: ${error.message}`));
        }
        failed ||= result.status !== 'pass';
      } else throw new Error(`Unknown command: ${command}`);
    }
    if (failed) process.exitCode = 1;
  }
}
