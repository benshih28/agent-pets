import { readonly, ref, type Ref } from 'vue'

// 整個視窗只建一個 MediaQueryList：逐格計時器與狀態切換都會讀這個值，
// 每次都呼叫 window.matchMedia() 會在熱路徑上反覆配置新物件。
let query: MediaQueryList | null = null
const reduced = ref(false)
const sharedReduced = readonly(reduced)

function ensureQuery(): void {
  if (query || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  query = window.matchMedia('(prefers-reduced-motion: reduce)')
  reduced.value = query.matches
  query.addEventListener('change', event => { reduced.value = event.matches })
}

/** 系統「減少動態效果」設定；會隨系統設定即時更新。 */
export function useReducedMotion(): Readonly<Ref<boolean>> {
  ensureQuery()
  return sharedReduced
}
