import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

// 元件可見時才為 true（IntersectionObserver）；沒有這個 API 時視為一直可見。
// 主題清單用它延後渲染預覽，避免隱藏的分頁或捲出畫面的區塊做無用的樣式計算。
export function useElementVisible(target: Ref<HTMLElement | null>): Ref<boolean> {
  const visible = ref(false)
  let observer: IntersectionObserver | null = null
  onMounted(() => {
    if (typeof IntersectionObserver === 'function' && target.value) {
      observer = new IntersectionObserver(entries => { visible.value = entries.some(entry => entry.isIntersecting) })
      observer.observe(target.value)
    } else {
      visible.value = true
    }
  })
  onBeforeUnmount(() => observer?.disconnect())
  return visible
}
