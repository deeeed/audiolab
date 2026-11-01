import {
    Group,
    Path,
    SkFont,
    Text as SkiaText,
} from '@shopify/react-native-skia'
import React, { useEffect, useMemo } from 'react'
import { useDerivedValue, useSharedValue } from 'react-native-reanimated'

import { buildPath } from '../utils/buildPath'

/**
 * Decibel measurement formats:
 * - dBFS (Decibels relative to Full Scale): Range from -∞ to 0 dB, where 0 dB is the maximum digital level
 * - dB SPL (Sound Pressure Level): Typically 0 to 120+ dB, where 0 dB is the threshold of hearing
 * - dBA (A-weighted Sound Pressure Level): Similar to dB SPL but weighted to match human hearing sensitivity
 * - dBC (C-weighted Sound Pressure Level): Similar to dB SPL with less filtering than dBA
 */
export type DecibelFormat = 'dBFS' | 'dB SPL' | 'dBA' | 'dBC'

export interface DecibelGaugeTheme {
    minDb: number
    maxDb: number
    backgroundColor?: string
    strokeWidth?: number
    size?: {
        width: number
        height: number
        radius?: number
    }
    colors: {
        needle: string
        progress: string
        high: string
        tickMarks?: string
    }
    text?: {
        color?: string
        size?: number
        xOffset?: number
        yOffset?: number
        showUnit?: boolean
    }
    strokeCap?: 'butt' | 'round' | 'square'
}

/**
 * Default theme for the DecibelGauge component.
 * Customize colors, sizes, and ranges based on your specific decibel format:
 * - For dBFS: typically use minDb: -60, maxDb: 0
 * - For dB SPL/dBA/dBC: typically use minDb: 30, maxDb: 120
 */
export const defaultDecibelGaugeTheme: DecibelGaugeTheme = {
    minDb: -60,
    maxDb: 0,
    backgroundColor: '#666666',
    strokeWidth: 20,
    size: {
        width: 300,
        height: 220,
        radius: 80,
    },
    colors: {
        needle: '#007AFF',
        progress: '#FFD60A',
        high: '#FF453A',
    },
    text: {
        color: '#FFFFFF',
        size: 16,
        xOffset: 0,
        yOffset: 100,
        showUnit: true,
    },
    strokeCap: 'butt', // Changed to 'butt' for precise arc ending
}

/**
 * DecibelGauge component for visualizing audio levels.
 * By default, expects input values in dBFS format (common in digital audio processing).
 */
export interface DecibelGaugeProps {
    db: number // Input value in decibels
    inputFormat?: DecibelFormat // Format of the input value (default: dBFS)
    outputFormat?: DecibelFormat // Optional: convert to this format for display
    theme?: Partial<DecibelGaugeTheme>
    showTickMarks?: boolean
    showValue?: boolean
    showUnit?: boolean
    showNeedle?: boolean
    font?: SkFont | null
}

/**
 * Converts decibel values between different measurement formats.
 *
 * Note: These conversions are approximations and may need adjustment
 * based on specific equipment, calibration, or measurement contexts.
 * In professional audio applications, exact conversions should be
 * determined through proper calibration.
 */
function convertDecibels({
    value,
    fromFormat,
    toFormat,
}: {
    value: number
    fromFormat: DecibelFormat
    toFormat: DecibelFormat
}): number {
    if (fromFormat === toFormat) return value

    // Example conversions (you would need to implement accurate conversions based on your needs)
    if (fromFormat === 'dBFS' && toFormat === 'dB SPL') {
        // Assuming a reference level of about 83-85 dB SPL = 0 dBFS
        return value + 85
    }

    if (fromFormat === 'dB SPL' && toFormat === 'dBFS') {
        return value - 85
    }

    // Add other conversion pairs as needed

    // Default fallback - no conversion
    return value
}

/**
 * Formats a decibel value for display.
 * For UI consistency, all values are displayed with the generic "dB" unit
 * regardless of the actual format being used for measurement/calculation.
 */
function formatDecibelValue({
    value,
    showUnit = true,
}: {
    value: number
    format?: DecibelFormat // Keep for internal use but don't use for display
    showUnit?: boolean
}): string {
    const formattedValue = Math.round(value).toString()
    // Always display just "dB" regardless of the actual format
    return showUnit ? `${formattedValue} dB` : formattedValue
}

export function DecibelGauge({
    db,
    inputFormat = 'dBFS',
    outputFormat,
    theme,
    showValue = true,
    showTickMarks = false,
    showUnit = true,
    showNeedle = true,
    font,
}: DecibelGaugeProps) {
    const mergedTheme = useMemo(
        () => ({ ...defaultDecibelGaugeTheme, ...theme }),
        [theme]
    )
    const { minDb, maxDb } = mergedTheme

    const radius = mergedTheme.size!.radius ?? 80
    const centerX = mergedTheme.size!.width / 2
    const centerY = radius + 20 // Shift arc upward

    const dbShared = useSharedValue(db)

    const animatedProgress = useDerivedValue(() => {
        'worklet'
        const normalizedValue = Math.max(minDb, Math.min(maxDb, dbShared.value))
        return (normalizedValue - minDb) / (maxDb - minDb)
    }, [minDb, maxDb])

    const GAUGE_START_ANGLE = 135 // Start at bottom-left
    const GAUGE_SWEEP_ANGLE = 270 // Sweep 270 degrees

    const needleTransform = useDerivedValue(() => {
        'worklet'
        const normalizedValue = Math.max(
            0,
            Math.min(1, (dbShared.value - minDb) / (maxDb - minDb))
        )
        const rotation =
            (GAUGE_START_ANGLE + normalizedValue * GAUGE_SWEEP_ANGLE) *
            (Math.PI / 180)
        return [{ rotate: rotation }]
    }, [dbShared, minDb, maxDb])

    // Define arrow parameters
    const arrowLength = 10
    const arrowWidth = 5

    // Needle line path (stops before the arrowhead)
    const needleLinePath = useMemo(() => {
        return buildPath((path) => {
            path.moveTo(centerX, centerY)
            path.lineTo(centerX + radius - arrowLength, centerY)
        })
    }, [centerX, centerY, radius, arrowLength])

    // Arrowhead path (filled triangle)
    const arrowheadPath = useMemo(() => {
        return buildPath((path) => {
            path.moveTo(centerX + radius - arrowLength, centerY - arrowWidth)
            path.lineTo(centerX + radius, centerY)
            path.lineTo(centerX + radius - arrowLength, centerY + arrowWidth)
            path.close()
        })
    }, [centerX, centerY, radius, arrowLength, arrowWidth])

    // Thicker center dot
    const needleBaseDot = useMemo(() => {
        return buildPath((path) => {
            path.addCircle(centerX, centerY, 8) // Increased from 5 to 8
        })
    }, [centerX, centerY])

    const gaugePath = useMemo(() => {
        return buildPath((path) => {
            path.addArc(
                {
                    x: centerX - radius,
                    y: centerY - radius,
                    width: radius * 2,
                    height: radius * 2,
                },
                GAUGE_START_ANGLE,
                GAUGE_SWEEP_ANGLE
            )
        })
    }, [centerX, centerY, radius])

    const TICK_COUNT = 5
    const tickAngles = Array.from({ length: TICK_COUNT }, (_, i) => {
        const normalized = i / (TICK_COUNT - 1)
        return GAUGE_START_ANGLE + normalized * GAUGE_SWEEP_ANGLE
    })

    const tickPaths = tickAngles.map((angle) => {
        const tickStartRadius = radius - 5
        const tickEndRadius = radius + 5
        const startX =
            centerX + tickStartRadius * Math.cos((angle * Math.PI) / 180)
        const startY =
            centerY + tickStartRadius * Math.sin((angle * Math.PI) / 180)
        const endX = centerX + tickEndRadius * Math.cos((angle * Math.PI) / 180)
        const endY = centerY + tickEndRadius * Math.sin((angle * Math.PI) / 180)
        return buildPath((tickPath) => {
            tickPath.moveTo(startX, startY)
            tickPath.lineTo(endX, endY)
        })
    })

    // Calculate the display value based on format conversion if needed
    const displayDb = useMemo(() => {
        if (outputFormat && inputFormat !== outputFormat) {
            return convertDecibels({
                value: db,
                fromFormat: inputFormat,
                toFormat: outputFormat,
            })
        }
        return db
    }, [db, inputFormat, outputFormat])

    // Update this where the value text is created, passing in fewer parameters
    const valueText = showValue
        ? formatDecibelValue({
              value: displayDb,
              showUnit: showUnit && mergedTheme.text?.showUnit !== false,
          })
        : ''

    useEffect(() => {
        dbShared.value = db
    }, [db])

    return (
        <Group>
            <Path
                path={gaugePath}
                strokeWidth={mergedTheme.strokeWidth}
                color={mergedTheme.backgroundColor}
                style="stroke"
                strokeCap={mergedTheme.strokeCap}
            />
            <Path
                path={gaugePath}
                strokeWidth={mergedTheme.strokeWidth}
                color={mergedTheme.colors.progress}
                style="stroke"
                start={0}
                end={animatedProgress}
                strokeCap={mergedTheme.strokeCap}
            />
            {showTickMarks &&
                tickPaths.map((path, index) => (
                    <Path
                        key={`tick-${index}`}
                        path={path}
                        color={mergedTheme.colors.tickMarks ?? 'white'}
                        style="stroke"
                        strokeWidth={1}
                    />
                ))}
            {showNeedle && (
                <Group
                    origin={{ x: centerX, y: centerY }}
                    transform={needleTransform}
                >
                    <Path
                        path={needleLinePath}
                        color={mergedTheme.colors.needle}
                        style="stroke"
                        strokeWidth={2}
                    />
                    <Path
                        path={arrowheadPath}
                        color={mergedTheme.colors.needle}
                        style="fill"
                    />
                </Group>
            )}
            {showNeedle && (
                <Path
                    path={needleBaseDot}
                    color={mergedTheme.colors.needle}
                    style="fill"
                />
            )}
            {showValue && font && (
                <SkiaText
                    x={centerX + (mergedTheme.text?.xOffset ?? 0)}
                    y={
                        centerY +
                        (mergedTheme.text?.yOffset ?? (showNeedle ? 100 : 0))
                    }
                    text={valueText}
                    font={font}
                    color={mergedTheme.text?.color ?? '#FFFFFF'}
                />
            )}
        </Group>
    )
}
