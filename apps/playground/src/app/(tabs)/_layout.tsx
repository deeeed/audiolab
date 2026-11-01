// playground/src/app/(tabs)/_layout.tsx
import React from 'react'
import { Platform, View } from 'react-native'

import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Tabs, useSegments } from 'expo-router'
import { NativeTabs } from 'expo-router/unstable-native-tabs'

import { useTheme } from '@siteed/design-system'
import { useSharedAudioRecorder } from '@siteed/audio-studio'

import { CustomHeader } from '../../components/CustomHeader'

const recordingColor = 'rgba(255, 99, 71, 1)'

const TAB_TITLES: Record<string, string> = {
    record: 'Record',
    import: 'Import',
    transcription: 'Transcription',
    files: 'Files',
    more: 'More',
}

export default function TabLayout() {
    const { isRecording } = useSharedAudioRecorder()
    const { colors } = useTheme()
    const segments = useSegments()
    const currentTab = segments[segments.length - 1] ?? 'record'
    const title = TAB_TITLES[currentTab] ?? currentTab

    if (Platform.OS === 'web') {
        return (
            <Tabs
                screenOptions={{
                    tabBarActiveTintColor: colors.primary,
                    tabBarInactiveTintColor: colors.text,
                    tabBarStyle: {
                        backgroundColor: colors.background,
                        borderTopColor: colors.border,
                    },
                    headerStyle: { backgroundColor: colors.background },
                    headerTintColor: colors.text,
                }}
            >
                <Tabs.Screen
                    name="record"
                    options={{
                        title: 'Record',
                        // RN 0.88's ColorValue also admits null and numbers, which the icon color prop omits.
                        tabBarIcon: ({ color }) => (
                            <MaterialCommunityIcons
                                name="record-circle"
                                size={26}
                                color={isRecording ? recordingColor : (color as string)}
                            />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="import"
                    options={{
                        title: 'Import',
                        tabBarIcon: ({ color }) => (
                            <MaterialCommunityIcons name="file-upload" size={28} color={color as string} />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="transcription"
                    options={{
                        title: 'Transcription',
                        tabBarIcon: ({ color }) => (
                            <MaterialCommunityIcons name="microphone-message" size={28} color={color as string} />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="files"
                    options={{
                        title: 'Files',
                        tabBarIcon: ({ color }) => (
                            <MaterialCommunityIcons name="folder-multiple" size={28} color={color as string} />
                        ),
                    }}
                />
                <Tabs.Screen
                    name="more"
                    options={{
                        title: 'More',
                        tabBarIcon: ({ color }) => (
                            <MaterialCommunityIcons name="dots-horizontal" size={28} color={color as string} />
                        ),
                    }}
                />
            </Tabs>
        )
    }

    return (
        <View style={{ flex: 1 }}>
            <CustomHeader title={isRecording ? `● ${title}` : title} />
        <NativeTabs
            tintColor={colors.primary}
            backgroundColor={colors.background}
            labelVisibilityMode="labeled"
        >
            <NativeTabs.Trigger name="record">
                <NativeTabs.Trigger.Label>{isRecording ? 'Recording' : 'Record'}</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon
                    sf={{ default: 'record.circle', selected: 'record.circle.fill' }}
                    md="fiber_manual_record"
                    selectedColor={isRecording ? recordingColor : undefined}
                />
                {isRecording && <NativeTabs.Trigger.Badge />}
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="import">
                <NativeTabs.Trigger.Label>Import</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon
                    sf={{ default: 'square.and.arrow.up', selected: 'square.and.arrow.up.fill' }}
                    md="file_upload"
                />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="transcription">
                <NativeTabs.Trigger.Label>Transcription</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon
                    sf={{ default: 'waveform.and.mic', selected: 'waveform.and.mic' }}
                    md="mic"
                />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="files">
                <NativeTabs.Trigger.Label>Files</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon
                    sf={{ default: 'doc.on.doc', selected: 'doc.on.doc.fill' }}
                    md="folder"
                />
            </NativeTabs.Trigger>
            <NativeTabs.Trigger name="more">
                <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
                <NativeTabs.Trigger.Icon
                    sf="ellipsis"
                    md="more_horiz"
                />
            </NativeTabs.Trigger>
        </NativeTabs>
        </View>
    )
}
