import React, { useCallback, useMemo, useState } from 'react'

import { Canvas, Path, Skia } from '@shopify/react-native-skia'
import { StyleSheet, View } from 'react-native'

import type { SkPath } from '@shopify/react-native-skia'
import type { LayoutChangeEvent } from 'react-native'

const getStyles = (canvasWidth: number) => {
    return StyleSheet.create({
        container: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
        canvas: {
            width: canvasWidth,
            backgroundColor: '#292a2d',
        },
    })
}

interface AudioWaveformPreviewProps {
    waveformBuffer: number[] // Array of waveform data points
    canvasHeight: number // Height of the canvas
    color?: string // Color of the waveform
}

const AudioWaveformPreview: React.FC<AudioWaveformPreviewProps> = ({
    waveformBuffer,
    canvasHeight,
    color = 'white',
}) => {
    const [canvasWidth, setCanvasWidth] = useState(0)

    const handleLayout = useCallback((event: LayoutChangeEvent) => {
        const { width } = event.nativeEvent.layout
        setCanvasWidth(width)
    }, [])

    const drawWaveform = useCallback((): SkPath => {
        const path = Skia.PathBuilder.Make()
        const step = canvasWidth / waveformBuffer.length
        const midY = canvasHeight / 2

        waveformBuffer.forEach((amplitude, index) => {
            const x = index * step
            const y = midY - (amplitude / 255) * midY // Normalize amplitude
            if (index === 0) {
                path.moveTo(x, y)
            } else {
                path.lineTo(x, y)
            }
        })

        return path.detach()
    }, [canvasHeight, canvasWidth, waveformBuffer])

    const styles = useMemo(() => getStyles(canvasWidth), [canvasWidth])

    return (
        <View style={styles.container} onLayout={handleLayout}>
            <Canvas style={[styles.canvas, { height: canvasHeight }]}>
                <Path
                    path={drawWaveform()}
                    color={color}
                    style="stroke"
                    strokeWidth={1}
                />
            </Canvas>
        </View>
    )
}

export default AudioWaveformPreview
