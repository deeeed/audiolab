import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export interface AgenticHudStep {
  id: string
  description: string
  action?: string
  recipe?: string
  depth?: number
}

export type AgenticHudCallback = ((step: AgenticHudStep | null) => void) | null

export function createAgenticHudStore() {
  let step: AgenticHudStep | null = null
  let callback: AgenticHudCallback = null

  return {
    clearStep() {
      step = null
      callback?.(step)
    },
    getStep() {
      return step
    },
    register(next: AgenticHudCallback) {
      callback = next
      callback?.(step)
    },
    setStep(next: AgenticHudStep | null) {
      step = next
      callback?.(step)
    },
  }
}

export type FiberNode = Record<string, unknown>

export function getFiberRoots(): Set<FiberNode>[] {
  const hook = (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    | {
        renderers?: Map<number, unknown>
        getFiberRoots?: (id: number) => Set<FiberNode>
      }
    | undefined

  if (!hook?.renderers || typeof hook.getFiberRoots !== 'function') {
    return []
  }

  const roots: Set<FiberNode>[] = []
  for (let id = 1; id <= 3; id += 1) {
    if (!hook.renderers.get(id)) continue
    const fiberRoots = hook.getFiberRoots(id)
    if (fiberRoots) {
      roots.push(fiberRoots)
    }
  }
  return roots
}

export function findFiberByTestId(testId: string): FiberNode | null {
  const walk = (fiber: FiberNode | null): FiberNode | null => {
    if (!fiber) return null
    const props = fiber.memoizedProps as Record<string, unknown> | null
    if (props?.testID === testId) {
      return fiber
    }
    return (
      walk(fiber.child as FiberNode | null) ??
      walk(fiber.sibling as FiberNode | null)
    )
  }

  for (const fiberRoots of getFiberRoots()) {
    for (const root of fiberRoots) {
      const found = walk(root.current as FiberNode | null)
      if (found) {
        return found
      }
    }
  }

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const element = document.querySelector(`[data-testid="${testId}"]`) as
      | (Element & { click?: () => void; value?: string })
      | null
    if (element) {
      return {
        memoizedProps: {
          onPress:
            typeof element.click === 'function'
              ? () => element.click?.()
              : undefined,
          testID: testId,
          value:
            'value' in element
              ? element.value ?? null
              : element.textContent ?? null,
        },
        stateNode: element,
      }
    }
  }

  return null
}

export function setInputByTestId(testId: string, value: string) {
  try {
    const fiber = findFiberByTestId(testId)
    if (!fiber) {
      return { ok: false, error: `No component with testID="${testId}" found` }
    }

    const findEditableFiber = (node: FiberNode | null): FiberNode | null => {
      if (!node) return null
      const nodeProps = node.memoizedProps as Record<string, unknown> | null
      const nodeState = node.stateNode as
        | {
            dispatchEvent?: (event: Event) => void
            setNativeProps?: (props: Record<string, unknown>) => void
            value?: string
          }
        | null
      if (
        typeof nodeProps?.onChangeText === 'function' ||
        typeof nodeProps?.onChange === 'function' ||
        typeof nodeState?.setNativeProps === 'function'
      ) {
        return node
      }
      return (
        findEditableFiber(node.child as FiberNode | null) ??
        findEditableFiber(node.sibling as FiberNode | null)
      )
    }

    const editableFiber = findEditableFiber(fiber) ?? fiber
    const props = editableFiber.memoizedProps as Record<string, unknown> | null
    const stateNode = editableFiber.stateNode as
      | {
          dispatchEvent?: (event: Event) => void
          setNativeProps?: (props: Record<string, unknown>) => void
          value?: string
        }
      | null
    let updated = false

    const onChangeText = props?.onChangeText as ((text: string) => void) | undefined
    if (typeof onChangeText === 'function') {
      onChangeText(value)
      updated = true
    }

    const onChange = props?.onChange as
      | ((event: Record<string, unknown>) => void)
      | undefined
    if (typeof onChange === 'function') {
      onChange({
        currentTarget: stateNode,
        eventCount: 0,
        nativeEvent: { text: value },
        target: stateNode,
        timeStamp: Date.now(),
      })
      updated = true
    }

    if (stateNode?.setNativeProps) {
      stateNode.setNativeProps({ text: value, value })
      updated = true
    }

    if (!updated && Platform.OS === 'web' && stateNode && 'value' in stateNode) {
      stateNode.value = value
      if (typeof stateNode.dispatchEvent === 'function') {
        stateNode.dispatchEvent(new Event('input', { bubbles: true }))
        stateNode.dispatchEvent(new Event('change', { bubbles: true }))
      }
      updated = true
    }

    if (!updated) {
      return { ok: false, error: `Component with testID="${testId}" is not a writable input` }
    }

    return { ok: true, testId, value }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

const MONO_FONT = Platform.select({
  android: 'monospace',
  default: 'monospace',
  ios: 'Menlo',
})

const styles = StyleSheet.create({
  actionBadge: {
    backgroundColor: '#123b2b',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  actionText: {
    color: '#83ffd0',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  container: {
    backgroundColor: 'rgba(7, 10, 14, 0.94)',
    borderColor: '#18f0a6',
    borderRadius: 14,
    borderWidth: 1,
    elevation: 12,
    left: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'absolute',
    right: 12,
    shadowColor: '#000000',
    shadowOffset: {
      height: 8,
      width: 0,
    },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    zIndex: 9999,
  },
  depthText: {
    color: '#9fb1bc',
    fontFamily: MONO_FONT,
    fontSize: 11,
    fontWeight: '600',
  },
  description: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  recipe: {
    color: '#a9bac6',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  stepId: {
    color: '#18f0a6',
    fontFamily: MONO_FONT,
    fontSize: 13,
    fontWeight: '700',
  },
})

interface AgentStepHudProps {
  register: (callback: AgenticHudCallback) => void
}

export function AgentStepHud({ register }: AgentStepHudProps) {
  if (!__DEV__) return null

  return <AgentStepHudInner register={register} />
}

function AgentStepHudInner({ register }: AgentStepHudProps) {
  const [step, setStep] = useState<AgenticHudStep | null>(null)
  const insets = useSafeAreaInsets()

  useEffect(() => {
    register(setStep)
    return () => {
      register(null)
    }
  }, [register])

  if (!step) return null

  const bottom = Platform.OS === 'web' ? 20 : Math.max(insets.bottom + 72, 88)

  return (
    <View pointerEvents="none" style={[styles.container, { bottom }]}>
      <View style={styles.headerRow}>
        <View style={styles.actionBadge}>
          <Text style={styles.actionText}>
            {String(step.action || 'step').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.stepId}>{step.id}</Text>
        {typeof step.depth === 'number' && step.depth > 0 ? (
          <Text style={styles.depthText}>depth {step.depth}</Text>
        ) : null}
      </View>
      <Text style={styles.description}>{step.description}</Text>
      {step.recipe ? <Text style={styles.recipe}>{step.recipe}</Text> : null}
    </View>
  )
}

export { RecipeHud } from './RecipeHud'
export type { FarmslotRecipeHudStatus, FarmslotRecipeHudState, FarmslotRecipeHudText, FarmslotRecipeHudStyles, RecipeHudOptions, RecipeHudProps } from './RecipeHud'
