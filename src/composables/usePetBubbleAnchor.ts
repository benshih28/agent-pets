import { computed, shallowReactive, type ComputedRef, type Ref } from 'vue'

// Keyed element/instance registries for the multi-pet row. Array refs inside a
// v-for do not guarantee source order, so everything is looked up by the
// family line key instead of by index.

export function useKeyedRefs<T>() {
  const items = shallowReactive(new Map<string, T>())
  function setRef(key: string, value: unknown): void {
    if (value) items.set(key, value as T)
    else items.delete(key)
  }
  return { items, setRef }
}

/** Horizontal anchor (px from the click area's left) centred on a target element. */
export function anchorLeftFor(clickArea: HTMLElement | null, target: HTMLElement | undefined): Record<string, string> {
  if (!clickArea || !target) return {}
  const targetBounds = target.getBoundingClientRect()
  const areaBounds = clickArea.getBoundingClientRect()
  return { left: `${targetBounds.left - areaBounds.left + targetBounds.width / 2}px` }
}

export function usePetBubbleAnchor(
  clickAreaRef: Ref<HTMLElement | null>,
  elements: Map<string, HTMLElement>,
  lines: () => ReadonlyArray<{ key: string; petId: string }>,
  active: () => boolean,
  petId: () => string | undefined,
): ComputedRef<Record<string, string>> {
  return computed(() => {
    if (!active()) return {}
    const wanted = petId()
    const line = wanted ? lines().find(candidate => candidate.petId === wanted) : undefined
    return anchorLeftFor(clickAreaRef.value, line ? elements.get(line.key) : undefined)
  })
}
