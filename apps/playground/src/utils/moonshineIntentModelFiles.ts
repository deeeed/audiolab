export function getMoonshineIntentFiles(variant: string, platform: string): string[] {
    if (variant === 'q4' || variant === 'q8' || variant === 'quantized') {
        const name = variant === 'q4' ? 'model_q4' : 'model_quantized'
        // Android 0.1.5 uses ORT; the pinned iOS core uses ONNX external data.
        return platform === 'android'
            ? [`${name}.ort`, 'tokenizer.bin']
            : [`${name}.onnx`, `${name}.onnx_data`, 'tokenizer.bin']
    }
    throw new Error(`Unsupported Moonshine intent model variant: ${variant}`)
}
