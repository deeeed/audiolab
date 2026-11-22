import React from 'react';
import {
  type StyleProp,
  Platform,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Apps with native screens can keep evidence visible above modal presentations.
let NativeOverlay: React.ComponentType<React.PropsWithChildren<{
  unstable_accessibilityContainerViewIsModal?: boolean;
}>> | undefined;
try {
  NativeOverlay = require('react-native-screens').FullWindowOverlay;
} catch {
  // Hosts without native screens retain the root-view HUD.
}

export type FarmslotRecipeHudStatus = 'idle' | 'running' | 'pass' | 'fail';

export interface FarmslotRecipeHudState {
  status: FarmslotRecipeHudStatus;
  intent: string;
  currentStep?: number;
  totalSteps?: number;
  error?: string;
}

export interface FarmslotRecipeHudText {
  badge?: (state: FarmslotRecipeHudState) => string;
  intent?: (state: FarmslotRecipeHudState) => string;
  error?: (state: FarmslotRecipeHudState) => string | undefined;
}

export interface FarmslotRecipeHudStyles {
  container?: StyleProp<ViewStyle>;
  line?: StyleProp<TextStyle>;
  badgeText?: StyleProp<TextStyle>;
  badgeTextRunning?: StyleProp<TextStyle>;
  badgeTextPass?: StyleProp<TextStyle>;
  badgeTextFail?: StyleProp<TextStyle>;
  intent?: StyleProp<TextStyle>;
  error?: StyleProp<TextStyle>;
}

export interface RecipeHudOptions {
  text?: FarmslotRecipeHudText;
  styles?: FarmslotRecipeHudStyles;
}

export interface RecipeHudProps extends RecipeHudOptions {
  state: FarmslotRecipeHudState | null;
}

export function RecipeHud({
  state,
  styles: customStyles,
  text,
}: Readonly<RecipeHudProps>): React.ReactElement | null {
  const insets = useSafeAreaInsets();
  if (!state || state.status === 'idle') return null;
  const badge = text?.badge?.(state) ?? formatBadge(state);
  const intent = text?.intent?.(state) ?? state.intent;
  const error = text?.error?.(state) ?? state.error;
  const badgeTone = badgeToneForStatus(state.status);
  const hud = (
    <View pointerEvents="none" style={[
      styles.container,
      { left: insets.left + 8, right: insets.right + 8, bottom: insets.bottom + 8 },
      customStyles?.container,
    ]}>
      <Text style={[styles.line, customStyles?.line]}>
        <Text
          style={[
            styles.badgeText,
            badgeTone === 'fail'
              ? styles.badgeTextFail
              : badgeTone === 'pass'
                ? styles.badgeTextPass
                : styles.badgeTextRunning,
            customStyles?.badgeText,
            badgeTone === 'fail'
              ? customStyles?.badgeTextFail
              : badgeTone === 'pass'
                ? customStyles?.badgeTextPass
                : customStyles?.badgeTextRunning,
          ]}
        >
          {badge}
        </Text>
        {intent ? <Text style={customStyles?.intent}>{`  ${intent}`}</Text> : null}
      </Text>
      {error ? <Text style={[styles.error, customStyles?.error]}>{error}</Text> : null}
    </View>
  );
  return Platform.OS === 'ios' && NativeOverlay
    ? <NativeOverlay unstable_accessibilityContainerViewIsModal={false}>{hud}</NativeOverlay>
    : hud;
}

function formatBadge(state: FarmslotRecipeHudState): string {
  const status = state.status === 'running' ? 'run' : state.status;
  const progress = formatProgress(state.currentStep, state.totalSteps);
  return [status, progress].filter(Boolean).join(' ').toUpperCase();
}

function formatProgress(currentStep?: number, totalSteps?: number): string {
  if (!currentStep || !totalSteps) return '';
  return `${currentStep}/${totalSteps}`;
}

function badgeToneForStatus(status: FarmslotRecipeHudStatus): 'running' | 'pass' | 'fail' {
  if (status === 'fail') return 'fail';
  if (status === 'pass') return 'pass';
  return 'running';
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: Platform.OS === 'android' ? '#222' : 'rgba(0, 0, 0, 0.58)',
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  line: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  badgeTextRunning: {
    color: '#00ff88',
  },
  badgeTextPass: {
    color: '#00ff88',
  },
  badgeTextFail: {
    color: '#ff4d4f',
  },
  error: {
    color: '#e6e6e6',
    fontSize: 10,
    fontWeight: '400',
    lineHeight: 12,
  },
});
