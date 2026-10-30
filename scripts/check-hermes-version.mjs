#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixedHermesVersion = '260318099.0.5'
const workspaces = ['apps', 'packages'].flatMap((group) => {
    const dir = path.join(root, group)
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name))
})

let checked = 0
const failures = []

for (const workspace of workspaces) {
    const rnDir = path.join(workspace, 'node_modules', 'react-native')
    const rnPackagePath = path.join(rnDir, 'package.json')
    const propertiesPath = path.join(
        rnDir,
        'sdks',
        'hermes-engine',
        'version.properties'
    )
    const tagPath = path.join(rnDir, 'sdks', '.hermesv1version')
    const compilerPath = path.join(
        workspace,
        'node_modules',
        'hermes-compiler',
        'package.json'
    )
    if (!fs.existsSync(rnPackagePath)) continue
    checked += 1

    const missing = [propertiesPath, tagPath, compilerPath]
        .filter((file) => !fs.existsSync(file))
        .map((file) => path.relative(root, file))
    if (missing.length > 0) {
        failures.push(
            `${path.relative(root, workspace)}: missing ${missing.join(', ')}`
        )
        continue
    }

    const properties = Object.fromEntries(
        fs
            .readFileSync(propertiesPath, 'utf8')
            .trim()
            .split('\n')
            .map((line) => line.split('=', 2))
    )
    // RN 0.88 ships Hermes V1 as its only engine and writes just HERMES_VERSION_NAME.
    const runtime =
        properties.HERMES_V1_VERSION_NAME ?? properties.HERMES_VERSION_NAME
    const compiler = JSON.parse(fs.readFileSync(compilerPath, 'utf8')).version
    const tag = fs.readFileSync(tagPath, 'utf8').trim()

    if (
        runtime !== fixedHermesVersion ||
        compiler !== fixedHermesVersion ||
        tag !== `hermes-v${fixedHermesVersion}`
    ) {
        failures.push(
            `${path.relative(root, workspace)}: runtime=${runtime}, compiler=${compiler}, tag=${tag}`
        )
    }
}

if (checked === 0)
    failures.push('no React Native workspace installations found')
if (failures.length > 0) {
    console.error(`FAIL: Hermes versions differ\n${failures.join('\n')}`)
    process.exit(1)
}

console.log(
    `OK: fixed Hermes ${fixedHermesVersion} runtime, tag, and compiler match in ${checked} workspaces.`
)
