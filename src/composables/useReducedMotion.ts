import { readonly, ref, type Ref } from 'vue'

// 單一 MediaQueryList：熱路徑會頻繁讀取，不能每次呼叫 window.matchMedia()。
let query: MediaQueryList | null = null
const reduced = ref(false)
const sharedReduced = readonly(reduced)

function ensureQuery(): void {
  if (query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  query = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = query.matches
  query.addEventListener('change', event => { reduced.value = event.matches })
}

export function useReducedMotion(): Readonly<Ref<boolean>> {
  ensureQuery()
  return sharedReduced
}
