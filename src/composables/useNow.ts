import { onMounted, onUnmounted, ref } from 'vue'

// One shared wall-clock ref for tiny "elapsed" labels. The timer only runs
// while at least one component is subscribed and the document is visible, and
// only the components that read `now` re-render — not whole lists.
const now = ref(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null
let listening = false

function sync(): void {
  const shouldRun = subscribers > 0 && !document.hidden
  if (shouldRun && !timer) {
    now.value = Date.now()
    timer = setInterval(() => { now.value = Date.now() }, 1000)
  } else if (!shouldRun && timer) {
    clearInterval(timer)
    timer = null
  }
}

export function useNow() {
  onMounted(() => {
    subscribers += 1
    if (!listening) {
      document.addEventListener('visibilitychange', sync)
      listening = true
    }
    sync()
  })
  onUnmounted(() => {
    subscribers -= 1
    sync()
  })
  return now
}
