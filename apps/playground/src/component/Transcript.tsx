import React, { useEffect, useRef, useMemo } from 'react'

import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native'
import type { ScrollViewInstance } from 'react-native'

import type { AppTheme } from '@siteed/design-system'
import { useTheme } from '@siteed/design-system'
import type { Chunk, TranscriberData } from '@siteed/audio-studio'

import { formatDuration } from '../utils/utils'

interface TranscriptProps {
    transcribedData: TranscriberData | TranscriberData[] | undefined
    showActions?: boolean
    currentTimeMs?: number
    isPlaying?: boolean
    isBusy?: boolean
    onSelectChunk?: (_: { chunk: Chunk }) => void
    useScrollView?: boolean
}

export default function Transcript({
    transcribedData,
    isPlaying,
    isBusy,
    onSelectChunk,
    currentTimeMs,
    showActions = true,
    useScrollView = false,
}: TranscriptProps) {
    const theme = useTheme()
    const styles = useMemo(() => getStyles({ theme }), [theme])
    const scrollViewRef = useRef<ScrollViewInstance | null>(null)

    const handleChunkPress = (chunk: Chunk) => {
        if (onSelectChunk) {
            onSelectChunk({ chunk })
        }
    }

    const chunks = Array.isArray(transcribedData)
        ? transcribedData.flatMap((data) => data.chunks)
        : (transcribedData?.chunks ?? [])

    useEffect(() => {
        if (!isPlaying && isBusy && scrollViewRef.current && useScrollView) {
            scrollViewRef.current.scrollToEnd({ animated: true })
        }
    }, [transcribedData, currentTimeMs, isPlaying, isBusy, useScrollView])

    const ContentWrapper = useScrollView ? ScrollView : View

    return (
        <View style={styles.container}>
            <ContentWrapper
                ref={useScrollView ? scrollViewRef : undefined}
                style={styles.contentWrapper}
                contentContainerStyle={
                    useScrollView ? styles.contentWrapper : undefined
                }
            >
                {chunks.length > 0 ? (
                    <View style={styles.chunksContainer}>
                        {chunks.map((chunk, i) => {
                            const currentTime = currentTimeMs
                                ? currentTimeMs / 1000
                                : 0
                            const isActive =
                                chunk.timestamp[0] <= currentTime &&
                                currentTime <
                                    (chunk.timestamp[1] ?? chunk.timestamp[0])

                            return (
                                <TouchableOpacity
                                    key={`${i}-${chunk.text}`}
                                    onPress={() => handleChunkPress(chunk)}
                                    style={[
                                        styles.chunkContainer,
                                        isActive && styles.activeChunkContainer,
                                    ]}
                                >
                                    <View style={styles.chunkContent}>
                                        <Text style={styles.timestamp}>
                                            {formatDuration(
                                                chunk.timestamp[0] * 1000
                                            )}
                                            {chunk.timestamp[1]
                                                ? ` - ${formatDuration(
                                                      chunk.timestamp[1] * 1000
                                                  )}`
                                                : ''}
                                        </Text>
                                        <Text style={styles.chunkText}>
                                            {chunk.text}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            )
                        })}
                    </View>
                ) : isBusy ? (
                    <Text style={styles.emptyText}>Transcribing...</Text>
                ) : (
                    <Text style={styles.emptyText}>No transcription yet</Text>
                )}
            </ContentWrapper>

            {showActions && (
                <View style={styles.buttonContainer}>
                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => {
                            const text = chunks
                                .map((chunk) => chunk.text)
                                .join('')
                                .trim()
                            const blob = new Blob([text], {
                                type: 'text/plain',
                            })
                            const url = URL.createObjectURL(blob)
                            const link = document.createElement('a')
                            link.href = url
                            link.download = 'transcript.txt'
                            link.click()
                            URL.revokeObjectURL(url)
                        }}
                    >
                        <Text style={styles.buttonText}>Export TXT</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.button}
                        onPress={() => {
                            const jsonData = JSON.stringify(
                                chunks,
                                null,
                                2
                            ).replace(
                                /(\s{4}"timestamp": )\[\s+(\S+)\s+(\S+)\s+\]/gm,
                                '$1[$2 $3]'
                            )
                            const blob = new Blob([jsonData], {
                                type: 'application/json',
                            })
                            const url = URL.createObjectURL(blob)
                            const link = document.createElement('a')
                            link.href = url
                            link.download = 'transcript.json'
                            link.click()
                            URL.revokeObjectURL(url)
                        }}
                    >
                        <Text style={styles.buttonText}>Export JSON</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    )
}

const getStyles = ({ theme }: { theme: AppTheme }) => StyleSheet.create({
    container: {
        width: '100%',
        backgroundColor: theme.colors.surface,
    },
    contentWrapper: {
        flexGrow: 1,
    },
    chunksContainer: {
        paddingVertical: theme.padding.s,
    },
    chunkContainer: {
        marginBottom: theme.margin.s,
        backgroundColor: theme.colors.background,
        borderRadius: theme.roundness,
        padding: theme.padding.s,
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    chunkContent: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    activeChunkContainer: {
        backgroundColor: theme.colors.primaryContainer,
    },
    timestamp: {
        marginRight: theme.margin.s,
        minWidth: 80,
        fontSize: 12,
        color: theme.colors.onSurfaceVariant,
    },
    chunkText: {
        flex: 1,
        fontSize: 14,
        color: theme.colors.onSurface,
        lineHeight: 20,
    },
    emptyText: {
        textAlign: 'center',
        padding: theme.padding.m,
        color: theme.colors.onSurfaceVariant,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        padding: theme.padding.m,
        paddingTop: theme.padding.s,
        backgroundColor: theme.colors.background,
        borderTopWidth: 1,
        borderTopColor: theme.colors.outlineVariant,
    },
    button: {
        backgroundColor: theme.colors.primary,
        borderRadius: theme.roundness,
        paddingVertical: theme.padding.s,
        paddingHorizontal: theme.padding.m,
        marginLeft: theme.margin.s,
    },
    buttonText: {
        color: theme.colors.onPrimary,
        fontSize: 14,
        fontWeight: '500',
    },
})
