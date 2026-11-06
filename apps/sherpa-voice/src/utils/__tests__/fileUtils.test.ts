/// <reference types="jest" />
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { getFileSize } from '../fileUtils'

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
jest.mock('../../config', () => ({
    baseLogger: { extend: () => ({ info: jest.fn(), warn: jest.fn() }) },
}))
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: jest.fn() }))

const getInfoAsync = FileSystem.getInfoAsync as jest.Mock
const SAMPLE = '/assets/?unstable_path=.%2Fassets%2Fjfk.wav'

describe('getFileSize', () => {
    afterEach(() => {
        jest.resetAllMocks()
        Platform.OS = 'ios'
    })

    describe('on web', () => {
        beforeEach(() => {
            Platform.OS = 'web'
            // expo-file-system has no web implementation of getInfoAsync.
            getInfoAsync.mockRejectedValue(
                new Error('ExponentFileSystem.getInfoAsync is not available on web')
            )
        })

        it('measures the fetched body instead of calling getInfoAsync', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                blob: () => Promise.resolve({ size: 352044 }),
            })

            await expect(getFileSize(SAMPLE)).resolves.toBe(352044)
            expect(global.fetch).toHaveBeenCalledWith(SAMPLE)
            expect(getInfoAsync).not.toHaveBeenCalled()
        })

        it('returns 0 when the file is missing', async () => {
            global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

            await expect(getFileSize(SAMPLE)).resolves.toBe(0)
        })
    })

    describe('on native', () => {
        it('reads the size from getInfoAsync', async () => {
            getInfoAsync.mockResolvedValue({ exists: true, size: 1234 })

            await expect(getFileSize('file:///data/jfk.wav')).resolves.toBe(1234)
            expect(getInfoAsync).toHaveBeenCalledWith('file:///data/jfk.wav')
        })

        it('returns 0 when the file is missing', async () => {
            getInfoAsync.mockResolvedValue({ exists: false })

            await expect(getFileSize('file:///data/missing.wav')).resolves.toBe(0)
        })
    })
})
