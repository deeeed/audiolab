import React, { useCallback, useMemo } from 'react'

import { ScrollView, StyleSheet, View } from 'react-native'
import { ProgressBar, SegmentedButtons } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { AppTheme } from '@siteed/design-system'
import { Button, LabelSwitch, Notice, NumberAdjuster, ScreenWrapper, Text, useTheme } from '@siteed/design-system'

import { PCMPlayer } from '../../component/PCMPlayer'
import { TranscriberConfig } from '../../component/TranscriberConfig'
import Transcript from '../../component/Transcript'
import { TranscriptionHistoryList } from '../../component/TranscriptionHistoryList'
import { EXTRACT_DURATION_OPTIONS, useAudioTranscription } from '../../hooks/useAudioTranscription'
import { useSampleAudio } from '../../hooks/useSampleAudio'

import type { SelectedFile } from '../../hooks/useAudioTranscription'

const getStyles = ({ theme, insets }: { theme: AppTheme, insets?: { bottom: number, top: number } }) => {
    return StyleSheet.create({
        container: {
            gap: theme.spacing.gap,
            paddingHorizontal: theme.padding.s,
            paddingBottom: insets?.bottom || 80,
            paddingTop: 0,
        },
        progressContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.gap,
            marginTop: theme.margin.m,
        },
        progressText: {
            minWidth: 48,
        },
        progressBar: {
            flex: 1,
            height: 8,
        },
        resultText: {
            marginTop: theme.margin.s,
        },
        logsContainer: {
            marginTop: theme.margin.m,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.roundness,
        },
        logsTitle: {
            fontSize: 16,
            fontWeight: 'bold',
            marginBottom: theme.margin.s,
        },
        logItem: {
            padding: theme.padding.s,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.outlineVariant,
            gap: theme.spacing.gap,
        },
        processingContainer: {
            marginTop: theme.margin.m,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.roundness,
            alignItems: 'center',
        },
        processingTitle: {
            fontSize: 16,
            fontWeight: 'bold',
            marginBottom: theme.margin.s,
        },
        processingTime: {
            marginBottom: theme.margin.s,
        },
        extractionSection: {
            marginTop: theme.margin.m,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.roundness,
            gap: theme.spacing.gap,
        },
        sectionTitle: {
            fontSize: 16,
            fontWeight: 'bold',
            marginBottom: theme.margin.s,
        },
        transcriptContainer: {
            marginTop: theme.margin.m,
            padding: theme.padding.m,
            backgroundColor: theme.colors.primaryContainer,
            borderRadius: theme.roundness,
            elevation: 2,
        },
        transcriptTitle: {
            fontSize: 18,
            fontWeight: 'bold',
            marginBottom: theme.margin.s,
            color: theme.colors.onPrimaryContainer,
        },
        transcriptContent: {
            backgroundColor: theme.colors.surface,
            padding: theme.padding.m,
            borderRadius: theme.roundness,
        },
        transcriptText: {
            fontSize: 16,
            lineHeight: 24,
        },
        fileInfoContainer: {
            marginTop: theme.margin.m,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surfaceVariant,
            borderRadius: theme.roundness,
        },
        fileInfoTitle: {
            fontSize: 16,
            fontWeight: 'bold',
            marginBottom: theme.margin.s,
        },
        fileInfoContent: {
            gap: theme.spacing.gap / 2,
        },
        fileInfoName: {
            fontSize: 15,
            fontWeight: '500',
            marginBottom: 4,
        },
        fileInfoDetails: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing.gap,
        },
        fileInfoDetail: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
        },
        fileInfoLabel: {
            fontWeight: '500',
            color: theme.colors.onSurfaceVariant,
        },
        logSection: {
            marginBottom: theme.margin.s,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.outlineVariant,
            paddingBottom: theme.padding.s,
        },
        logSectionTitle: {
            fontSize: 15,
            fontWeight: '600',
            marginBottom: 8,
            color: theme.colors.primary,
        },
        logDetail: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            paddingVertical: 2,
        },
        logLabel: {
            fontWeight: '500',
            marginRight: 8,
            color: theme.colors.onSurfaceVariant,
        },
        comparisonContainer: {
            marginTop: theme.margin.m,
            padding: theme.padding.s,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.roundness,
        },
        comparisonHeader: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: theme.margin.s,
        },
        comparisonTitle: {
            fontSize: 16,
            fontWeight: 'bold',
        },
    })
}

export function TranscriptionScreen() {
    const theme = useTheme()
    const { bottom, top } = useSafeAreaInsets()
    const styles = useMemo(() => getStyles({ theme, insets: { bottom, top } }), [theme, bottom, top])

    const {
        // State
        transcriptionData,
        isTranscribing,
        isExtracting,
        progress,
        stopTranscription,
        selectedFile,
        extractDuration,
        customDuration,
        isCustomDuration,
        audioExtracted,
        extractedAudioData,
        currentProcessingTime,
        lastTranscriptionLog,
        autoTranscribeOnSelect,
        
        // Actions
        setExtractDuration,
        setCustomDuration,
        setIsCustomDuration,
        setAutoTranscribeOnSelect,
        startTranscription,
        handleStop,
        handleExtractAudio,
        handleFileSelection,
        resetTranscriptionState,
    } = useAudioTranscription()
    
    const { isLoading: isSampleLoading, loadSampleAudio } = useSampleAudio({
        onError: (error) => {
            console.error('Error loading sample audio file:', error)
        },
    })
    
    const handleLoadSampleAudio = useCallback(async () => {
        try {
            // Reset state before loading new sample
            resetTranscriptionState()
            
            // Load the sample audio
            const sampleFile = await loadSampleAudio(require('@assets/jfk.mp3'))
            
            if (!sampleFile) {
                throw new Error('Failed to load sample audio file')
            }
            
            // Create a SelectedFile object from the sample file
            const selectedFileInfo: SelectedFile = {
                uri: sampleFile.uri,
                size: sampleFile.size,
                name: 'JFK Speech Sample',
                duration: sampleFile.durationMs / 1000,
                fileType: 'mp3',
            }
            
            // We can use the existing handleExtractAudio function which accepts a file parameter
            // This will set the selectedFile state internally and then extract the audio
            handleExtractAudio({ 
                file: selectedFileInfo, 
                duration: isCustomDuration ? customDuration : extractDuration, 
            })
            
        } catch (error) {
            console.error('Error loading sample audio:', error)
        }
    }, [handleExtractAudio, loadSampleAudio, resetTranscriptionState, isCustomDuration, customDuration, extractDuration])

    return (
        <ScreenWrapper
            withScrollView
            useInsets={false}
            contentContainerStyle={styles.container}
            testID="transcription-scroll"
        >
            <Notice
                type="info"
                title="Audio Transcription"
                message="Select an audio file, extract audio data, and transcribe it to text. You can customize extraction duration and view the transcription results."
            />

            <LabelSwitch
                label="Auto-transcribe on file selection"
                value={autoTranscribeOnSelect}
                onValueChange={setAutoTranscribeOnSelect}
                containerStyle={{
                    backgroundColor: theme.colors.surface,
                    marginBottom: 10,
                }}
            />

            <TranscriberConfig 
                compact
                onConfigChange={resetTranscriptionState}
            />

            <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                    testID="select-audio-file-button"
                    mode="contained"
                    onPress={handleFileSelection}
                    disabled={isTranscribing}
                    style={{ flex: 1 }}
                    icon="file-upload"
                >
                    Select Audio File
                </Button>

                <Button
                    testID="load-sample-audio-button"
                    mode="contained-tonal"
                    onPress={handleLoadSampleAudio}
                    disabled={isTranscribing || isSampleLoading}
                    loading={isSampleLoading}
                    icon="music-box"
                >
                    Load Sample
                </Button>
            </View>

            {selectedFile && (
                <View style={styles.fileInfoContainer}>
                    <Text style={styles.fileInfoTitle}>Selected File</Text>
                    <View style={styles.fileInfoContent}>
                        <Text style={styles.fileInfoName}>{selectedFile.name}</Text>
                        <View style={styles.fileInfoDetails}>
                            <View style={styles.fileInfoDetail}>
                                <Text style={styles.fileInfoLabel}>Size:</Text>
                                <Text>{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</Text>
                            </View>
                            {selectedFile.duration ? (
                                <View style={styles.fileInfoDetail}>
                                    <Text style={styles.fileInfoLabel}>Duration:</Text>
                                    <Text>{selectedFile.duration.toFixed(1)}s</Text>
                                </View>
                            ) : null}
                            {selectedFile.fileType ? (
                                <View style={styles.fileInfoDetail}>
                                    <Text style={styles.fileInfoLabel}>Format:</Text>
                                    <Text>{selectedFile.fileType.toUpperCase()}</Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                </View>
            )}

            {selectedFile && (
                <>
                    <View style={styles.extractionSection}>
                        <Text style={styles.sectionTitle}>Audio Extraction Options</Text>
                        
                        <ScrollView 
                            horizontal 
                            showsHorizontalScrollIndicator
                            contentContainerStyle={{ paddingBottom: 8 }}
                        >
                            <SegmentedButtons
                                value={isCustomDuration ? 'custom' : extractDuration.toString()}
                                onValueChange={(value) => {
                                    if (value === 'custom') {
                                        setIsCustomDuration(true)
                                        resetTranscriptionState()
                                    } else {
                                        setIsCustomDuration(false)
                                        setExtractDuration(parseInt(value, 10))
                                        resetTranscriptionState()
                                    }
                                }}
                                buttons={[
                                    ...EXTRACT_DURATION_OPTIONS
                                        .filter((option) => 
                                            option.value === -1 || // Always include 'Full' option
                                            (selectedFile.duration && option.value <= selectedFile.duration * 1000) // Convert duration to ms
                                        )
                                        .map((option) => ({
                                            value: option.value.toString(),
                                            label: option.label,
                                        })),
                                    { value: 'custom', label: 'Custom' },
                                ]}
                            />
                        </ScrollView>
                        
                        {isCustomDuration && (
                            <NumberAdjuster
                                label="Custom Duration (ms)"
                                value={customDuration}
                                onChange={(value) => {
                                    setCustomDuration(value)
                                    resetTranscriptionState()
                                }}
                                min={1000}
                                max={600000}
                                step={1000}
                                disabled={isExtracting || isTranscribing}
                            />
                        )}
                        
                        <Button
                            testID="extract-audio-button"
                            mode="contained-tonal"
                            onPress={() => handleExtractAudio({})}
                            loading={isExtracting}
                            disabled={isTranscribing || !selectedFile}
                            style={{ marginTop: 10 }}
                        >
                            {isExtracting ? 'Extracting...' : 'Extract Audio Data'}
                        </Button>
                    </View>
                    
                    {audioExtracted && extractedAudioData && (
                        <View style={styles.extractionSection}>
                            <Text style={styles.sectionTitle}>Extracted Audio Preview</Text>
                            <Text>
                                Duration: {(extractedAudioData.durationMs / 1000).toFixed(2)}s | 
                                Sample Rate: {extractedAudioData.sampleRate}Hz | 
                                Channels: {extractedAudioData.channels}
                            </Text>
                            {extractedAudioData.pcmData && (
                                <PCMPlayer 
                                    data={extractedAudioData.pcmData} 
                                    sampleRate={extractedAudioData.sampleRate} 
                                    bitDepth={16}
                                    channels={extractedAudioData.channels}
                                    hasWavHeader={extractedAudioData.hasWavHeader}
                                />
                            )}
                        </View>
                    )}
                    
                    <Button
                        testID="start-transcription-button"
                        mode="contained"
                        onPress={startTranscription}
                        loading={isTranscribing}
                        disabled={
                            isExtracting || isTranscribing || !selectedFile ||
                            !audioExtracted || !extractedAudioData
                        }
                    >
                        {isTranscribing ? 'Transcribing...' : 'Start Transcription'}
                    </Button>
                </>
            )}

            {isTranscribing && stopTranscription && (
                <Button
                    testID="stop-transcription-button"
                    mode="contained"
                    onPress={handleStop}
                    style={{ marginTop: 10 }}
                >
                    Stop Transcription
                </Button>
            )}

            {isTranscribing && (
                <View style={styles.processingContainer}>
                    <Text style={styles.processingTitle}>
                        Transcribing...
                    </Text>
                    <Text style={styles.processingTime}>
                        Time: {currentProcessingTime}s
                    </Text>
                    <View style={styles.progressContainer}>
                        <Text style={styles.progressText}>
                            {Math.round(progress)}%
                        </Text>
                        <ProgressBar
                            progress={progress / 100}
                            style={styles.progressBar}
                        />
                    </View>
                </View>
            )}

            {selectedFile && (
                <Transcript
                    testID="transcription-transcript"
                    transcribedData={transcriptionData}
                    isBusy={isTranscribing}
                    showActions={false}
                    useScrollView={false}
                />
            )}

            {lastTranscriptionLog && (
                <View style={{ marginTop: theme.margin.m }}>
                    <TranscriptionHistoryList 
                        currentLog={lastTranscriptionLog} 
                        useVirtualizedList={false}
                    />
                </View>
            )}
        </ScreenWrapper>
    )
}

export default TranscriptionScreen
