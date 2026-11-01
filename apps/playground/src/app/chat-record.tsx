import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Stack } from 'expo-router'
import {
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from 'react-native'
import type { ScrollViewInstance } from 'react-native'
import { Button, SegmentedButtons, Text } from 'react-native-paper'

import {
    AudioPlayerWidget,
    ChatRecordWidget,
    SPEECH_AMPLITUDE_RANGE,
    type ChatRecordWidgetInteraction,
    type ChatRecordWidgetState,
    type WaveformPoint,
} from '@siteed/audio-ui'
import { useSharedAudioRecorder } from '@siteed/audio-studio'
import { Notice, useTheme, useToast } from '@siteed/design-system'

import { baseLogger } from '../config'
import { MoonshinePreloadBanner } from '../components/MoonshinePreloadBanner'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { useMoonshineLiveSession } from '../hooks/useMoonshineLiveSession'
import { useScreenHeader } from '../hooks/useScreenHeader'

const logger = baseLogger.extend('ChatRecordScreen')

// Width of the rolling window that shows the most recent audio while
// recording. 56 bars at the default ChatRecordWidget waveformHeight (36)
// fits an iPhone-width body with ~5px stride — looks like a WhatsApp /
// iMessage voice memo. Bump for wider canvases or denser visualization.
const LIVE_BARS_WINDOW = 56
// Pin the visualizer's amplitude range for live recording so previously
// drawn bars don't rescale when a louder sample arrives. Use the
// audio-ui-shipped speech preset — anyone copying this demo gets the same
// tuning without rediscovering the magic number. Swap to
// MUSIC_AMPLITUDE_RANGE / FULL_AMPLITUDE_RANGE for non-speech use cases.
const LIVE_AMPLITUDE_RANGE = SPEECH_AMPLITUDE_RANGE

interface ChatMessage {
    id: string
    fileUri: string
    durationMs: number
    dataPoints: WaveformPoint[]
    transcript?: string
}

function makeMessageId(): string {
    return `msg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

// Always returns exactly LIVE_BARS_WINDOW bars: the most recent N audio
// points, padded on the left with zero-amplitude "silence" bars when the
// recording is shorter than the window. Without the pad the bar count grows
// from ~10 → 56 over the first six seconds while the canvas width stays
// fixed, so each bar visibly shrinks mid-recording. With the pad, new audio
// always enters from the right at a constant bar width — WhatsApp-style.
function takeLiveWindow(points: WaveformPoint[]): WaveformPoint[] {
    if (points.length >= LIVE_BARS_WINDOW) {
        return points.slice(points.length - LIVE_BARS_WINDOW)
    }
    const padCount = LIVE_BARS_WINDOW - points.length
    const pad: WaveformPoint[] = Array.from({ length: padCount }, (_, i) => ({
        // Negative ids stay in the same numeric space as PreviewBar.id (number)
        // — synthetic string ids would break callers that assume numeric.
        id: -(i + 1),
        amplitude: 0,
        rms: 0,
        silent: true,
    }))
    return pad.concat(points)
}

interface ChatBubbleProps {
    message: ChatMessage
    width: number
    barColor: string
    silentBarColor: string
    silenceBandColor: string
    backgroundColor: string
    accentColor: string
    textColor: string
    statusColor: string
    errorColor: string
    disabledColor: string
    iconColor: string
    playheadColor: string
    onSurfaceColor: string
}

function ChatBubble({
    message,
    width,
    barColor,
    silentBarColor,
    silenceBandColor,
    backgroundColor,
    accentColor,
    textColor,
    statusColor,
    errorColor,
    disabledColor,
    iconColor,
    playheadColor,
    onSurfaceColor,
}: ChatBubbleProps) {
    const playback = useAudioPlayback()
    useEffect(() => {
        playback.load(message.fileUri)
        return () => {
            playback.teardown()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message.fileUri])

    return (
        <View
            style={[styles.bubble, { backgroundColor }]}
            testID={`chat-bubble-${message.id}`}
        >
            <AudioPlayerWidget
                dataPoints={message.dataPoints}
                width={width}
                density="chat"
                showSilenceTrack={false}
                currentTimeMs={playback.currentTimeMs}
                durationMs={playback.durationMs || message.durationMs}
                isPlaying={playback.isPlaying}
                onPlayPause={playback.toggle}
                onSeek={playback.seek}
                barColor={barColor}
                silentBarColor={silentBarColor}
                silenceBandColor={silenceBandColor}
                playheadColor={playheadColor}
                backgroundColor={backgroundColor}
                accentColor={accentColor}
                textColor={textColor}
                statusColor={statusColor}
                errorColor={errorColor}
                disabledColor={disabledColor}
                iconColor={iconColor}
                testID={`chat-bubble-player-${message.id}`}
            />
            {message.transcript ? (
                <Text style={[styles.bubbleTranscript, { color: textColor }]}>
                    {message.transcript}
                </Text>
            ) : null}
            <Text style={[styles.bubbleMeta, { color: onSurfaceColor }]}>
                Voice message · {message.dataPoints.length} bars
            </Text>
        </View>
    )
}

export default function ChatRecordScreen() {
    const { width: windowWidth } = useWindowDimensions()
    const widgetWidth = Math.min(560, Math.max(280, Math.floor(windowWidth - 32)))
    const bubbleWidth = Math.min(widgetWidth, 480)

    const theme = useTheme()
    const colors = theme.colors
    const { show } = useToast()
    const recorder = useSharedAudioRecorder()
    const session = useMoonshineLiveSession({ strategy: 'small-only' })

    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [pending, setPending] = useState<ChatMessage | null>(null)
    const [interaction, setInteraction] = useState<ChatRecordWidgetInteraction>('tap')
    const consumedRecordingRef = useRef<string | null>(null)

    useScreenHeader({
        title: 'Chat Record',
        backBehavior: { fallbackUrl: '/more' },
    })

    // Capture the most recent transcript text as it streams. We keep both
    // committed (final segments) and interim (in-flight) so the chat caption
    // mirrors what the user is actually saying right now.
    const liveTranscript = useMemo(() => {
        const parts = [
            session.liveCommittedText.trim(),
            session.liveInterimText.trim(),
        ].filter(Boolean)
        return parts.join(' ').trim()
    }, [session.liveCommittedText, session.liveInterimText])
    const liveTranscriptRef = useRef('')
    useEffect(() => {
        liveTranscriptRef.current = liveTranscript
    }, [liveTranscript])

    const handleRecordPress = useCallback(async () => {
        if (session.isRecording || session.isStarting || pending) return
        try {
            await session.startSession()
        } catch (e) {
            logger.error('startSession failed', e)
            show({ type: 'error', message: 'Failed to start recording' })
        }
    }, [pending, session, show])

    const handleStopPress = useCallback(async () => {
        if (!session.isRecording) return
        try {
            await session.stopSession()
        } catch (e) {
            logger.error('stopSession failed', e)
        }
    }, [session])

    // useMoonshineLiveSession exposes the AudioRecording asynchronously via
    // `lastRecording` after stopSession resolves. Convert it into a pending
    // chat message exactly once per recording.
    useEffect(() => {
        const recording = session.lastRecording
        if (!recording) return
        if (consumedRecordingRef.current === recording.fileUri) return
        consumedRecordingRef.current = recording.fileUri

        const points = recording.analysisData?.dataPoints ?? []
        const next: ChatMessage = {
            id: makeMessageId(),
            fileUri: recording.fileUri,
            durationMs: Math.max(0, Math.round(recording.durationMs ?? 0)),
            dataPoints: points,
            transcript: liveTranscriptRef.current.trim() || undefined,
        }
        setPending(next)
    }, [session.lastRecording])

    const handleSend = useCallback(() => {
        if (!pending) return
        setMessages((prev) => [...prev, pending])
        setPending(null)
        session.clear()
    }, [pending, session])

    const handleCancel = useCallback(async () => {
        if (session.isRecording) {
            try {
                await session.stopSession()
            } catch (e) {
                logger.error('stopSession during cancel failed', e)
            }
        }
        setPending(null)
        session.clear()
        consumedRecordingRef.current = null
    }, [session])

    const handleRetry = useCallback(() => {
        session.clear()
        setPending(null)
    }, [session])

    const widgetState: ChatRecordWidgetState = useMemo(() => {
        if (session.error) return 'error'
        if (session.isPreparingModels) return 'processing'
        if (session.isStarting || session.isStopping) return 'processing'
        if (pending) return 'ready'
        if (session.isRecording) return 'recording'
        return 'idle'
    }, [
        session.error,
        session.isPreparingModels,
        session.isStarting,
        session.isStopping,
        session.isRecording,
        pending,
    ])

    const liveBars = useMemo(() => {
        if (pending) return pending.dataPoints
        if (session.isRecording) {
            return takeLiveWindow(recorder.analysisData?.dataPoints ?? [])
        }
        return []
    }, [pending, session.isRecording, recorder.analysisData])

    const elapsedMs = pending ? pending.durationMs : recorder.durationMs

    const caption = useMemo(() => {
        if (session.error) return session.error
        if (session.isPreparingModels) {
            return session.statusMessage ?? 'Loading Moonshine model…'
        }
        if (session.isStarting) return 'Starting Moonshine session…'
        if (session.isStopping) return 'Finalizing recording…'
        if (pending) {
            return pending.transcript
                ? `“${pending.transcript}” — tap send or cancel`
                : 'Tap send to deliver, or cancel to discard'
        }
        if (session.isRecording) {
            return liveTranscript || 'Listening…'
        }
        return interaction === 'hold'
            ? 'Press and hold the mic to record'
            : 'Tap the mic to record a voice message'
    }, [
        session.error,
        session.isPreparingModels,
        session.isStarting,
        session.isStopping,
        session.isRecording,
        session.statusMessage,
        pending,
        liveTranscript,
        interaction,
    ])

    const cancelSlot =
        widgetState === 'idle' ? null : (
            <Button
                compact
                mode="text"
                onPress={handleCancel}
                textColor={colors.error}
                testID="chat-record-cancel"
            >
                Cancel
            </Button>
        )

    const sendSlot =
        widgetState === 'ready' ? (
            <Button
                compact
                mode="contained"
                onPress={handleSend}
                testID="chat-record-send"
            >
                Send
            </Button>
        ) : null

    const scrollViewRef = useRef<ScrollViewInstance | null>(null)
    useEffect(() => {
        const t = setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: true })
        }, 50)
        return () => clearTimeout(t)
    }, [messages.length])

    return (
        <View style={[styles.screen, { backgroundColor: colors.background }]}>
            <Stack.Screen options={{ title: 'Chat Record' }} />
            <ScrollView
                ref={scrollViewRef}
                style={styles.flex1}
                contentContainerStyle={styles.messagesContainer}
                testID="chat-record-messages"
            >
                <Notice
                    type="info"
                    title="Chat record demo"
                    message="Live bars roll while you speak; Moonshine streams the transcription as you go. After stopping, send to add the bubble or cancel to discard."
                />
                <MoonshinePreloadBanner />
                <SegmentedButtons
                    value={interaction}
                    onValueChange={(v) =>
                        setInteraction(v as ChatRecordWidgetInteraction)
                    }
                    buttons={[
                        { value: 'tap', label: 'Tap to toggle', icon: 'gesture-tap' },
                        { value: 'hold', label: 'Press & hold', icon: 'gesture-tap-hold' },
                    ]}
                    style={styles.segmented}
                />
                {messages.length === 0 ? (
                    <View
                        style={[
                            styles.emptyState,
                            { borderColor: colors.outlineVariant },
                        ]}
                        testID="chat-record-empty-state"
                    >
                        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
                            No messages yet
                        </Text>
                        <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
                            {interaction === 'hold'
                                ? 'Press and hold the mic to record your first voice note.'
                                : 'Tap the mic to record your first voice note.'}
                        </Text>
                    </View>
                ) : (
                    messages.map((message) => (
                        <ChatBubble
                            key={message.id}
                            message={message}
                            width={bubbleWidth}
                            barColor={colors.primary}
                            silentBarColor={colors.outlineVariant}
                            silenceBandColor={colors.outline}
                            backgroundColor={colors.surfaceVariant}
                            accentColor={colors.primary}
                            textColor={colors.onSurface}
                            statusColor={colors.onSurfaceVariant}
                            errorColor={colors.error}
                            disabledColor={colors.outlineVariant}
                            iconColor={colors.onPrimary}
                            playheadColor={colors.onSurface}
                            onSurfaceColor={colors.onSurfaceVariant}
                        />
                    ))
                )}
            </ScrollView>
            <View
                style={[
                    styles.dock,
                    {
                        backgroundColor: colors.surface,
                        borderTopColor: colors.outlineVariant,
                    },
                ]}
            >
                <ChatRecordWidget
                    state={widgetState}
                    width={widgetWidth}
                    interaction={interaction}
                    dataPoints={liveBars}
                    elapsedMs={elapsedMs}
                    amplitudeRange={LIVE_AMPLITUDE_RANGE}
                    onRecordPress={handleRecordPress}
                    onStopPress={handleStopPress}
                    onRetryPress={handleRetry}
                    cancelSlot={cancelSlot}
                    sendSlot={sendSlot}
                    errorMessage={session.error ?? undefined}
                    placeholderText={
                        interaction === 'hold' ? 'Hold to record' : 'Tap to record'
                    }
                    caption={caption}
                    captionColor={
                        widgetState === 'error' ? colors.error : colors.onSurfaceVariant
                    }
                    barColor={colors.primary}
                    silentBarColor={colors.outlineVariant}
                    backgroundColor={colors.surfaceVariant}
                    accentColor={colors.primary}
                    disabledColor={colors.outlineVariant}
                    iconColor={colors.onPrimary}
                    textColor={colors.onSurface}
                    secondaryTextColor={colors.onSurfaceVariant}
                    errorColor={colors.error}
                    testID="chat-record-widget"
                />
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    flex1: {
        flex: 1,
    },
    messagesContainer: {
        padding: 16,
        gap: 12,
        paddingBottom: 24,
    },
    segmented: {
        marginBottom: 4,
    },
    emptyState: {
        padding: 24,
        borderRadius: 12,
        borderWidth: 1,
        gap: 4,
        alignItems: 'center',
    },
    bubble: {
        padding: 8,
        borderRadius: 16,
        gap: 4,
        alignSelf: 'flex-end',
        maxWidth: '100%',
    },
    bubbleTranscript: {
        fontSize: 14,
        paddingHorizontal: 6,
    },
    bubbleMeta: {
        fontSize: 11,
        paddingLeft: 6,
    },
    dock: {
        padding: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
})
