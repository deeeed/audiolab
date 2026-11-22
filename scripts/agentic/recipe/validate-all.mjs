#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { libraryRoot, repoRoot, createAudiolabHost, recipeApp } from './host.mjs';
const files = (await fs.readdir(path.join(libraryRoot, 'recipes'), { recursive: true })).filter(file => file.endsWith('.recipe.json'));
for (const file of files) {
  const app = recipeApp(file.split('/').join('.'));
  const platform = file.includes('native.lifecycle') ? 'ios' : 'web';
  const host = createAudiolabHost({ app, platform, device: platform });
  await host.runner.preflight(host.request({ recipePath: path.join(libraryRoot, 'recipes', file),
    artifactsDir: path.join(repoRoot, '.agent/validation'),
  }));
  console.log(`PASS ${file}`);
}
console.log(`${files.length} recipes and complete dependency graphs validated without side effects.`);
