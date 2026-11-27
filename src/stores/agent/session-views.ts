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

// 排序最後一層：localeCompare 順序在載入時算成名次，每次比較只做整數相減。
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
  const sessions = computed(() => Object.fromEntries(sessionsByKey))

  // Unsorted on purpose so the hot path never pays for sessionList's full sort.
  const activeSessions = computed(() => [...sessionsByKey.values()].filter(session => session.state !== 'offline'))

  const hasQuotaCapableSessions = computed(
    () => activeSessions.value.some((session) => isQuotaCapableSource(session.source)),
  )

  const hasSuccessSessions = computed(() => {
    return activeSessions.value.some((s) => s.state === 'success')
  })

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
      project: top.project,
      since: top.lastSeenAt,
      petId: top.routedPetId ?? getPetForFamily(family.key),
      sessionKey: top.key,
    }
  }))

  const isMultiPet = computed(() => multiPetEnabled.value && familyLines.value.length > 1)

  const scaledW = computed(() => petWindowWidth(familyLines.value.length, isMultiPet.value, petScale.value))
  const scaledH = computed(() => {
    // Bubbles and tooltip headroom must never resize the window: a resize repositions/animates it.
    return petWindowHeight(familyLines.value.length, isMultiPet.value, petScale.value)
  })

  const highestPrioritySession = computed<AgentSession | null>(() => mostUrgentSession(sessionsByKey.values()))

  const currentState = computed<AgentState>(() => {
    return highestPrioritySession.value?.state ?? 'offline'
  })

  const currentSource = computed(() => {
    return highestPrioritySession.value?.source ?? null
  })

  const currentFamilyKey = computed<AgentFamilyKey | null>(() => {
    const source = currentSource.value
    return source ? familyOfSource(source) : null
  })

  const activePetId = computed(() => {
    const routedPetId = highestPrioritySession.value?.routedPetId
    if (routedPetId && petsById.value.has(routedPetId)) return routedPetId
    if (!multiPetEnabled.value) return selectedPet.value
    return currentFamilyKey.value ? getPetForFamily(currentFamilyKey.value) : selectedPet.value
  })

  const activityText = computed<string | null>(() => {
    const s = highestPrioritySession.value
    if (!s || s.state !== 'tool-running' || !s.toolName) return null
    return s.toolName
  })

  // Codex / Claude can only report a permission wait; every such session is listed so the user sees how many are blocked.
  const dismissedPermissionNotices = shallowRef<ReadonlySet<string>>(new Set())

  const permissionNoticeItems = computed(() => {
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

  // Either window's store fires this; main re-applies the same bounds harmlessly.
  watch([scaledW, scaledH], resizePetWindow, { immediate: true })

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
