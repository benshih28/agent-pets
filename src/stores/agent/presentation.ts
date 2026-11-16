// Presentation MCP 與插件的短暫反應／說話佇列。只決定「寵物現在要不要演一下」，
// 不能執行命令、讀檔、決定權限或改 XP（MCP 只做展示，見 pet-skill）。
//
// - 事件輸入：`handlePresentationIntent()`（主程序轉來的 MCP／插件 intent，先在這裡重新驗證形狀）；
//   主 store 在 agent 進入高優先度狀態、DND 開啟或關閉 MCP 時呼叫 `clearPresentation()`／`clearMcpPresentation()`。
// - 優先序：佇列最多 8 筆（滿了丟最舊的）；agent 狀態優先度 ≥ waiting-input、DND、偏好還沒載入時一律不演；
//   關掉 MCP 只清掉 MCP 的 intent，插件的反應留著。
// - 計時器：同時只有一個，指向目前 intent 的到期時間；clear／換下一筆都會先清掉，store 的 effect scope 結束時也會清掉。
// - storage：無。
// - 跨視窗同步：無；主程序把同一個 intent 送到寵物視窗。
import { computed, onScopeDispose, ref } from 'vue'
import { STATE_PRIORITY, type AgentState } from '@/types/agent'
import {
  PRESENTATION_REACTIONS,
  type PresentationIntent,
  type PresentationReaction,
} from '@/types/presentation'
import { isValidPetId } from '@/utils/pet-id'

const PRESENTATION_MAX_QUEUE = 8
const PRESENTATION_HIGH_PRIORITY = STATE_PRIORITY['waiting-input']
const PRESENTATION_REACTION_SET: ReadonlySet<string> = new Set(PRESENTATION_REACTIONS)

function isPresentationReaction(value: unknown): value is PresentationReaction {
  return typeof value === 'string' && PRESENTATION_REACTION_SET.has(value)
}

export interface PresentationGate {
  /** 主程序的桌面偏好已經送到。 */
  ready(): boolean
  mcpEnabled(): boolean
  dnd(): boolean
  /** 目前最需要注意的 agent 狀態。 */
  currentState(): AgentState
  /** 目前畫面上的寵物；指定 petId 的 intent 只給這些寵物。 */
  visiblePetIds(): Iterable<string>
}

export function isUrgentForPresentation(state: AgentState): boolean {
  return (STATE_PRIORITY[state] ?? 0) >= PRESENTATION_HIGH_PRIORITY
}

export function normalizePresentationIntent(value: unknown, now = Date.now()): PresentationIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if ((raw.kind !== 'react' && raw.kind !== 'say')
    || typeof raw.id !== 'string'
    || typeof raw.createdAt !== 'number'
    || typeof raw.expiresAt !== 'number'
    || !Number.isFinite(raw.createdAt)
    || !Number.isFinite(raw.expiresAt)
    || raw.expiresAt <= now) return null
  const source = raw.source === undefined ? undefined : raw.source === 'plugin' ? 'plugin' : null
  if (source === null || (source === 'plugin' && raw.kind !== 'react')) return null

  const petId = raw.petId === undefined
    ? undefined
    : typeof raw.petId === 'string' && isValidPetId(raw.petId, 64) ? raw.petId : null
  if (petId === null) return null

  if (raw.kind === 'react') {
    if (!isPresentationReaction(raw.reaction)) return null
    return {
      id: raw.id.slice(0, 80),
      kind: 'react',
      ...(source ? { source } : {}),
      ...(petId ? { petId } : {}),
      reaction: raw.reaction,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt,
    }
  }

  if (typeof raw.message !== 'string') return null
  const message = raw.message
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (message.length === 0 || message.length > 240) return null
  return {
    id: raw.id.slice(0, 80),
    kind: 'say',
    ...(petId ? { petId } : {}),
    message,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
  }
}

export function usePresentationQueue(gate: PresentationGate) {
  const presentationQueue = ref<PresentationIntent[]>([])
  const presentationActive = ref<PresentationIntent | null>(null)
  const presentationReaction = ref<{
    id: string
    reaction: PresentationReaction
    petId?: string
  } | null>(null)
  let presentationTimer: ReturnType<typeof setTimeout> | null = null

  const presentationSay = computed(() => (
    gate.ready()
    && gate.mcpEnabled()
    && !gate.dnd()
    && presentationActive.value?.kind === 'say'
      ? presentationActive.value
      : null
  ))

  function clearPresentationTimer() {
    if (presentationTimer) clearTimeout(presentationTimer)
    presentationTimer = null
  }

  function clearPresentation(): void {
    clearPresentationTimer()
    presentationQueue.value = []
    presentationActive.value = null
    presentationReaction.value = null
  }

  function clearMcpPresentation(): void {
    clearPresentationTimer()
    presentationQueue.value = presentationQueue.value.filter(intent => intent.source === 'plugin')
    if (presentationActive.value?.source !== 'plugin') {
      presentationActive.value = null
      presentationReaction.value = null
    }
    pumpPresentation()
  }

  function presentationBlocked(source?: PresentationIntent['source']): boolean {
    return !gate.ready()
      || (source !== 'plugin' && !gate.mcpEnabled())
      || gate.dnd()
      || isUrgentForPresentation(gate.currentState())
  }

  function stillAllowed(intent: PresentationIntent, now: number): boolean {
    return intent.expiresAt > now && (intent.source === 'plugin' || gate.mcpEnabled())
  }

  function pumpPresentation(): void {
    clearPresentationTimer()
    const now = Date.now()
    presentationQueue.value = presentationQueue.value.filter(intent => stillAllowed(intent, now))
    if (!gate.ready() || gate.dnd() || isUrgentForPresentation(gate.currentState())) {
      clearPresentation()
      return
    }
    const active = presentationActive.value
    if (active && stillAllowed(active, now)) {
      presentationTimer = setTimeout(pumpPresentation, active.expiresAt - now)
      return
    }
    const next = presentationQueue.value.shift() ?? null
    presentationActive.value = next
    presentationReaction.value = null
    if (!next) return

    if (next.kind === 'react' && next.reaction) {
      presentationReaction.value = {
        id: next.id,
        reaction: next.reaction,
        ...(next.petId ? { petId: next.petId } : {}),
      }
    }
    presentationTimer = setTimeout(pumpPresentation, Math.max(1, next.expiresAt - now))
  }

  function handlePresentationIntent(value: unknown): void {
    const intent = normalizePresentationIntent(value)
    if (!intent || presentationBlocked(intent.source)) return
    if (intent.petId && !new Set(gate.visiblePetIds()).has(intent.petId)) return
    if (presentationQueue.value.length >= PRESENTATION_MAX_QUEUE) {
      presentationQueue.value.shift()
    }
    presentationQueue.value.push(intent)
    pumpPresentation()
  }

  onScopeDispose(clearPresentationTimer)

  return {
    presentationReaction,
    presentationSay,
    handlePresentationIntent,
    clearPresentation,
    clearMcpPresentation,
  }
}
