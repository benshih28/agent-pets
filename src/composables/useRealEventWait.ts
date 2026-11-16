// 「等待真實事件」：只聽工具自己送出的事件，這樣壞掉的 hook 或錯誤的 Node 路徑
// 不會被接收器測試（完全不經過工具）蓋住。30 秒沒收到就標記逾時。
import { onUnmounted, ref } from 'vue'
import type { AgentAdapterId } from '@/types/agent-adapter'
import type { AgentSource } from '@/types/agent'

export const REAL_EVENT_WAIT_MS = 30_000

interface WaitableTool {
  id: AgentAdapterId
  sources: readonly AgentSource[]
  realEvent?: { source: AgentSource, at: number }
  realEventTimedOut?: boolean
}

export function useRealEventWait() {
  const waitingFor = ref<AgentAdapterId | null>(null)
  const waitRemainingMs = ref(0)
  let stopWaiting: (() => void) | null = null

  function cancel() {
    stopWaiting?.()
    stopWaiting = null
    waitingFor.value = null
  }

  function start(tool: WaitableTool) {
    cancel()
    tool.realEvent = undefined
    tool.realEventTimedOut = false
    waitingFor.value = tool.id
    const deadline = Date.now() + REAL_EVENT_WAIT_MS
    waitRemainingMs.value = REAL_EVENT_WAIT_MS
    const tick = setInterval(() => {
      waitRemainingMs.value = Math.max(0, deadline - Date.now())
      if (waitRemainingMs.value === 0) {
        tool.realEventTimedOut = true
        cancel()
      }
    }, 250)
    const unsubscribe = window.electronAPI?.onAgentStatusEvent((event) => {
      if (!tool.sources.includes(event.source)) return
      if (event.originalEvent === 'AgentPetsIntegrationTest' || event.sessionId?.startsWith('agent-pets-test-')) return
      tool.realEvent = { source: event.source, at: Date.now() }
      cancel()
    })
    stopWaiting = () => {
      clearInterval(tick)
      unsubscribe?.()
    }
  }

  onUnmounted(cancel)

  return { waitingFor, waitRemainingMs, start, cancel }
}
