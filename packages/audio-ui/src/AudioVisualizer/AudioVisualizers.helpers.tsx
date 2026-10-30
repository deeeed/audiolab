// playground/src/component/audio-visualizer/audio-visualiser.helpers.tsx
import { SkPath } from '@shopify/react-native-skia'
import { DimensionValue } from 'react-native'
import { withSpring } from 'react-native-reanimated'

import {
    CANDLE_ACTIVE_AUDIO_COLOR,
    CANDLE_ACTIVE_SPEECH_COLOR,
    CANDLE_OFFCANVAS_COLOR,
    CANDLE_SELECTED_COLOR,
    DEFAULT_LABEL_COLOR,
    DEFAULT_TICK_COLOR,
} from '../constants'
import {
    CalculateReferenceLinePositionParams,
    DrawDottedLineParams,
    SyncTranslateXParams,
    UpdateActivePointsParams,
    UpdateActivePointsResult,
} from './AudioVisualiser.types'
import { buildPath } from '../utils/buildPath'

export const calculateReferenceLinePosition = ({
    canvasWidth,
    referenceLinePosition,
}: CalculateReferenceLinePositionParams): number => {
    if (referenceLinePosition === 'RIGHT') {
        return canvasWidth - 15
    }
    return canvasWidth / 2 // Default to MIDDLE
}

export const createDefaultTheme = (
    canvasWidth: number,
    referenceLineX: number
) => ({
    container: {
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
    },
    navigationContainer: {
        width: '100%' as DimensionValue,
        alignItems: 'center' as const,
    },
    canvasContainer: {
        width: canvasWidth,
        backgroundColor: '#292a2d',
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        gap: 5,
    },
    referenceLine: {
        position: 'absolute' as const,
        top: 0,
        bottom: 0,
        left: referenceLineX,
        width: 2,
        backgroundColor: 'red',
    },
    text: {
        color: 'black',
    },
    button: {},
    buttonText: {},
    dottedLineColor: 'grey',
    yAxis: {
        tickColor: DEFAULT_TICK_COLOR,
        labelColor: DEFAULT_LABEL_COLOR,
    },
    timeRuler: {
        tickColor: DEFAULT_TICK_COLOR,
        labelColor: DEFAULT_LABEL_COLOR,
    },
    candle: {
        activeAudioColor: CANDLE_ACTIVE_AUDIO_COLOR,
        activeSpeechColor: CANDLE_ACTIVE_SPEECH_COLOR,
        offcanvasColor: CANDLE_OFFCANVAS_COLOR,
        selectedColor: CANDLE_SELECTED_COLOR,
    },
})

export const syncTranslateX = ({
    currentTime,
    durationMs,
    maxTranslateX,
    translateX,
}: SyncTranslateXParams) => {
    if (durationMs) {
        const currentTimeInMs = currentTime * 1000 // Convert currentTime to milliseconds
        const progressRatio = currentTimeInMs / durationMs
        const allowedTranslateX = maxTranslateX
        const x = -(progressRatio * allowedTranslateX)
        translateX.value = withSpring(x, {
            damping: 20, // Adjust damping for smoother effect
            stiffness: 90, // Adjust stiffness for smoother effect
        })

        return x
    }
    return translateX.value
}

export const drawDottedLine = ({
    canvasWidth,
    canvasHeight,
}: DrawDottedLineParams): SkPath => {
    const dashLength = 5 // Increased from 3 for better visibility
    const gapLength = 5
    const baseline = canvasHeight / 2

    return buildPath((path) => {
        // Ensure we start from 0 and cover the entire width
        for (let x = 0; x <= canvasWidth; x += dashLength + gapLength) {
            path.moveTo(x, baseline)
            path.lineTo(x + dashLength, baseline)
        }
    })
}

export const updateActivePoints = ({
    x,
    logger,
    context,
}: UpdateActivePointsParams): UpdateActivePointsResult => {
    const {
        dataPoints,
        activePoints,
        maxDisplayedItems,
        referenceLineX,
        mode,
        range,
        candleWidth,
        candleSpace,
    } = context

    if (dataPoints.length === 0) {
        return { activePoints, range, lastUpdatedTranslateX: x }
    }

    logger?.debug(
        `Updating active points x=${x}, mode=${mode}, dataPoints.length=${dataPoints.length}, activePoints.length=${activePoints.length}, referenceLineX=${referenceLineX}, maxDisplayedItems=${maxDisplayedItems}`
    )

    const result: UpdateActivePointsResult = {
        activePoints: [],
        range: {
            start: 0,
            end: 0,
            startVisibleIndex: 0,
            endVisibleIndex: 0,
        },
        lastUpdatedTranslateX: x,
    }
    let lastPointIndex = -1

    if (mode === 'live') {
        const totalItems = dataPoints.length
        const liveMaxDisplayedItems = Math.floor(
            referenceLineX / (candleWidth + candleSpace)
        )
        const startIndex = Math.max(0, totalItems - liveMaxDisplayedItems)

        const updatedPoints = [...activePoints]
        let addedPointsCount = 0

        const lastUpdatedPointId =
            activePoints[activePoints.length - 1]?.id ?? -1
        logger?.log(
            `Last updated point ID: ${lastUpdatedPointId} activePoints.length=${activePoints.length}`
        )
        // TODO: can we have a single pass on the data instead of first searching for the last updated point? Worst case is O(n) currently.
        // find lastPointIndex by searching for lastUpdatedPointId from the end
        for (let i = dataPoints.length - 1; i >= 0; i--) {
            if (dataPoints[i]!.id === lastUpdatedPointId) {
                lastPointIndex = i
                break
            }
        }
        logger?.log(`Last point index: ${lastPointIndex}`)
        for (let i = 0; i < liveMaxDisplayedItems; i++) {
            const itemIndex = startIndex + i
            const dataPoint = dataPoints[itemIndex]
            if (!dataPoint) {
                break
            }
            if (itemIndex > lastPointIndex) {
                updatedPoints.push({
                    ...dataPoint,
                    visible: true,
                })
                addedPointsCount++
            }
        }
        logger?.log(
            `Live mode: Updated ${updatedPoints.length} active points`,
            updatedPoints
        )

        // Ensure activePoints does not exceed liveMaxDisplayedItems
        const finalUpdatedPoints = updatedPoints.slice(-liveMaxDisplayedItems)
        result.activePoints = [...finalUpdatedPoints]

        logger?.log(
            `Live mode: Updated ${finalUpdatedPoints.length} active points`,
            finalUpdatedPoints
        )
        logger?.log(`Number of new points added: ${addedPointsCount}`)
    } else {
        const translateX = Math.abs(x)
        const rawHiddenItemsLeft = Math.floor(
            translateX / (candleWidth + candleSpace)
        )
        // We always display from middle of screen
        const itemsOffset = Math.floor(maxDisplayedItems / 2)
        const hiddenItemsLeft = Math.max(0, rawHiddenItemsLeft - itemsOffset) // Can't be negative

        // allow for maxDisplayedItems to be hidden on the left
        const startIndex = Math.max(0, hiddenItemsLeft - maxDisplayedItems)
        const startVisibleIndex =
            startIndex + Math.min(hiddenItemsLeft, maxDisplayedItems)

        const endIndex = startIndex + maxDisplayedItems * 3
        const endVisibleIndex = startVisibleIndex + maxDisplayedItems

        // Ensure loopTo does not exceed the maximum number of active points
        const loopTo = maxDisplayedItems * 3

        for (let i = 0; i < loopTo; i++) {
            const itemIndex = startIndex + i
            const dataPoint = dataPoints[itemIndex]

            if (dataPoint) {
                const visible =
                    itemIndex >= startVisibleIndex &&
                    itemIndex <= endVisibleIndex
                activePoints[i] = {
                    ...dataPoint,
                    visible,
                }
            } else {
                activePoints[i] = {
                    amplitude: 0,
                    id: -1,
                    visible: false,
                    dB: 0,
                    silent: false,
                    rms: 0,
                }
            }
        }
        result.activePoints = [...activePoints]
        result.range = {
            start: startIndex,
            end: endIndex,
            startVisibleIndex,
            endVisibleIndex,
        }
        logger?.debug(
            `Range updated: start=${startIndex}, end=${endIndex}, startVisibleIndex=${startVisibleIndex}, endVisibleIndex=${endVisibleIndex}`
        )
    }

    logger?.debug(
        `Active points updated. First point ID: ${activePoints[0]?.id}, Last point ID: ${activePoints[activePoints.length - 1]?.id}`
    )

    return result
}
