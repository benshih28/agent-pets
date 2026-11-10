<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { locale, t } from '@/i18n'
import { SOURCE_LABELS, type AgentSession } from '@/types/agent'
import { hostAppLabel } from '@/types/host-app'
import type { SessionJumpAction, SessionJumpError } from '@/types/session-jump'
import SessionElapsed from '@/components/status-panel/SessionElapsed.vue'
import Button from '@/components/ui/Button.vue'
import { AGENT_STATE_PRESENTATION } from '@/utils/agent-state-presentation'
import { formatTimeFull } from '@/utils/intl-format'

// 一個進行中的 session。整列是一個展開按鈕（可用鍵盤聚焦、帶 aria-expanded），
// 展開後顯示完整路徑、工具與時間；列裡不能再巢狀任何可互動元素。
const props = defineProps<{ session: AgentSession; projectLabel: string; detail: string; live: boolean }>()

const expanded = ref(false)
const detailsId = computed(() => `session-details-${props.session.key.replace(/[^\w-]/g, '_')}`)
const lastSeen = computed(() => formatTimeFull(props.session.lastSeenAt, locale.value))
const title = computed(() => `${SOURCE_LABELS[props.session.source]}${props.projectLabel ? ` · ${props.projectLabel}` : ''}`)

// 跳回動作放在展開後的詳情裡，讓整列維持單一個展開按鈕。
// renderer 只指名是哪個 session，路徑與 App 由主程序解析。
const store = useAgentStore()
const switchApp = computed(() => (store.canSwitchToSessionApp(props.session) ? hostAppLabel(props.session.host?.app) : null))
const folderActions = computed(() => store.sessionJumpEnabled && Boolean(props.session.project))
const hasJumpActions = computed(() => Boolean(switchApp.value) || folderActions.value)
const jumpStatus = ref('')
const busy = ref<SessionJumpAction | null>(null)

const JUMP_ERRORS: Partial<Record<SessionJumpError, Parameters<typeof t>[0]>> = {
  unavailable: 'panel.jumpUnavailable',
  unknown_session: 'panel.jumpUnavailable',
  rate_limited: 'panel.jumpRateLimited',
}

async function jump(action: SessionJumpAction): Promise<void> {
  if (busy.value) return
  busy.value = action
  try {
    const result = await store.runSessionJump(props.session.key, action)
    if (result.ok) jumpStatus.value = action === 'copy-path' ? t('panel.jumpCopied') : ''
    else jumpStatus.value = action === 'switch-app' && result.error !== 'rate_limited'
      ? t('pet.switchAppFailed')
      : t(JUMP_ERRORS[result.error] ?? 'panel.jumpFailed')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="session-item" :class="{ expanded }">
    <!-- raw-control: 展開／收合整列（aria-expanded），內含狀態點與多欄文字，不是動作按鈕 -->
    <button
      type="button"
      class="session-row"
      :aria-expanded="expanded"
      :aria-controls="detailsId"
      :title="session.project || undefined"
      @click="expanded = !expanded"
    >
      <span
        class="session-status-dot"
        :class="{ live }"
        :style="{ '--status-color': AGENT_STATE_PRESENTATION[session.state].color }"
        aria-hidden="true"
      />
      <span class="session-info">
        <span class="session-title-line">{{ title }}</span>
        <span class="session-detail">{{ detail }}</span>
      </span>
      <span class="session-state-column">
        <span
          class="state-chip"
          :class="[`state-${session.state}`, { live }]"
          :style="{ '--status-color': AGENT_STATE_PRESENTATION[session.state].color }"
          :title="AGENT_STATE_PRESENTATION[session.state].label"
        >{{ AGENT_STATE_PRESENTATION[session.state].shortLabel }}</span>
        <SessionElapsed v-if="live" :since="session.lastSeenAt" />
        <span v-else class="session-time">{{ lastSeen }}</span>
      </span>
    </button>
    <dl v-if="expanded" :id="detailsId" class="session-details">
      <div v-if="session.project"><dt>{{ t('panel.detailPath') }}</dt><dd class="session-path">{{ session.project }}</dd></div>
      <div v-if="session.toolName"><dt>{{ t('panel.detailTool') }}</dt><dd>{{ session.toolName }}</dd></div>
      <div><dt>{{ t('panel.detailLastSeen') }}</dt><dd>{{ lastSeen }}</dd></div>
      <div><dt>{{ t('panel.detailSessionId') }}</dt><dd class="session-path">{{ session.sessionId }}</dd></div>
      <div v-if="hasJumpActions" class="session-jump" role="group" :aria-label="t('panel.jumpActionsLabel')">
        <dt class="sr-only">{{ t('panel.jumpActionsLabel') }}</dt>
        <dd class="session-jump-actions">
          <Button
            v-if="switchApp"
            size="sm"
            :title="t('pet.switchAppHint')"
            :aria-label="t('pet.switchAppAria', { app: switchApp, project: projectLabel || t('projectUnknown') })"
            :loading="busy === 'switch-app'"
            @click="jump('switch-app')"
          >
            {{ t('pet.switchApp', { app: switchApp }) }}
          </Button>
          <template v-if="folderActions">
            <Button size="sm" :loading="busy === 'show-folder'" @click="jump('show-folder')">{{ t('panel.jumpShowFolder') }}</Button>
            <Button size="sm" :loading="busy === 'copy-path'" @click="jump('copy-path')">{{ t('panel.jumpCopyPath') }}</Button>
          </template>
          <span v-if="jumpStatus" class="session-jump-status" role="status">{{ jumpStatus }}</span>
        </dd>
      </div>
    </dl>
  </div>
</template>
