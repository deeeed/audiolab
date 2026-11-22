import assert from 'node:assert/strict'
import test from 'node:test'
import { getMoonshineIntentFiles } from './moonshineIntentModelFiles'

test('uses the ORT-format files required by Moonshine Android 0.1.5', () => {
    assert.deepEqual(getMoonshineIntentFiles('q4', 'android'), [
        'model_q4.ort',
        'tokenizer.bin',
    ])
    assert.deepEqual(getMoonshineIntentFiles('q8', 'android'), [
        'model_quantized.ort',
        'tokenizer.bin',
    ])
    assert.deepEqual(getMoonshineIntentFiles('quantized', 'android'),
        getMoonshineIntentFiles('q8', 'android'))
})

test('includes the external data required by the pinned Moonshine iOS core', () => {
    for (const variant of ['q4', 'q8', 'quantized']) {
        const name = variant === 'q4' ? 'model_q4' : 'model_quantized'
        assert.deepEqual(getMoonshineIntentFiles(variant, 'ios'), [
            `${name}.onnx`, `${name}.onnx_data`, 'tokenizer.bin',
        ])
    }
})

test('rejects removed embedding model variants', () => {
    assert.throws(
        () => getMoonshineIntentFiles('fp32', 'ios'),
        /Unsupported Moonshine intent model variant: fp32/
    )
})
