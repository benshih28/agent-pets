import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

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
