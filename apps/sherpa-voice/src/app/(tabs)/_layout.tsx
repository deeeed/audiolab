import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@siteed/design-system';
import { Tabs, useSegments, useRouter } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { Platform, View } from 'react-native';

import { CustomHeader } from '../../components/CustomHeader';
import { useModelManagement } from '../../contexts/ModelManagement';

const TAB_TITLES: Record<string, string> = {
  index: 'Features',
  features: 'Features',
  models: 'Models',
  about: 'About',
};

export default function TabLayout() {
  const { colors } = useTheme();
  const segments = useSegments() as string[];
  const { modelsState } = useModelManagement();
  // Only show custom header for top-level tab screens (not when inside features stack)
  const isNestedFeature = segments.length > 2 && segments[1] === 'features';
  const currentTab = segments[1] ?? 'index';
  const title = TAB_TITLES[currentTab] ?? 'Sherpa-ONNX';
  const isAnyDownloading = Object.values(modelsState).some(
    s => s.status === 'downloading' || s.status === 'extracting'
  );

  const router = useRouter();

  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1 }}>
        <Tabs
          screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.text,
          tabBarStyle: {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ href: null }}
        />
        <Tabs.Screen
          name="features"
          options={{
            title: 'Features',
            // RN 0.88's ColorValue also admits null and numbers, which the icon color prop omits.
            tabBarIcon: ({ color }) => <Ionicons name="grid" size={28} color={color as string} />,
          }}
          listeners={{
            tabPress: (e) => {
              // If already inside a nested feature screen, pop to the features index
              if (isNestedFeature) {
                e.preventDefault();
                router.replace('/(tabs)/features');
              }
            },
          }}
        />
        <Tabs.Screen
          name="models"
          options={{
            href: null, // Models are preloaded on web — hide the tab
          }}
        />
        <Tabs.Screen
          name="about"
          options={{
            title: 'About',
            tabBarIcon: ({ color }) => <Ionicons name="information-circle" size={28} color={color as string} />,
          }}
        />
        </Tabs>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {!isNestedFeature && <CustomHeader title={title} />}
      <NativeTabs
        tintColor={colors.primary}
        backgroundColor={colors.background}
        labelVisibilityMode="labeled"
      >
        <NativeTabs.Trigger name="features">
          <NativeTabs.Trigger.Label>Features</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }}
            md="grid_view"
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="models">
          <NativeTabs.Trigger.Label>Models</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }}
            md="download"
          />
          {isAnyDownloading && <NativeTabs.Trigger.Badge>↓</NativeTabs.Trigger.Badge>}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="about">
          <NativeTabs.Trigger.Label>About</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            sf={{ default: 'info.circle', selected: 'info.circle.fill' }}
            md="info"
          />
        </NativeTabs.Trigger>
      </NativeTabs>
    </View>
  );
}
