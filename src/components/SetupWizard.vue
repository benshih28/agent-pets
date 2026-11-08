<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, useId } from 'vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import type {
  AdapterRuntimeStatus,
  AgentAdapterId,
  DiagnosticReport,
  InstallErrorCode,
  InstallOutcome,
} from '@/types/agent-adapter'
import { SOURCE_LABELS, type AgentSource } from '@/types/agent'
import { locale, t, translateBackendError, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Icon from '@/components/ui/Icon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { formatNumber, formatTimeFull } from '@/utils/intl-format'

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

interface ToolStatus extends AdapterRuntimeStatus {
  verifiedAt?: number
  testError?: string
  diagnosis?: DiagnosticReport
  /** Result of the last install/repair, shown inside the card until the next one. */
  outcome?: InstallOutcome
  /** A genuine event from the tool itself (not the built-in receiver test). */
  realEvent?: { source: AgentSource, at: number }
  realEventTimedOut?: boolean
}

const tools = ref<ToolStatus[]>([])

const loading = ref(true)
const error = ref('')
const installing = ref<AgentAdapterId | 'all' | null>(null)
const testing = ref<AgentSource | null>(null)
const diagnosing = ref<AgentAdapterId | null>(null)

// "Wait for a real event": listens for an event the tool itself sends, so a broken hook or a wrong
// Node path cannot be hidden by the receiver test (which never involves the tool).
const REAL_EVENT_WAIT_MS = 30_000
const waitingFor = ref<AgentAdapterId | null>(null)
const waitRemainingMs = ref(0)
let stopWaiting: (() => void) | null = null

function cancelRealEventWait() {
  stopWaiting?.()
  stopWaiting = null
  waitingFor.value = null
}

function waitForRealEvent(tool: ToolStatus) {
  cancelRealEventWait()
  tool.realEvent = undefined
  tool.realEventTimedOut = false
  waitingFor.value = tool.id
  const deadline = Date.now() + REAL_EVENT_WAIT_MS
  waitRemainingMs.value = REAL_EVENT_WAIT_MS
  const tick = setInterval(() => {
    waitRemainingMs.value = Math.max(0, deadline - Date.now())
    if (waitRemainingMs.value === 0) {
      tool.realEventTimedOut = true
      cancelRealEventWait()
    }
  }, 250)
  const unsubscribe = window.electronAPI?.onAgentStatusEvent((raw: unknown) => {
    const event = raw as { source?: AgentSource, sessionId?: string, originalEvent?: string }
    if (!event?.source || !tool.sources.includes(event.source)) return
    if (event.originalEvent === 'AgentPetsIntegrationTest' || event.sessionId?.startsWith('agent-pets-test-')) return
    tool.realEvent = { source: event.source, at: Date.now() }
    cancelRealEventWait()
  })
  stopWaiting = () => {
    clearInterval(tick)
    unsubscribe?.()
  }
}
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

const INSTALL_ERROR_KEYS: Record<InstallErrorCode, TranslationKey> = {
  config_unparseable: 'onboarding.errorConfigUnparseable',
  config_unsafe: 'onboarding.errorConfigUnsafe',
  config_too_large: 'onboarding.errorConfigTooLarge',
  permission_denied: 'onboarding.errorPermissionDenied',
  file_busy: 'onboarding.errorFileBusy',
  read_only: 'onboarding.errorReadOnly',
  node_missing: 'onboarding.errorNodeMissing',
  node_unsupported: 'onboarding.errorNodeUnsupported',
  unknown: 'onboarding.errorUnknown',
}

function outcomeText(outcome: InstallOutcome): string {
  if (outcome.action === 'failed') {
    const code = outcome.errorCode ?? 'unknown'
    const raw = outcome.errorPath ?? ''
    const isConfigIssue = code.startsWith('config_')
    return t(INSTALL_ERROR_KEYS[code], { path: isConfigIssue ? raw : raw ? ` (${raw})` : '' })
  }
  return t(`onboarding.outcome.${outcome.action}`, { count: outcome.changedFiles.length })
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

const RESTART_KEYS: Record<AgentAdapterId, TranslationKey> = {
  opencode: 'onboarding.restartOpenCode',
  codex: 'onboarding.restartCodex',
  'claude-code': 'onboarding.restartClaudeCode',
  'generic-http': 'onboarding.restartOpenCode',
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

const CHECK_KEYS: Readonly<Record<string, TranslationKey>> = {
  'runtime.warn': 'onboarding.check.runtime.warn',
  'opencode-cli.pass': 'onboarding.check.opencode-cli.pass',
  'opencode-cli.warn': 'onboarding.check.opencode-cli.warn',
  'opencode-desktop.pass': 'onboarding.check.opencode-desktop.pass',
  'opencode-desktop.warn': 'onboarding.check.opencode-desktop.warn',
  'plugin-current.pass': 'onboarding.check.plugin-current.pass',
  'plugin-current.warn': 'onboarding.check.plugin-current.warn',
  'permission-channel.pass': 'onboarding.check.permission-channel.pass',
  'hooks-file.pass': 'onboarding.check.hooks-file.pass',
  'hooks-file.fail': 'onboarding.check.hooks-file.fail',
  'hooks-enabled.pass': 'onboarding.check.hooks-enabled.pass',
  'hooks-enabled.fail': 'onboarding.check.hooks-enabled.fail',
  'settings-file.pass': 'onboarding.check.settings-file.pass',
  'settings-file.fail': 'onboarding.check.settings-file.fail',
  'hook-script.pass': 'onboarding.check.hook-script.pass',
  'hook-script.fail': 'onboarding.check.hook-script.fail',
  'hook-script-current.pass': 'onboarding.check.hook-script-current.pass',
  'hook-script-current.warn': 'onboarding.check.hook-script-current.warn',
  'hook-command.pass': 'onboarding.check.hook-command.pass',
  'hook-command.fail': 'onboarding.check.hook-command.fail',
  'node.pass': 'onboarding.check.node.pass',
  'node.fail': 'onboarding.check.node.fail',
  'agent-present.pass': 'onboarding.check.agent-present.pass',
  'agent-present.warn': 'onboarding.check.agent-present.warn',
  'loopback.pass': 'onboarding.check.loopback.pass',
  'token.pass': 'onboarding.check.token.pass',
  'permissions.pass': 'onboarding.check.permissions.pass',
}

const FIX_KEYS: Readonly<Record<string, TranslationKey>> = {
  'hooks-file': 'onboarding.fix.hooks-file',
  'hooks-enabled': 'onboarding.fix.hooks-enabled',
  'settings-file': 'onboarding.fix.settings-file',
  'hook-script': 'onboarding.fix.hook-script',
  'hook-script-current': 'onboarding.fix.hook-script-current',
  'plugin-current': 'onboarding.fix.plugin-current',
  'hook-command': 'onboarding.fix.hook-command',
  'node': 'onboarding.fix.node',
}

const SUMMARY_KEYS: Readonly<Record<string, TranslationKey>> = {
  ready: 'onboarding.summary.ready',
  needs_install: 'onboarding.summary.needs_install',
  degraded: 'onboarding.summary.degraded',
  needs_approval: 'onboarding.summary.needs_approval',
  error: 'onboarding.summary.error',
}

function checkText(check: { id: string, status: string, code?: string, message: string }): string {
  const key = check.code ? CHECK_KEYS[check.code] : undefined
  return key ? t(key) : check.message
}

function checkFix(check: { id: string, status: string }): string {
  const key = check.status === 'pass' ? undefined : FIX_KEYS[check.id]
  return key ? t(key) : ''
}

function summaryText(tool: ToolStatus): string {
  const key = SUMMARY_KEYS[tool.health]
  return key ? t(key) : (tool.message ?? "")
}

const HEALTH_LABEL_KEYS: Partial<Record<ToolStatus['health'], TranslationKey>> = {
  ready: 'healthReady',
  needs_install: 'healthNeedsInstall',
  degraded: 'healthDegraded',
  needs_approval: 'healthNeedsApproval',
}

function healthLabel(tool: ToolStatus): string {
  return t(HEALTH_LABEL_KEYS[tool.health] ?? 'healthError')
}

interface CapabilityRow {
  id: string
  supported: boolean
  label: string
}

// Plain-language capability matrix. Permission distinguishes "answer on the pet" from "shown on the
// pet, answer in the tool" because that is the difference users actually run into.
function capabilityRows(tool: ToolStatus): CapabilityRow[] {
  const c = tool.capabilities
  const name = tool.displayName
  const permission = c.permissions === 'respond'
    ? t('onboarding.capPermissionRespond')
    : c.permissions === 'observe'
      ? t('onboarding.capPermissionObserve', { name })
      : t('onboarding.capPermissionNone')
  return [
    { id: 'status', supported: c.lifecycle, label: t('onboarding.capStatus') },
    { id: 'tools', supported: c.toolActivity, label: t('onboarding.capTools') },
    { id: 'input', supported: c.waitingInput, label: t('onboarding.capInput') },
    { id: 'permission', supported: c.permissions !== 'none', label: permission },
    { id: 'tokens', supported: c.tokenUsage !== 'none', label: t(c.tokenUsage === 'exact' ? 'onboarding.capTokensExact' : 'onboarding.capTokensEstimated') },
    { id: 'quota', supported: c.quota !== 'none', label: t('onboarding.capQuota') },
  ]
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
  cancelRealEventWait()
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
        <Card
          v-for="tool in tools"
          :key="tool.id"
          class="tool-item"
          :class="[`health-${tool.health}`, { connected: tool.health === 'ready', detected: tool.health !== 'ready' && tool.health !== 'error' }]"
          :tone="tool.health === 'ready' ? 'success' : tool.health === 'needs_install' ? 'accent' : 'neutral'"
        >
          <div class="tool-status">
            <span class="status-dot" :class="{ green: tool.health === 'ready', yellow: tool.health !== 'ready' && tool.health !== 'error', red: tool.health === 'error' }" />
            <span class="tool-name">{{ tool.displayName }}</span>
            <span class="tool-health">{{ healthLabel(tool) }}</span>
            <div class="tool-actions">
              <Button
                variant="secondary"
                size="sm"
                class="tool-action test-btn"
                v-if="tool.installable"
                :disabled="installing !== null || testing !== null || diagnosing !== null || removing !== null"
                :title="t('onboarding.waitRealTitle')"
                @click="waitingFor === tool.id ? cancelRealEventWait() : waitForRealEvent(tool)"
              >
                {{ waitingFor === tool.id ? t('cancel') : t('onboarding.waitReal') }}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                class="tool-action test-btn"
                v-if="tool.testSource"
                :disabled="installing !== null || testing !== null || diagnosing !== null"
                :title="t('onboarding.testReceiverTitle')"
                @click="testIntegration(tool)"
              >
                {{ testing === tool.testSource ? t('testing') : t('onboarding.testReceiver') }}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                class="tool-action test-btn"
                :disabled="installing !== null || testing !== null || diagnosing !== null"
                @click="diagnoseAdapter(tool)"
              >
                {{ diagnosing === tool.id ? t('diagnosing') : t('diagnose') }}
              </Button>
              <Button
                :variant="tool.health === 'ready' ? 'secondary' : 'primary'"
                size="sm"
                class="tool-action install-action install-btn"
                v-if="tool.installable && tool.installTarget"
                :disabled="installing !== null || testing !== null || diagnosing !== null || removing !== null"
                @click="install(tool.id)"
              >
                {{ actionLabel(tool) }}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                class="tool-action remove-btn"
                v-if="tool.installable && (tool.installed || tool.health === 'degraded')"
                :disabled="installing !== null || testing !== null || diagnosing !== null || removing !== null"
                @click="requestRemoval(tool.id)"
              >
                {{ removing === tool.id ? t('removing') : t('remove') }}
              </Button>
            </div>
          </div>
          <div class="tool-desc">{{ summaryText(tool) }}</div>
          <div class="source-list">
            <span v-for="source in tool.sourceLabels" :key="source" class="source-chip">{{ source }}</span>
          </div>
          <ul class="capability-list" :aria-label="t('onboarding.capTitle')">
            <li v-for="row in capabilityRows(tool)" :key="row.id" :class="row.supported ? 'cap-yes' : 'cap-no'">
              <Icon :name="row.supported ? 'check' : 'close'" :size="13" />
              <span>{{ row.label }}</span>
              <span class="visually-hidden">{{ row.supported ? t('onboarding.capSupported') : t('onboarding.capUnsupported') }}</span>
            </li>
          </ul>
          <div
            v-if="tool.outcome"
            class="test-result"
            :class="tool.outcome.action === 'failed' ? 'failed' : 'passed'"
            :role="tool.outcome.action === 'failed' ? 'alert' : 'status'"
          >
            {{ outcomeText(tool.outcome) }}
            <template v-if="tool.outcome.backupPaths.length">
              {{ t('onboarding.backupMade', { path: tool.outcome.backupPaths[0] ?? '' }) }}
            </template>
            <template v-if="tool.outcome.action === 'installed' || tool.outcome.action === 'repaired'">
              {{ t(RESTART_KEYS[tool.id]) }}
            </template>
          </div>
          <div v-if="waitingFor === tool.id" class="test-result" role="status">
            {{ t('onboarding.waitingReal', { name: tool.displayName, seconds: Math.ceil(waitRemainingMs / 1000) }) }}
          </div>
          <div v-else-if="tool.realEvent" class="test-result passed" role="status">
            {{ t('onboarding.realEventOk', { source: SOURCE_LABELS[tool.realEvent.source], time: formatTimeFull(tool.realEvent.at, locale) }) }}
          </div>
          <div v-else-if="tool.realEventTimedOut" class="test-result failed" role="alert">
            {{ t('onboarding.realEventTimeout', { name: tool.displayName }) }}
          </div>
          <div v-if="tool.verifiedAt" class="test-result passed">
            {{ t('receiverVerifiedAt', { time: formatTimeFull(tool.verifiedAt, locale) }) }}
          </div>
          <div v-else-if="tool.testError" class="test-result failed">{{ tool.testError }}</div>
          <div v-if="tool.diagnosis" class="diagnosis-list">
            <div v-for="check in tool.diagnosis.checks" :key="check.id" class="diagnosis-row" :class="`diagnosis-${check.status}`">
              <Icon
                :name="check.status === 'pass' ? 'check' : check.status === 'warn' ? 'warning' : 'close'"
                :size="14"
              />
              <span>{{ checkText(check) }}<template v-if="checkFix(check)"> {{ checkFix(check) }}</template></span>
            </div>
          </div>
        </Card>
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
