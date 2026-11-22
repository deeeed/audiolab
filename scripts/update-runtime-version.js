#!/usr/bin/env node

/**
 * Updates the runtimeVersion in app.config.ts to match the version in package.json
 * This ensures OTA updates work correctly with our versioning system
 */
const fs = require('fs');
const path = require('path');

// Only an app directory under apps/ is accepted; the default is the playground.
const appsRoot = path.join(__dirname, '../apps');
const requestedAppPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(appsRoot, 'playground');
const appName = fs.readdirSync(appsRoot).find((name) => path.join(appsRoot, name) === requestedAppPath);
if (!appName) {
  console.error('❌ The app directory must be one of the apps under apps/.');
  process.exit(1);
}
const appDirectory = path.join(appsRoot, appName);

// Get the package version
const packageJsonPath = path.join(appDirectory, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('❌ The package version must be a valid semver version.');
  process.exit(1);
}

console.log('\n📦 Preparing the runtime version update\n');

// Check for unreleased changes in CHANGELOG.md
const changelogPath = path.join(appDirectory, 'CHANGELOG.md');
let hasUnreleasedChanges = false;

if (fs.existsSync(changelogPath)) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  
  // Check if there's content in the Unreleased section
  const unreleasedMatch = changelog.match(/## \[Unreleased\]\s+\n([^#]*)/);
  if (unreleasedMatch && unreleasedMatch[1].trim()) {
    hasUnreleasedChanges = true;
  }
}

if (!hasUnreleasedChanges) {
  console.warn('⚠️  WARNING: No unreleased changes found in CHANGELOG.md');
  console.warn('   Consider adding changes to the [Unreleased] section before updating.');
  console.warn('   Example format:');
  console.warn('');
  console.warn('   ## [Unreleased]');
  console.warn('');
  console.warn('   ### Added');
  console.warn('   - New feature description');
  console.warn('');
  console.warn('   ### Fixed');
  console.warn('   - Bug fix description');
  console.warn('');
  
  // Prompt for continuation
  if (process.stdout.isTTY) {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    readline.question('Continue anyway? (y/N): ', (answer) => {
      if (answer.toLowerCase() !== 'y') {
        console.log('❌ Update aborted. Please update CHANGELOG.md first.');
        process.exit(1);
      }
      
      updateRuntimeVersionAndChangelog();
      readline.close();
    });
  } else {
    // In non-interactive environments, continue anyway
    console.warn('Continuing without changelog updates (non-interactive mode)');
    updateRuntimeVersionAndChangelog();
  }
} else {
  updateRuntimeVersionAndChangelog();
}

function updateRuntimeVersionAndChangelog() {
  try {
    // Update app.config.ts to use the package version as runtimeVersion
    const appConfigPath = path.join(appDirectory, 'app.config.ts');
    let appConfig = fs.readFileSync(appConfigPath, 'utf8');

    // Check if runtimeVersion already matches
    const currentRuntimeVersionMatch = appConfig.match(/runtimeVersion: ['"]([^'"]*)['"]/);
    const currentRuntimeVersion = currentRuntimeVersionMatch ? currentRuntimeVersionMatch[1] : null;

    if (currentRuntimeVersion === version) {
      console.log(`✅ runtimeVersion in app.config.ts already set to ${version}`);
    } else {
      // Replace the hardcoded runtimeVersion with the current package version
      appConfig = appConfig.replace(
        /runtimeVersion: ['"].*['"]/,
        `runtimeVersion: '${version}'`
      );

      fs.writeFileSync(appConfigPath, appConfig);
      console.log('✅ Updated runtimeVersion in app.config.ts');
    }

    // Update CHANGELOG.md if there are unreleased changes
    if (hasUnreleasedChanges) {
      let changelog = fs.readFileSync(changelogPath, 'utf8');
      const today = new Date().toISOString().slice(0, 10);
      
      // Move content from Unreleased to a new version section
      changelog = changelog.replace(
        /## \[Unreleased\]\s+\n([^#]*)/,
        `## [Unreleased]\n\n\n## [${version}] - ${today}\n$1`
      );
      
      // Update the comparison links at the bottom
      const linkPattern = /\[unreleased\]: .+?HEAD/;
      const oldVersionMatch = changelog.match(/\[([0-9.]+)\]: .+?audio-playground@.+?\.\.\..+?HEAD/);
      
      if (oldVersionMatch && linkPattern.test(changelog)) {
        const oldVersion = oldVersionMatch[1];
        
        changelog = changelog.replace(
          linkPattern,
          `[unreleased]: https://github.com/deeeed/audiolab/compare/audio-playground@${version}...HEAD`
        );
        
        // Add new version comparison link if needed
        if (!changelog.includes(`[${version}]:`)) {
          const newLink = `\n[${version}]: https://github.com/deeeed/audiolab/compare/audio-playground@${oldVersion}...audio-playground@${version}`;
          
          // Insert after the unreleased link
          changelog = changelog.replace(
            /(\[unreleased\]: .+?HEAD)/,
            `$1${newLink}`
          );
        }
      } else {
        console.warn('⚠️ Could not update comparison links in CHANGELOG.md - format may be incorrect');
      }
      
      fs.writeFileSync(changelogPath, changelog);
      console.log(`✅ Updated CHANGELOG.md with version ${version}`);
    }

    console.log('Runtime version: %s', version);
    console.log('\n🚀 Version update complete! Next steps:');
    console.log('1. Review the changes in app.config.ts and CHANGELOG.md');
    console.log('2. Run OTA update command: yarn ota-update:production');
    console.log('3. Commit changes with message: "chore: bump version to ' + version + '"');

  } catch (error) {
    console.error('\n❌ Error updating version information:');
    console.error(error.message);
    process.exit(1);
  }
}
