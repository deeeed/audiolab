import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const appRoot = path.resolve(__dirname, '..')

function readJson(file: string) {
    return JSON.parse(readFileSync(file, 'utf8'))
}

// Resolve each `cd <dir> && yarn <script>` step of build:deps to the package it runs in.
function buildDepsSteps() {
    const script: string = readJson(path.join(appRoot, 'package.json')).scripts['build:deps']
    let cwd = appRoot
    const steps: { dir: string; script: string }[] = []
    for (const part of script.split('&&').map((step) => step.trim())) {
        const cd = part.match(/^cd (.+)$/)
        if (cd) {
            cwd = path.resolve(cwd, cd[1])
            continue
        }
        const run = part.match(/^yarn (\S+)$/)
        assert.ok(run, `unexpected build:deps step: ${part}`)
        steps.push({ dir: cwd, script: run[1] })
    }
    return steps
}

// The web bundle imports these packages' lib/ output. Yarn 4 skips workspace
// prepare scripts on install, so build:deps is the only thing that rebuilds it.
for (const name of ['sherpa-onnx.rn', 'moonshine.rn']) {
    test(`build:deps rebuilds the ${name} lib/ the playground imports`, () => {
        const dir = path.resolve(appRoot, '../../packages', name)
        const manifest = readJson(path.join(dir, 'package.json'))
        const step = buildDepsSteps().find((entry) => entry.dir === dir)

        assert.ok(step, `build:deps never builds packages/${name}`)
        assert.match(manifest.scripts[step.script], /\bbob build\b/)
        assert.match(manifest.main, /^\.\/lib\//)
    })
}
