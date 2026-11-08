<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDialogA11y } from '@/composables/useDialogA11y'
import type {
  ProjectMcpClientId,
  ProjectMcpInstallStatus,
  ProjectMcpPlan,
  ProjectMcpPlanClient,
  ProjectMcpProjectRecord,
  ProjectMcpProjectStatus,
  ProjectMcpRemovalStatus,
  ProjectMcpResultCode,
  ProjectMcpSetupSummary,
} from '@/types/project-mcp'
import { t, translateBackendError, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Icon from '@/components/ui/Icon.vue'

const emit = defineEmits<{
  (event: 'close'): void
}>()

const settingUp = ref(false)
const setupResult = ref<ProjectMcpSetupSummary | null>(null)
const setupError = ref('')
const projects = ref<ProjectMcpProjectRecord[]>([])
const loadingProjects = ref(false)
const listError = ref('')
const registryRecovered = ref(false)
const removingProject = ref<string | null>(null)

async function refreshProjects(): Promise<void> {
  if (loadingProjects.value) return
  loadingProjects.value = true
  listError.value = ''
  try {
    const result = await window.electronAPI?.listProjectMcp()
    if (!result?.ok) {
      listError.value = translateBackendError(result?.error || t('mcpListFailed'))
      return
    }
    projects.value = result.projects
    registryRecovered.value = result.recovered === true
  } catch {
    listError.value = t('mcpListFailed')
  } finally {
    loadingProjects.value = false
  }
}

// Three steps: pick a folder (nothing is written), review the plan, then apply the chosen clients.
const phase = ref<'list' | 'review'>('list')
const plan = ref<ProjectMcpPlan | null>(null)
const selected = ref<ProjectMcpClientId[]>([])
const localOnly = ref(true)
const copiedKey = ref('')

async function chooseProject(): Promise<void> {
  if (settingUp.value) return
  settingUp.value = true
  setupError.value = ''
  setupResult.value = null
  try {
    const result = await window.electronAPI?.setupProjectMcp()
    if (result?.cancelled) return
    if (!result?.ok || !result.clients) {
      setupError.value = translateBackendError(result?.error || t('mcpSetupFailed'))
      return
    }
    plan.value = result
    // Pre-select clients that look in use and can actually be edited; the user confirms.
    selected.value = result.clients
      .filter(item => item.suggested && isSelectable(item))
      .map(item => item.client)
    localOnly.value = true
    phase.value = 'review'
  } catch {
    setupError.value = t('mcpSetupFailed')
  } finally {
    settingUp.value = false
  }
}

function isSelectable(item: ProjectMcpPlanClient): boolean {
  return item.status === 'not_configured'
}

function cancelReview(): void {
  phase.value = 'list'
  plan.value = null
}

const selectedTracked = computed(() => (
  plan.value?.clients?.filter(item => selected.value.includes(item.client) && item.gitTracked === true) ?? []
))

async function applySetup(): Promise<void> {
  const current = plan.value
  if (settingUp.value || !current?.projectPath || selected.value.length === 0) return
  settingUp.value = true
  setupError.value = ''
  try {
    const result = await window.electronAPI?.applyProjectMcp({
      projectPath: current.projectPath,
      clients: [...selected.value],
      localOnly: localOnly.value,
    })
    if (!result) {
      setupError.value = t('mcpSetupFailed')
      return
    }
    setupResult.value = result
    phase.value = 'list'
    plan.value = null
    await refreshProjects()
  } catch {
    setupError.value = t('mcpSetupFailed')
  } finally {
    settingUp.value = false
  }
}

function toggleClient(client: ProjectMcpClientId, checked: boolean): void {
  selected.value = checked
    ? [...new Set([...selected.value, client])]
    : selected.value.filter(item => item !== client)
}

async function copyText(key: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 2000)
  } catch {
    // Clipboard can be unavailable; the text stays visible in the preview.
  }
}

const RESULT_CODE_KEYS: Partial<Record<ProjectMcpResultCode, TranslationKey>> = {
  installed: 'onboarding.mcpCode.installed',
  already_configured: 'onboarding.mcpCode.already_configured',
  not_configured: 'onboarding.mcpCode.not_configured',
  removed: 'onboarding.mcpCode.removed',
  already_absent: 'onboarding.mcpCode.already_absent',
  entry_changed: 'onboarding.mcpCode.entry_changed',
  server_mismatch: 'onboarding.mcpCode.server_mismatch',
  servers_not_object: 'onboarding.mcpCode.servers_not_object',
  legacy_format: 'onboarding.mcpCode.legacy_format',
  jsonc: 'onboarding.mcpCode.jsonc',
  invalid_json: 'onboarding.mcpCode.invalid_json',
  root_not_object: 'onboarding.mcpCode.root_not_object',
  too_large: 'onboarding.mcpCode.too_large',
  unsafe_file: 'onboarding.mcpCode.unsafe_file',
  write_failed: 'onboarding.mcpCode.write_failed',
  stale_paths: 'onboarding.mcpCode.stale_paths',
  updated: 'onboarding.mcpCode.updated',
}

function resultMessage(code: ProjectMcpResultCode | undefined, fallback?: string): string {
  const key = code ? RESULT_CODE_KEYS[code] : undefined
  return key ? t(key) : translateBackendError(fallback ?? '')
}

const NEXT_STEP_KEYS: Record<ProjectMcpClientId, { hint: TranslationKey, command: string }> = {
  claude: { hint: 'onboarding.mcpNext.claude', command: 'claude mcp list' },
  codex: { hint: 'onboarding.mcpNext.codex', command: 'codex mcp list' },
  opencode: { hint: 'onboarding.mcpNext.opencode', command: 'opencode mcp list' },
}

// Two projects can share a folder name; show the parent folder only when needed.
function displayName(project: ProjectMcpProjectRecord): string {
  const duplicates = projects.value.filter(item => item.projectName === project.projectName).length > 1
  if (!duplicates) return project.projectName
  const parts = project.projectPath.split(/[\\/]/).filter(Boolean)
  const parent = parts.length >= 2 ? parts[parts.length - 2] : ''
  return parent ? `${project.projectName} (${parent})` : project.projectName
}

const repairingClient = ref('')

// Re-points a stale Agent Pets entry (App moved, Node upgraded) at the current paths. Customized
// entries are never touched; the main process decides what counts as "ours".
async function updateStaleClient(project: ProjectMcpProjectRecord, client: ProjectMcpClientId): Promise<void> {
  if (repairingClient.value) return
  repairingClient.value = `${project.projectPath}:${client}`
  listError.value = ''
  try {
    const result = await window.electronAPI?.applyProjectMcp({
      projectPath: project.projectPath,
      clients: [client],
      localOnly: false,
      updateStale: true,
    })
    if (!result?.ok) listError.value = translateBackendError(result?.error || t('mcpSetupFailed'))
    await refreshProjects()
  } catch {
    listError.value = t('mcpSetupFailed')
  } finally {
    repairingClient.value = ''
  }
}

function connectedCount(project: ProjectMcpProjectRecord): number {
  return project.results.filter(item => item.status === 'already_configured').length
}

const installedClients = computed(() => (
  setupResult.value?.results.filter(item => item.status === 'installed') ?? []
))

const MCP_CLIENT_LABEL_KEYS: Record<string, TranslationKey> = {
  codex: 'clientCodex',
  claude: 'clientClaudeCode',
}

function projectMcpClientLabel(client: string): string {
  return t(MCP_CLIENT_LABEL_KEYS[client] ?? 'clientOpenCode')
}

const INSTALL_STATUS_LABEL_KEYS: Partial<Record<ProjectMcpInstallStatus, TranslationKey>> = {
  installed: 'mcpInstalled',
  already_configured: 'mcpAlreadyConfigured',
  conflict: 'mcpConflictUnchanged',
  stale: 'onboarding.mcpStale',
  not_configured: 'onboarding.mcpPlanNone',
}

function installStatusLabel(status: ProjectMcpInstallStatus): string {
  return t(INSTALL_STATUS_LABEL_KEYS[status] ?? 'failed')
}

const PROJECT_STATUS_LABEL_KEYS: Partial<Record<ProjectMcpProjectStatus, TranslationKey>> = {
  connected: 'connected',
  partial: 'partial',
  stale: 'onboarding.mcpStale',
  conflict: 'conflict',
  missing: 'folderMissing',
}

function projectStatusLabel(status: ProjectMcpProjectStatus): string {
  return t(PROJECT_STATUS_LABEL_KEYS[status] ?? 'checkFailed')
}

// Drives both the status pill colour and each Card's semantic tone, so the
// same "this connection needs attention" signal reads the same way whether
// you're scanning pills or cards.
const PROJECT_STATUS_TONE: Partial<Record<ProjectMcpProjectStatus, 'success' | 'warn' | 'neutral'>> = {
  connected: 'success',
  partial: 'warn',
  stale: 'warn',
  missing: 'warn',
  conflict: 'warn',
  error: 'warn',
}

function projectStatusTone(status: ProjectMcpProjectStatus): 'success' | 'warn' | 'neutral' {
  return PROJECT_STATUS_TONE[status] ?? 'neutral'
}

function removalSummaryLabel(statuses: ProjectMcpRemovalStatus[]): string {
  return statuses.includes('conflict') ? t('mcpEntryChanged') : t('mcpRemoveFailed')
}

// Native confirm() steals focus, which the main process reads as a blur and
// hides the panel mid-confirmation — see components/ui/ConfirmDialog.vue.
const pendingRemoval = ref<ProjectMcpProjectRecord | null>(null)

function requestRemoveProject(project: ProjectMcpProjectRecord): void {
  if (removingProject.value) return
  pendingRemoval.value = project
}

async function confirmRemoveProject(): Promise<void> {
  const project = pendingRemoval.value
  pendingRemoval.value = null
  if (project) await removeProject(project)
}

async function removeProject(project: ProjectMcpProjectRecord): Promise<void> {
  if (removingProject.value) return
  removingProject.value = project.projectPath
  listError.value = ''
  try {
    const result = await window.electronAPI?.removeProjectMcp(project.projectPath)
    if (!result?.ok) {
      listError.value = translateBackendError(
        result?.error || removalSummaryLabel(result?.results.map(item => item.status) ?? []),
      )
    }
    await refreshProjects()
  } catch {
    listError.value = t('mcpRemoveFailed')
  } finally {
    removingProject.value = null
  }
}

async function forgetProject(project: ProjectMcpProjectRecord): Promise<void> {
  if (removingProject.value) return
  removingProject.value = project.projectPath
  listError.value = ''
  try {
    const result = await window.electronAPI?.forgetProjectMcp(project.projectPath)
    if (result && !result.ok) listError.value = translateBackendError(result.error || t('mcpRemoveFailed'))
    await refreshProjects()
  } catch {
    listError.value = t('mcpRemoveFailed')
  } finally {
    removingProject.value = null
  }
}

const overlayRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
useDialogA11y({
  open: ref(true),
  container: panelRef,
  scope: overlayRef,
  onClose: () => emit('close'),
})

onMounted(() => {
  void refreshProjects()
})
</script>

<template>
  <div ref="overlayRef" class="mcp-overlay" @click.self="emit('close')">
    <div
      ref="panelRef"
      class="mcp-wizard"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      :aria-label="t('projectMcpPanelTitle')"
    >
      <div class="wizard-header">
        <div class="mcp-title-copy">
          <h2>{{ t('projectMcpPanelTitle') }}</h2>
          <p>{{ t('projectMcpPanelHelp') }}</p>
        </div>
        <Button variant="ghost" icon-only :aria-label="t('projectMcpClose')" @click="emit('close')">
          <Icon name="close" />
        </Button>
      </div>

      <p class="mcp-review-help">{{ t('onboarding.mcpConcepts') }}</p>

      <div class="mcp-toolbar">
        <Button v-if="phase === 'list'" variant="primary" :disabled="settingUp" @click="chooseProject">
          <Icon name="plus" :size="17" />
          {{ settingUp ? t('installing') : t('onboarding.mcpChooseFolder') }}
        </Button>
        <Button variant="secondary" :disabled="loadingProjects" @click="refreshProjects">
          {{ loadingProjects ? t('checking') : t('refresh') }}
        </Button>
        <span class="mcp-count" aria-live="polite">{{ projects.length }}</span>
      </div>

      <div v-if="setupError" class="error-msg" role="alert">{{ setupError }}</div>

      <Card v-if="phase === 'review' && plan" tone="accent" class="mcp-review">
        <div class="mcp-result-title" :title="plan.projectPath">{{ plan.projectPath }}</div>
        <p class="mcp-review-help">{{ t('onboarding.mcpReviewHelp') }}</p>
        <div v-for="item in plan.clients" :key="item.client" class="mcp-review-row" :class="`mcp-${item.status}`">
          <div class="mcp-review-check">
            <Checkbox
              :model-value="selected.includes(item.client)"
              :label="projectMcpClientLabel(item.client)"
              :disabled="!isSelectable(item) || settingUp"
              @update:model-value="toggleClient(item.client, $event)"
            />
            <span v-if="item.suggested" class="mcp-tag">{{ t('onboarding.mcpDetected') }}</span>
          </div>
          <div class="mcp-review-file">
            <code>{{ item.relativePath }}</code>
            <span>
              {{ item.status === 'already_configured'
                ? t('onboarding.mcpPlanConfigured')
                : item.status === 'not_configured'
                  ? (item.exists ? t('onboarding.mcpPlanModify') : t('onboarding.mcpPlanCreate'))
                  : resultMessage(item.code, item.message) }}
            </span>
          </div>
          <div v-if="item.gitTracked === true" class="mcp-inline-error">{{ t('onboarding.mcpTrackedWarning') }}</div>
          <details v-if="item.status === 'not_configured'" class="mcp-preview">
            <summary>{{ t('onboarding.mcpPreview') }}</summary>
            <pre>{{ item.preview }}</pre>
          </details>
        </div>
        <Checkbox
          v-if="plan.isGitRepo"
          v-model="localOnly"
          class="mcp-local-only"
          :label="t('onboarding.mcpLocalOnly')"
          :help="t('onboarding.mcpLocalOnlyHelp')"
          :disabled="settingUp"
        />
        <p v-else class="mcp-review-help">{{ t('onboarding.mcpNotGitRepo') }}</p>
        <div v-if="selectedTracked.length" class="mcp-inline-error">{{ t('onboarding.mcpTrackedSelected') }}</div>
        <div class="mcp-review-actions">
          <Button variant="secondary" size="sm" :disabled="settingUp" @click="cancelReview">{{ t('back') }}</Button>
          <Button variant="primary" size="sm" :disabled="settingUp || selected.length === 0" @click="applySetup">
            {{ settingUp ? t('installing') : t('onboarding.mcpApply') }}
          </Button>
        </div>
      </Card>

      <Card v-if="setupResult && phase === 'list'" tone="accent" role="status" aria-live="polite">
        <div class="mcp-result-title" :title="setupResult.projectPath">{{ setupResult.projectPath || t('projectMcpNoProject') }}</div>
        <div
          v-for="item in setupResult.results"
          :key="item.client"
          class="mcp-result-row"
          :class="`mcp-${item.status}`"
        >
          <span class="mcp-client">{{ projectMcpClientLabel(item.client) }}</span>
          <span>{{ installStatusLabel(item.status) }}</span>
          <span class="mcp-message mcp-path">
            <code :title="item.configPath">{{ item.configPath }}</code>
            <Button variant="ghost" size="sm" @click="copyText(`path-${item.client}`, item.configPath)">
              {{ copiedKey === `path-${item.client}` ? t('onboarding.mcpCopied') : t('onboarding.mcpCopyPath') }}
            </Button>
          </span>
          <span v-if="item.status !== 'installed' && item.status !== 'already_configured'" class="mcp-message">
            {{ resultMessage(item.code, item.message) }}
          </span>
          <span v-if="item.manualSnippet && item.status !== 'installed' && item.status !== 'already_configured'" class="mcp-message">
            <Button variant="secondary" size="sm" @click="copyText(`snippet-${item.client}`, item.manualSnippet)">
              {{ copiedKey === `snippet-${item.client}` ? t('onboarding.mcpCopied') : t('onboarding.mcpCopySnippet') }}
            </Button>
          </span>
        </div>
        <div v-if="setupResult.error" class="mcp-inline-error">{{ translateBackendError(setupResult.error) }}</div>
        <div v-else-if="!setupResult.ok" class="mcp-inline-error">{{ t('resultNeedsAttention') }}</div>
        <p v-if="setupResult.excluded?.length" class="mcp-review-help">
          {{ t('onboarding.mcpExcluded', { files: setupResult.excluded.join(', ') }) }}
        </p>
        <div v-for="warning in setupResult.warnings ?? []" :key="warning" class="mcp-inline-error" role="alert">
          {{ warning === 'git_outside_project' ? t('onboarding.mcpWarnGitOutside') : t('onboarding.mcpWarnExcludeFailed') }}
        </div>
        <div v-if="setupResult.trackedFiles?.length" class="mcp-inline-error">
          {{ t('onboarding.mcpTrackedResult', { files: setupResult.trackedFiles.join(', ') }) }}
        </div>
        <div v-for="item in installedClients" :key="`next-${item.client}`" class="mcp-next">
          <span>{{ t(NEXT_STEP_KEYS[item.client].hint) }}</span>
          <Button variant="ghost" size="sm" @click="copyText(`cmd-${item.client}`, NEXT_STEP_KEYS[item.client].command)">
            {{ copiedKey === `cmd-${item.client}` ? t('onboarding.mcpCopied') : t('onboarding.mcpCopyCommand', { command: NEXT_STEP_KEYS[item.client].command }) }}
          </Button>
        </div>
      </Card>

      <div class="mcp-list-heading">
        <div>
          <h3>{{ t('connectedProjects') }}</h3>
          <p>{{ t('connectedProjectsHelp') }}</p>
        </div>
      </div>

      <div v-if="listError" class="error-msg mcp-list-error" role="alert">{{ listError }}</div>
      <p v-if="registryRecovered" class="mcp-review-help" role="status">{{ t('onboarding.mcpRecovered') }}</p>
      <div v-if="loadingProjects && projects.length === 0" class="mcp-empty">{{ t('checking') }}</div>
      <div v-else-if="projects.length === 0" class="mcp-empty">{{ t('noProjectsConnected') }}</div>
      <div v-else class="tools-list" role="list" :aria-label="t('connectedMcpProjects')">
        <Card
          v-for="project in projects"
          :key="project.projectPath"
          :class="[`mcp-project-card`, `project-${project.status}`]"
          :tone="projectStatusTone(project.status)"
          role="listitem"
        >
          <div class="mcp-project-heading">
            <div class="mcp-project-name" :title="project.projectPath">{{ displayName(project) }}</div>
            <span class="mcp-project-status" :class="`status-${projectStatusTone(project.status)}`">
              {{ projectStatusLabel(project.status) }}
            </span>
          </div>
          <div class="mcp-project-path" :title="project.projectPath">{{ project.projectPath }}</div>
          <div v-if="project.results.length" class="mcp-client-list">
            <span class="mcp-count-chip">{{ t('onboarding.mcpConnectedCount', { ok: connectedCount(project), total: project.results.length }) }}</span>
            <span v-for="item in project.results" :key="item.client" :class="`mcp-${item.status}`">
              {{ projectMcpClientLabel(item.client) }}: {{ installStatusLabel(item.status) }}
              <Button
                v-if="item.status === 'stale'"
                variant="secondary"
                size="sm"
                :disabled="repairingClient !== ''"
                @click="updateStaleClient(project, item.client)"
              >
                {{ repairingClient === `${project.projectPath}:${item.client}` ? t('installing') : t('onboarding.mcpUpdatePaths') }}
              </Button>
            </span>
          </div>
          <div v-if="project.status === 'error' && project.error" class="mcp-inline-error">{{ translateBackendError(project.error) }}</div>
          <div class="mcp-project-actions">
            <Button
              v-if="project.status === 'missing'"
              variant="secondary"
              size="sm"
              :disabled="removingProject === project.projectPath"
              @click="forgetProject(project)"
            >
              {{ t('forgetRecord') }}
            </Button>
            <Button
              v-else
              variant="danger"
              size="sm"
              :disabled="removingProject === project.projectPath"
              @click="requestRemoveProject(project)"
            >
              {{ removingProject === project.projectPath ? t('removing') : t('removeMcp') }}
            </Button>
          </div>
        </Card>
      </div>

      <p class="wizard-note">{{ t('projectMcpSafetyNote') }}</p>

      <div class="wizard-actions">
        <Button variant="secondary" size="sm" block @click="emit('close')">{{ t('projectMcpClose') }}</Button>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingRemoval !== null"
      :title="t('removeMcp')"
      :message="pendingRemoval
        ? `${t('projectMcpRemoveConfirm', { project: pendingRemoval.projectName })}\n\n${t('projectMcpRemoveConfirmDetail')}`
        : ''"
      tone="danger"
      @confirm="confirmRemoveProject"
      @cancel="pendingRemoval = null"
    />
  </div>
</template>

<style scoped src="@/components/ProjectMcpPanel.css"></style>
