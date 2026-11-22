import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkRecipeCheckout({ projectRoot, appRoot, domain }) {
  const checks = [];
  async function inspect(id, file, verify = () => true) {
    try {
      const contents = await fs.readFile(file, 'utf8');
      if (!verify(contents)) throw new Error('Expected recipe wiring is missing');
      checks.push({ id, status: 'pass', message: file });
    } catch (error) {
      checks.push({ id, status: 'fail', message: `${file}: ${error.message}` });
    }
  }
  const cli = path.join(projectRoot, 'scripts/agentic/recipe/run.mjs');
  await inspect('checkout', path.join(projectRoot, 'package.json'), contents => Boolean(JSON.parse(contents).name));
  await inspect('recipe-cli', cli);
  const command = `node ${path.relative(appRoot, cli).split(path.sep).join('/')}`;
  await inspect('app-scripts', path.join(appRoot, 'package.json'), contents => {
    const scripts = JSON.parse(contents).scripts ?? {};
    return ['run', 'validate', 'doctor', 'manifest'].every(name => scripts[`recipe:${name}`] === `${command} ${name}`)
      && scripts.recipe === command;
  });
  await inspect('manifest', path.join(projectRoot, 'scripts/agentic/recipe/action-manifest.json'), contents => Boolean(JSON.parse(contents).actions));
  await inspect('default-recipe', path.join(projectRoot, 'scripts/agentic/recipe/recipes', domain, 'expo.config.recipe.json'), contents => Boolean(JSON.parse(contents).workflow));
  await inspect('bridge-provider', path.join(appRoot, 'src/farmslot/RecipeBridgeProvider.tsx'), contents =>
    /__DEV__\s*&&\s*process\.env\.EXPO_PUBLIC_FARMSLOT_RECIPE_BRIDGE\s*===\s*['"]1['"]/.test(contents));
  await inspect('bridge-layout', path.join(appRoot, 'src/app/_layout.tsx'), contents => /<RecipeBridgeProvider\b/.test(contents));
  await inspect('cdp-bridge', path.join(appRoot, 'scripts/agentic/cdp-bridge.mjs'));
  return checks;
}
