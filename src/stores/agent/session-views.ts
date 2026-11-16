// 由 sessions 衍生的畫面資料：面板清單、各家族狀態列、目前主導的 session 與寵物、外部權限提示、寵物視窗尺寸。
// 全部是 computed，來源只有 `sessionsByKey`（reactive Map）與注入的寵物選擇。
//
// - 事件輸入：無；`sessionsByKey` 變動就重算。`dismissPermissionNotice()`（使用者關掉提示）與
//   `forgetDismissedNotice(key)`（該 session 離開 waiting-permission 時由 handleEvent 呼叫）寫入已關閉集合。
// - 計時器：無。
// - storage：無。
// - 跨視窗同步：無；兩個視窗各自從同一串事件算出自己的結果。尺寸 watch 兩邊都會送，主程序重複套用同一組 bounds 無害。
import { computed, shallowRef, watch } from 'vue'
import { t } from '@/i18n'
import type { AgentFamilyKey, AgentSession, AgentSource, AgentState } from '@/types/agent'
import {
  AGENT_FAMILY_REGISTRY,
  ALL_SOURCES,
  FAMILY_SOURCES,
  familyOfSource,
  isDesktopSource,
  isQuotaCapableSource,
  SOURCE_LABELS,
  STATE_PRIORITY,
} from '@/types/agent'
import { compareAttention, mostUrgentSession, summarizeFamilies } from '@/utils/session-attention'
import { petWindowHeight, petWindowWidth } from '@/utils/pet-window-size'

// 面板清單排序的最後一層：來源名稱的 localeCompare 順序在載入時算成名次，
// 每次比較只做整數相減，不必在每次事件重排時反覆做語系比對（順序與 localeCompare 相同）。
const SOURCE_LABEL_RANK = Object.freeze(Object.fromEntries(
  [...ALL_SOURCES]
    .sort((a, b) => SOURCE_LABELS[a].localeCompare(SOURCE_LABELS[b]))
    .map((source, rank) => [source, rank]),
) as Record<AgentSource, number>)

export interface SessionViewsDeps {
  sessionsByKey: ReadonlyMap<string, AgentSession>
  selectedPet: { readonly value: string }
  petsById: { readonly value: ReadonlyMap<string, unknown> }
  multiPetEnabled: { readonly value: boolean }
  petScale: { readonly value: number }
  getPetForFamily: (familyKey: string) => string
}

export function useSessionViews(deps: SessionViewsDeps) {
  const { sessionsByKey, selectedPet, petsById, multiPetEnabled, petScale, getPetForFamily } = deps
  const sessionList = computed(() => [...sessionsByKey.values()].sort((a, b) => {
    const priorityDelta = (STATE_PRIORITY[b.state] ?? 0) - (STATE_PRIORITY[a.state] ?? 0)
    if (priorityDelta !== 0) return priorityDelta
    const recencyDelta = b.lastSeenAt - a.lastSeenAt
    if (recencyDelta !== 0) return recencyDelta
    return SOURCE_LABEL_RANK[a.source] - SOURCE_LABEL_RANK[b.source]
  }))
  // Preserve the store's existing object-shaped view for any internal caller
  // that still needs keyed access; the Map remains the source of truth.
  const sessions = computed(() => Object.fromEntries(sessionsByKey))

  // Unsorted on purpose: the pet only needs counts and the per-family winner (summarizeFamilies),
  // so the hot path never pays for sessionList's full sort. The panel sorts its own view.
  const activeSessions = computed(() => [...sessionsByKey.values()].filter(session => session.state !== 'offline'))

  const hasQuotaCapableSessions = computed(
    () => activeSessions.value.some((session) => isQuotaCapableSource(session.source)),
  )

  const hasSuccessSessions = computed(() => {
    return activeSessions.value.some((s) => s.state === 'success')
  })

  // One line per tool family (CLI + Desktop combined), only shown while that
  // family has an active session — up to one line per AGENT_FAMILY_REGISTRY row.
  // `variants` records which of CLI/Desktop are actually active so the line
  // can still say which one, even though they share a row.
  const familyLines = computed(() => summarizeFamilies(sessionsByKey.values()).map((family) => {
    const top = family.top
    const variants = FAMILY_SOURCES[family.key]
      .filter((source) => family.sources.has(source))
      .map((source) => (isDesktopSource(source) ? 'Desktop' : 'CLI'))
    return {
      key: family.key,
      label: family.label,
      variants,
      state: top.state,
      // 最需要你處理的工作階段（優先度，其次最近）；專案名稱只出現在狀態列的提示與 aria-label。
      project: top.project,
      since: top.lastSeenAt,
      petId: top.routedPetId ?? getPetForFamily(family.key),
      sessionKey: top.key,
    }
  }))

  // When more than one tool family is active at once and the user has opted
  // in, the pet window shows one small pet per family side by side instead
  // of collapsing them all into a single highest-priority pet.
  const isMultiPet = computed(() => multiPetEnabled.value && familyLines.value.length > 1)

  const scaledW = computed(() => petWindowWidth(familyLines.value.length, isMultiPet.value, petScale.value))
  const scaledH = computed(() => {
    // The toast/activity bubble deliberately does NOT grow the window here
    // (see DesktopPet.vue) — it overlays the existing canvas instead, so
    // showing/hiding it never triggers a resize+reposition of the window.
    // The tooltip headroom below is unscaled and always reserved (rather
    // than added only while a tooltip is open) for the same reason: growing
    // the window on hover would reposition/animate it, which is distracting
    // for a "just glance at it" hover interaction.
    return petWindowHeight(familyLines.value.length, isMultiPet.value, petScale.value)
  })

  const highestPrioritySession = computed<AgentSession | null>(() => mostUrgentSession(sessionsByKey.values()))

  const currentState = computed<AgentState>(() => {
    return highestPrioritySession.value?.state ?? 'offline'
  })

  const currentSource = computed(() => {
    return highestPrioritySession.value?.source ?? null
  })

  // Reverse-lookup from the currently-controlling source into its tool
  // family for multi-pet skin selection.
  const currentFamilyKey = computed<AgentFamilyKey | null>(() => {
    const source = currentSource.value
    return source ? familyOfSource(source) : null
  })

  const activePetId = computed(() => {
    const routedPetId = highestPrioritySession.value?.routedPetId
    if (routedPetId && petsById.value.has(routedPetId)) return routedPetId
    // Per-family skins are a multi-pet feature. When that mode is off, keep
    // the original single-pet behavior: always render the global selection.
    if (!multiPetEnabled.value) return selectedPet.value
    return currentFamilyKey.value ? getPetForFamily(currentFamilyKey.value) : selectedPet.value
  })

  // Live "what's it doing right now" bubble text — only meaningful while a
  // tool is actively running and the hook payload included a tool name.
  const activityText = computed<string | null>(() => {
    const s = highestPrioritySession.value
    if (!s || s.state !== 'tool-running' || !s.toolName) return null
    return s.toolName
  })

  // Codex / Claude can only *report* a permission wait; the answer has to be
  // given in the original tool. Every such session is listed (not just the
  // highest-priority one) so the user can see how many agents are blocked.
  const dismissedPermissionNotices = shallowRef<ReadonlySet<string>>(new Set())

  const permissionNoticeItems = computed(() => {
    // 單趟掃描只收集等待中的少數 session，不複製整張 Map；之後只排序這幾筆。
    const waiting: AgentSession[] = []
    for (const session of sessionsByKey.values()) {
      if (
        session.state === 'waiting-permission'
        && session.permissionNotice?.responseMode === 'external_only'
        && !dismissedPermissionNotices.value.has(session.key)
      ) waiting.push(session)
    }
    return waiting.sort(compareAttention).map((session) => {
      const family = familyOfSource(session.source)
      return {
        key: session.key,
        source: family ? AGENT_FAMILY_REGISTRY[family].label : session.source,
        project: session.project ?? '',
        desktop: isDesktopSource(session.source),
        sessionKey: session.key,
      }
    })
  })

  const permissionNotice = computed(() => {
    const items = permissionNoticeItems.value
    const first = items[0]
    if (!first) return null
    const multiple = items.length > 1
    return {
      title: multiple
        ? t('permission.noticeTitleMulti', { count: items.length })
        : t('permission.noticeTitle', { source: first.source, project: first.project || t('projectUnknown') }),
      detail: multiple
        ? t('permission.noticeExternalOnly')
        : first.desktop
          ? t('permission.noticeWhereApp', { source: first.source })
          : t('returnToTerminal'),
      items,
    }
  })

  function dismissPermissionNotice(): void {
    const next = new Set(dismissedPermissionNotices.value)
    for (const item of permissionNoticeItems.value) next.add(item.key)
    dismissedPermissionNotices.value = next
  }
  function resizePetWindow() {
    window.electronAPI?.resizeWindow(scaledW.value, scaledH.value)
  }

  // Grows/shrinks the pet window whenever scale or active status-line count
  // changes — firing from either window's store instance is harmless, since
  // main process just re-applies the same bounds to the (single) pet window.
  watch([scaledW, scaledH], resizePetWindow, { immediate: true })

  /** 該 session 離開 waiting-permission 後，下次再等權限時要能重新提示。 */
  function forgetDismissedNotice(key: string): void {
    if (!dismissedPermissionNotices.value.has(key)) return
    const next = new Set(dismissedPermissionNotices.value)
    next.delete(key)
    dismissedPermissionNotices.value = next
  }

  return {
    sessionList,
    sessions,
    activeSessions,
    hasQuotaCapableSessions,
    hasSuccessSessions,
    familyLines,
    isMultiPet,
    scaledW,
    scaledH,
    highestPrioritySession,
    currentState,
    currentSource,
    currentFamilyKey,
    activePetId,
    activityText,
    permissionNotice,
    dismissPermissionNotice,
    forgetDismissedNotice,
    resizePetWindow,
  }
}
