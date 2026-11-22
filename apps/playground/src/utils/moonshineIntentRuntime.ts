import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

import { toNativePath } from './fileUtils'
import { getMoonshineIntentFiles } from './moonshineIntentModelFiles'

const moonshineIntentModelRoot =
    `${FileSystem.documentDirectory ?? ''}moonshine-intent-models/`
const moonshineIntentWebModelBaseUrl =
    'https://download.moonshine.ai/model/embeddinggemma-300m'

export interface MoonshineIntentModelStatus {
    downloaded: boolean
    localPath: string | null
    variant: string
}

export interface MoonshineIntentDownloadOptions {
    onStatus?: (message: string) => void
    variant?: string
}

function getModelDirectoryUri(variant: string): string {
    return `${moonshineIntentModelRoot}embeddinggemma-300m/${variant}`
}

async function downloadToFile(
    url: string,
    targetPath: string,
    onStatus?: (message: string) => void
): Promise<void> {
    onStatus?.(`Downloading ${targetPath.split('/').pop()}...`)
    const resumable = FileSystem.createDownloadResumable(url, targetPath)
    const result = await resumable.downloadAsync()
    if (!result) {
        throw new Error(`Download failed for ${url}`)
    }
}

export async function getMoonshineIntentModelStatus(
    variant = 'q4'
): Promise<MoonshineIntentModelStatus> {
    if (Platform.OS === 'web') {
        return {
            downloaded: true,
            localPath: moonshineIntentWebModelBaseUrl,
            variant,
        }
    }

    const dirUri = getModelDirectoryUri(variant)
    const files = getMoonshineIntentFiles(variant, Platform.OS)
    const statuses = await Promise.all(
        files.map((fileName) => FileSystem.getInfoAsync(`${dirUri}/${fileName}`))
    )
    const downloaded = statuses.every((status) => status.exists)
    return {
        downloaded,
        localPath: downloaded ? toNativePath(dirUri) : null,
        variant,
    }
}

export async function prepareMoonshineIntentModel(
    options: MoonshineIntentDownloadOptions = {}
): Promise<MoonshineIntentModelStatus> {
    const variant = options.variant ?? 'q4'
    if (Platform.OS === 'web') {
        options.onStatus?.('Using Moonshine web intent model from CDN...')
        return {
            downloaded: true,
            localPath: moonshineIntentWebModelBaseUrl,
            variant,
        }
    }

    const dirUri = getModelDirectoryUri(variant)
    await FileSystem.makeDirectoryAsync(dirUri, {
        intermediates: true,
    }).catch(() => {})

    const baseUrl = 'https://download.moonshine.ai/model/embeddinggemma-300m'
    for (const fileName of getMoonshineIntentFiles(variant, Platform.OS)) {
        const targetPath = `${dirUri}/${fileName}`
        const existing = await FileSystem.getInfoAsync(targetPath)
        if (existing.exists) continue
        await downloadToFile(`${baseUrl}/${fileName}`, targetPath, options.onStatus)
    }

    return {
        downloaded: true,
        localPath: toNativePath(dirUri),
        variant,
    }
}
