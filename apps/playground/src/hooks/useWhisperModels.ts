import { useState, useCallback } from 'react'

import * as FileSystem from 'expo-file-system/legacy'
import { initWhisper } from 'whisper.rn/index'

import type { WhisperContext } from 'whisper.rn/index'

export interface WhisperModel {
    id: string
    label: string
    url: string
    filename: string
    capabilities: {
        multilingual: boolean
        quantizable: boolean
        tdrz?: boolean  // Optional TDRZ capability for native models
    }
}

export interface WebWhisperModel {
    id: string
    label: string
    capabilities: {
        multilingual: boolean
        quantizable: boolean
    }
}

export const WHISPER_MODELS: WhisperModel[] = [
    {
        id: 'tiny',
        label: 'Tiny (en)',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
        filename: 'ggml-tiny.en.bin',
        capabilities: {
            multilingual: false,
            quantizable: false,
        },
    },
    {
        id: 'base',
        label: 'Base Model',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
        filename: 'ggml-base.bin',
        capabilities: {
            multilingual: false,
            quantizable: false,
        },
    },
    {
        id: 'small',
        label: 'Small (tdrz)',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en-tdrz.bin',
        filename: 'ggml-small.en-tdrz.bin',
        capabilities: {
            multilingual: false,
            quantizable: false,
            tdrz: true,
        },
    },
]

export const WEB_WHISPER_MODELS: WebWhisperModel[] = [
    { 
        id: 'Xenova/whisper-tiny', 
        label: 'Tiny',
        capabilities: {
            multilingual: false,
            quantizable: false,
        },
    },
    { 
        id: 'Xenova/whisper-base', 
        label: 'Base',
        capabilities: {
            multilingual: true,
            quantizable: true,
        },
    },
    { 
        id: 'Xenova/whisper-small', 
        label: 'Small',
        capabilities: {
            multilingual: true,
            quantizable: true,
        },
    },
]

export function useWhisperModels() {
    const [modelFiles, setModelFiles] = useState<Record<string, string>>({})
    const [downloadProgress, setDownloadProgress] = useState<
        Record<string, number>
    >({})
    const [isDownloading, setIsDownloading] = useState(false)
    const [isInitializingModel, setIsInitializingModel] = useState(false)
    const [whisperContext, setWhisperContext] = useState<WhisperContext | null>(
        null
    )

    const getModelDirectory = useCallback(async () => {
        const directory = `${FileSystem.documentDirectory}whisper-models/`
        await FileSystem.makeDirectoryAsync(directory, {
            intermediates: true,
        }).catch(() => {})
        return directory
    }, [])

    const downloadModel = useCallback(async (model: WhisperModel) => {
        const directory = await getModelDirectory()
        const filePath = `${directory}${model.filename}`

        const fileInfo = await FileSystem.getInfoAsync(filePath)
        if (fileInfo.exists) {
            setModelFiles((prev) => ({ ...prev, [model.id]: filePath }))
            return filePath
        }

        setIsDownloading(true)
        try {
            const downloadResumable = FileSystem.createDownloadResumable(
                model.url,
                filePath,
                {},
                (downloadProgress) => {
                    const progress =
                        downloadProgress.totalBytesWritten /
                        downloadProgress.totalBytesExpectedToWrite
                    setDownloadProgress((prev) => ({
                        ...prev,
                        [model.id]: progress,
                    }))
                }
            )

            const result = await downloadResumable.downloadAsync()
            if (!result) throw new Error('Download failed')

            setModelFiles((prev) => ({ ...prev, [model.id]: result.uri }))
            setDownloadProgress((prev) => ({ ...prev, [model.id]: 1 }))
            return result.uri
        } catch (error) {
            console.error(`Error downloading model ${model.id}:`, error)
            throw error
        } finally {
            setIsDownloading(false)
        }
    }, [getModelDirectory])

    const initializeWhisperModel = useCallback(
        async (modelId: string) => {
            const model = WHISPER_MODELS.find((m) => m.id === modelId)
            if (!model) throw new Error('Invalid model selected')

            try {
                setIsInitializingModel(true)
                const modelPath = await downloadModel(model)

                const context = await initWhisper({
                    filePath: modelPath,
                })
                setWhisperContext(context)
                return context
            } catch (error) {
                console.error('Model initialization error:', error)
                throw error
            } finally {
                setIsInitializingModel(false)
            }
        },
        [downloadModel]
    )

    const resetWhisperContext = useCallback(() => {
        setWhisperContext(null)
    }, [])

    return {
        modelFiles,
        downloadProgress,
        isDownloading,
        isInitializingModel,
        whisperContext,
        downloadModel,
        initializeWhisperModel,
        resetWhisperContext,
    }
}
