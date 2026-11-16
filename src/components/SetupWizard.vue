<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, useId } from 'vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import type { AgentAdapterId, InstallOutcome } from '@/types/agent-adapter'
import type { AgentSource } from '@/types/agent'
import { locale, t, translateBackendError, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import SetupWizardToolCard from '@/components/setup-wizard/SetupWizardToolCard.vue'
import type { ToolStatus } from '@/components/setup-wizard/setup-wizard-text'
import { useRealEventWait } from '@/composables/useRealEventWait'
import { formatNumber } from '@/utils/intl-format'

const props = defineProps<{
  /** Opened automatically on the first launch: start with the short intro. */
  firstRun?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// intro (what the pet does) -> tools (install hooks). Replays from Settings go straight to tools.
const step = ref<'intro' | 'tools'>(props.firstRun ? 'intro' : 'tools')
const anyReady = computed(() => tools.value.some(tool => tool.installable && tool.health === 'ready'))

const INTRO_CARDS = [
  { icon: 'bell', title: 'onboarding.introStatusTitle', body: 'onboarding.introStatusBody' },
  { icon: 'lock', title: 'onboarding.introPermissionTitle', body: 'onboarding.introPermissionBody' },
  { icon: 'growth', title: 'onboarding.introGrowthTitle', body: 'onboarding.introGrowthBody' },
] as const satisfies ReadonlyArray<{ icon: string, title: TranslationKey, body: TranslationKey }>

// Finishing with at least one connected tool completes onboarding; leaving earlier is remembered as
// a skip so the wizard does not reopen on its own. Replays never downgrade a completed state.
function finish() {
  const action = anyReady.value ? 'completed' : 'skipped'
  if (props.firstRun || anyReady.value) void window.electronAPI?.updateOnboardingState(action)
  emit('close')
}

const tools = ref<ToolStatus[]>([])

const loading = ref(true)
const error = ref('')
const installing = ref<AgentAdapterId | 'all' | null>(null)
const testing = ref<AgentSource | null>(null)
const diagnosing = ref<AgentAdapterId | null>(null)

const { waitingFor, waitRemainingMs, start: waitForRealEvent, cancel: cancelRealEventWait } = useRealEventWait()
const installError = ref('')
const removing = ref<AgentAdapterId | 'all' | null>(null)
const pendingRemoval = ref<AgentAdapterId | 'all' | null>(null)
const removalNotice = ref('')

const elapsedMs = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function startElapsedTimer() {
  const start = Date.now()
  elapsedMs.value = 0
  elapsedTimer = setInterval(() => { elapsedMs.value = Date.now() - start }, 100)
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

// Re-detect without throwing away what the user already learned: results of tests, diagnoses and
// the last install outcome survive a refresh. Only the very first load shows the full loader.
async function detectTools() {
  const firstLoad = tools.value.length === 0
  if (firstLoad) loading.value = true
  error.value = ''
  if (firstLoad) startElapsedTimer()
  try {
    const status = await Promise.race([
      window.electronAPI?.checkIntegration() ?? Promise.resolve(null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ])
    if (status) {
      const previous = new Map(tools.value.map(tool => [tool.id, tool]))
      tools.value = status.adapters.map((adapter) => {
        const old = previous.get(adapter.id)
        return {
          ...adapter,
          verifiedAt: old?.verifiedAt,
          testError: old?.testError,
          diagnosis: old?.diagnosis,
          outcome: old?.outcome,
        }
      })
    } else if (firstLoad) {
      error.value = t('couldNotDetectTools')
    }
  } catch {
    if (firstLoad) error.value = t('failedToDetectTools')
  }
  loading.value = false
  stopElapsedTimer()
}

const installSummary = ref('')

// Every selected tool is installed independently; one failure never blocks the others.
async function install(target?: AgentAdapterId) {
  installing.value = target ?? 'all'
  installError.value = ''
  installSummary.value = ''
  let succeeded = 0
  let failed = 0
  try {
    const targets = target
      ? [target]
      : tools.value.filter(tool => tool.installable).map(tool => tool.id)
    for (const adapterId of targets) {
      const tool = tools.value.find(item => item.id === adapterId)
      if (tool) {
        tool.verifiedAt = undefined
        tool.testError = undefined
        tool.outcome = undefined
      }
      try {
        const result = await window.electronAPI?.installAdapter(adapterId)
        const outcome: InstallOutcome = result?.outcome ?? {
          adapterId,
          action: result?.ok ? 'installed' : 'failed',
          changedFiles: [],
          backupPaths: [],
          ...(result?.ok ? {} : { errorCode: 'unknown' as const }),
        }
        if (tool) tool.outcome = outcome
        if (outcome.action === 'failed') failed += 1
        else succeeded += 1
      } catch {
        failed += 1
        if (tool) tool.outcome = { adapterId, action: 'failed', changedFiles: [], backupPaths: [], errorCode: 'unknown' }
      }
    }
  } catch {
    installError.value = t('installFailed')
  }
  if (!target) installSummary.value = t('onboarding.installSummary', { ok: succeeded, failed })
  installing.value = null
  await detectTools()
}

function actionLabel(tool: ToolStatus): string {
  if (installing.value === tool.id) return t('installing')
  if (tool.health === 'ready') return t('reinstall')
  return t(tool.health === 'degraded' ? 'onboarding.repair' : 'install')
}

function requestRemoval(target: AgentAdapterId | 'all') {
  if (installing.value !== null || removing.value !== null) return
  pendingRemoval.value = target
}

// Removal only strips Agent Pets' own entries in main; the confirm text spells out what is kept.
async function confirmRemoval() {
  const target = pendingRemoval.value
  pendingRemoval.value = null
  if (!target) return
  removing.value = target
  installError.value = ''
  removalNotice.value = ''
  try {
    const result = target === 'all'
      ? await window.electronAPI?.uninstallIntegrations('all')
      : await window.electronAPI?.uninstallAdapter(target)
    if (result && !result.ok) {
      installError.value = translateBackendError(result.error || t('onboarding.removeFailed'))
    } else {
      removalNotice.value = t(target === 'all' ? 'onboarding.cleanupDone' : 'onboarding.removeDone')
    }
  } catch {
    installError.value = t('onboarding.removeFailed')
  }
  removing.value = null
  await detectTools()
}

function removalTitle(): string {
  const target = pendingRemoval.value
  if (target === 'all') return t('onboarding.cleanupTitle')
  const tool = tools.value.find(item => item.id === target)
  return t('onboarding.removeTitle', { name: tool?.displayName ?? '' })
}

function removalMessage(): string {
  return pendingRemoval.value === 'all' ? t('onboarding.cleanupBody') : t('onboarding.removeBody')
}

async function testIntegration(tool: ToolStatus) {
  if (!tool.testSource) return
  testing.value = tool.testSource
  tool.testError = undefined
  try {
    const result = await window.electronAPI?.testIntegration(tool.testSource)
    if (result?.ok && result.verifiedAt) {
      tool.verifiedAt = result.verifiedAt
    } else {
      tool.testError = translateBackendError(result?.error || t('liveEventTestFailed'))
    }
  } catch {
    tool.testError = t('liveEventTestFailed')
  }
  testing.value = null
}

async function diagnoseAdapter(tool: ToolStatus) {
  diagnosing.value = tool.id
  tool.testError = undefined
  try {
    const result = await window.electronAPI?.diagnoseAdapter(tool.id)
    if (result?.ok && result.report) {
      tool.diagnosis = result.report
    } else {
      tool.testError = translateBackendError(result?.error || t('diagnosisFailed'))
    }
  } catch {
    tool.testError = t('diagnosisFailed')
  }
  diagnosing.value = null
}

const overlayRef = ref<HTMLElement | null>(null)
const wizardRef = ref<HTMLElement | null>(null)
const titleId = `setup-wizard-${useId()}-title`
useDialogA11y({
  open: ref(true),
  container: wizardRef,
  scope: overlayRef,
  onClose: finish,
})

onMounted(() => {
  detectTools()
})

onUnmounted(() => {
  stopElapsedTimer()
})
</script>

<template>
  <div ref="overlayRef" class="setup-overlay" @click.self="finish">
    <div ref="wizardRef" class="setup-wizard" role="dialog" aria-modal="true" tabindex="-1" :aria-labelledby="titleId">
      <div class="wizard-header">
        <div class="wizard-title-copy">
          <h2 :id="titleId">{{ t('setupWizardTitle') }}</h2>
          <p>{{ t('setupWizardHelp') }}</p>
        </div>
        <Button variant="ghost" icon-only :aria-label="t('close')" @click="finish">
          <Icon name="close" />
        </Button>
      </div>

      <div v-if="step === 'intro'" class="intro">
        <Card v-for="card in INTRO_CARDS" :key="card.title" class="intro-card">
          <div class="intro-card-head">
            <Icon :name="card.icon" :size="18" />
            <strong>{{ t(card.title) }}</strong>
          </div>
          <p>{{ t(card.body) }}</p>
        </Card>
        <p class="wizard-note">{{ t('onboarding.introNext') }}</p>
      </div>

      <div v-else-if="loading" class="loading">
        <div class="pixel-loader">
          <span v-for="i in 9" :key="i" class="pixel-cell" :style="{ animationDelay: `${(i % 3) * 0.12}s` }" />
        </div>
        <span>{{ t('detectingTools') }}</span>
        <span class="elapsed">{{ formatNumber(elapsedMs / 1000, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}s</span>
      </div>

      <div v-else-if="error" class="error-msg">
        {{ error }}
        <Button variant="secondary" size="sm" @click="detectTools">{{ t('retry') }}</Button>
      </div>

      <div v-else class="tools-list">
        <SetupWizardToolCard
          v-for="tool in tools"
          :key="tool.id"
          :tool="tool"
          :action-label="actionLabel(tool)"
          :busy="installing !== null || testing !== null || diagnosing !== null"
          :removing-any="removing !== null"
          :removing="removing === tool.id"
          :testing="testing !== null && testing === tool.testSource"
          :diagnosing="diagnosing === tool.id"
          :waiting="waitingFor === tool.id"
          :wait-remaining-ms="waitRemainingMs"
          @install="install(tool.id)"
          @remove="requestRemoval(tool.id)"
          @test="testIntegration(tool)"
          @diagnose="diagnoseAdapter(tool)"
          @toggle-wait="waitingFor === tool.id ? cancelRealEventWait() : waitForRealEvent(tool)"
        />
      </div>

      <template v-if="step === 'intro'">
        <div class="wizard-actions">
          <Button variant="ghost" @click="finish">{{ t('onboarding.skipForNow') }}</Button>
          <Button variant="primary" @click="step = 'tools'">{{ t('onboarding.start') }}</Button>
        </div>
      </template>
      <template v-else>
      <p class="wizard-note">{{ t('adapterNote') }}</p>

        <div v-if="installError" class="error-msg" role="alert">{{ installError }}</div>
        <p v-if="installSummary" class="wizard-note" role="status">{{ installSummary }}</p>
        <p v-else-if="removalNotice" class="wizard-note" role="status">{{ removalNotice }}</p>

        <div class="wizard-actions">
          <Button
            variant="ghost"
            class="cleanup-btn"
            :disabled="installing !== null || removing !== null"
            @click="requestRemoval('all')"
          >
            {{ removing === 'all' ? t('removing') : t('onboarding.cleanupAll') }}
          </Button>
          <Button variant="secondary" @click="detectTools">{{ t('refresh') }}</Button>
          <Button variant="primary" :disabled="installing !== null" @click="install()">
            {{ installing === 'all' ? t('installing') : t('installAll') }}
          </Button>
        </div>
        <p v-if="anyReady" class="wizard-note" role="status">{{ t('onboarding.nextSteps') }}</p>
        <div v-if="anyReady" class="wizard-actions">
          <Button variant="primary" @click="finish">{{ t('onboarding.finish') }}</Button>
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="pendingRemoval !== null"
      :title="removalTitle()"
      :message="removalMessage()"
      tone="danger"
      :confirm-label="t('remove')"
      @confirm="confirmRemoval"
      @cancel="pendingRemoval = null"
    />
  </div>
</template>

<style scoped src="@/components/SetupWizard.css"></style>
