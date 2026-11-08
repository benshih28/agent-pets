<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { locale, t } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import {
  CLAUDE_PERMISSION_WAIT_MAX_SECONDS,
  CLAUDE_PERMISSION_WAIT_MIN_SECONDS,
  PERMISSION_DEFAULT_TTL_SECONDS,
} from '@/types/permission'
import Card from '@/components/ui/Card.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'
import Button from '@/components/ui/Button.vue'
import NumberField from '@/components/ui/NumberField.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import type { PermissionAuditEntry } from '@/types/permission'
import { alsoAnswerableKey, permissionSourceName } from '@/utils/permission-source'
import { playCue, type SoundCue } from '@/utils/sound'
import { formatDateParts } from '@/utils/intl-format'

const store = useAgentStore()
// "Switch to app" uses macOS LaunchServices; on Windows it is not offered yet (docs/ux-overhaul/windows-todo.md).
const isMac = /Mac/i.test(navigator.platform)

// Product names are proper nouns, not translatable copy. Claude Code moves to
// the approver list only while answering from the pet is turned on.
const approverAgents = computed(() => (store.claudePermissionRespondEnabled ? 'OpenCode · Claude Code' : 'OpenCode'))
const reminderAgents = computed(() => (store.claudePermissionRespondEnabled ? 'Codex' : 'Codex · Claude Code'))

function setClaudeWait(seconds: number): void {
  store.setClaudePermissionWaitSeconds(Math.round(seconds))
}

const launchHelp = computed(() => {
  if (!store.launchAtStartupSupported) return t('availablePackaged')
  if (store.launchAtStartup) {
    if (store.launchAtStartupStatus === 'requires-approval') return t('reliability.launch.pending')
    if (store.launchAtStartupStatus === 'not-in-applications') return t('reliability.launch.notInApplications')
    if (store.launchAtStartupStatus === 'error') return t('reliability.launch.error')
  }
  return t('launchAtStartupHelp')
})
const showOpenLoginItems = computed(() =>
  store.launchAtStartupSupported && store.launchAtStartup && store.launchAtStartupStatus === 'requires-approval')

const auditEntries = ref<PermissionAuditEntry[]>([])
const confirmClearAudit = ref(false)

async function loadAudit(): Promise<void> {
  try {
    auditEntries.value = (await window.electronAPI?.listPermissionAudit?.() ?? []).slice().reverse()
  } catch {
    auditEntries.value = []
  }
}

async function clearAudit(): Promise<void> {
  confirmClearAudit.value = false
  try { await window.electronAPI?.clearPermissionAudit?.() } catch { /* nothing to clear */ }
  await loadAudit()
}

function auditResult(entry: PermissionAuditEntry): string {
  // Claude Code keeps its terminal prompt open, so a decision sent from here may have
  // arrived after the user had already answered there.
  const maybeTerminal = alsoAnswerableKey(entry.agentId) ? t('permission.auditMaybeTerminal') : ''
  if (entry.status === 'allowed') return t('permission.auditAllowed') + maybeTerminal
  if (entry.status === 'denied') return t('permission.auditDenied') + maybeTerminal
  if (entry.status === 'expired') return t('permission.auditExpired')
  if (entry.status === 'delivery_failed') return t('permission.auditFailed')
  return t('permission.auditCancelled')
}

function auditTime(timestamp: number): string {
  return formatDateParts(timestamp, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }, locale.value)
}

onMounted(() => { void loadAudit() })

function setVolume(event: Event): void {
  store.setSoundOption({ soundVolume: Number((event.target as HTMLInputElement).value) })
}

function preview(cue: SoundCue): void {
  playCue(cue, { preview: true })
}
</script>

<template>
  <Card :title="t('windowModes')">
    <ToggleRow :model-value="store.petWindowMode.mode === 'mini'" :label="t('miniMode')" :help="t('miniModeHelp')" @update:model-value="store.setPetMode($event ? 'mini' : 'normal')" />
    <ToggleRow :model-value="store.edgeModeEnabled" :label="t('edgePeek')" :help="t('edgePeekHelp')" @update:model-value="store.setEdgeModeEnabled($event)" />
  </Card>

  <Card :title="t('desktopBehavior')">
    <ToggleRow :model-value="store.shimejiEnabled" :label="t('shimejiBehavior')" :help="t('shimejiBehaviorHelp')" @update:model-value="store.setShimejiEnabled($event)" />
    <ToggleRow
      :model-value="store.captureExclusionEnabled"
      :label="t('captureExclusion')"
      :help="store.desktopVisibilityCapabilities.captureExclusion.supported ? t('captureExclusionHelp') : t('captureExclusionUnavailable')"
      :disabled="!store.desktopVisibilityCapabilities.captureExclusion.supported"
      @update:model-value="store.setCaptureExclusionEnabled($event)"
    />
    <ToggleRow
      :model-value="store.fullscreenAutoHideEnabled"
      :label="t('fullscreenAutoHide')"
      :help="store.desktopVisibilityCapabilities.fullscreenAutoHide.supported ? t('fullscreenAutoHideHelp') : t('fullscreenAutoHideUnavailable')"
      :disabled="!store.desktopVisibilityCapabilities.fullscreenAutoHide.supported"
      @update:model-value="store.setFullscreenAutoHideEnabled($event)"
    />
    <ToggleRow :model-value="store.completionMarkersEnabled" :label="t('completionMarkers')" :help="t('completionMarkersHelp')" @update:model-value="store.setCompletionMarkersEnabled($event)" />
    <ToggleRow :model-value="store.rightClickHideEnabled" :label="t('rightClickHide')" :help="t('rightClickHideHelp')" @update:model-value="store.setRightClickHideEnabled($event)" />
    <ToggleRow :model-value="store.permissionBubbleEnabled" :label="t('permissionBubble')" :help="t('permissionBubbleHelp', { seconds: PERMISSION_DEFAULT_TTL_SECONDS })" @update:model-value="store.setPermissionBubbleEnabled($event)" />
  </Card>

  <Card :title="t('panel.jumpSettingsHeading')">
    <ToggleRow :model-value="store.sessionJumpEnabled" :label="t('panel.jumpSetting')" :help="t('panel.jumpSettingHelp')" @update:model-value="store.setSessionJumpEnabled($event)" />
    <ToggleRow
      v-if="isMac"
      :model-value="store.sessionJumpSwitchAppEnabled"
      :disabled="!store.sessionJumpEnabled"
      :label="t('panel.jumpSwitchSetting')"
      :help="t('panel.jumpSwitchSettingHelp')"
      @update:model-value="store.setSessionJumpSwitchAppEnabled($event)"
    />
  </Card>

  <Card :title="t('permission.soundHeading')">
    <ToggleRow :model-value="store.soundEnabled" :label="t('sound')" :help="t('soundHelp')" @update:model-value="store.setSoundEnabled($event)" />
    <label class="permission-sound-volume">
      <span>{{ t('permission.soundVolume') }}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        :value="store.soundVolume"
        :disabled="!store.soundEnabled"
        :aria-valuetext="`${store.soundVolume}%`"
        @input="setVolume"
      />
      <output>{{ store.soundVolume }}%</output>
    </label>
    <ToggleRow :model-value="store.soundOnPermission" :disabled="!store.soundEnabled" :label="t('permission.soundOnPermission')" @update:model-value="store.setSoundOption({ soundOnPermission: $event })" />
    <ToggleRow :model-value="store.soundOnError" :disabled="!store.soundEnabled" :label="t('permission.soundOnError')" @update:model-value="store.setSoundOption({ soundOnError: $event })" />
    <ToggleRow :model-value="store.soundOnSuccess" :disabled="!store.soundEnabled" :label="t('permission.soundOnSuccess')" @update:model-value="store.setSoundOption({ soundOnSuccess: $event })" />
    <div class="permission-sound-preview">
      <Button size="sm" variant="secondary" @click="preview('waiting-permission')">{{ t('permission.soundPreviewPermission') }}</Button>
      <Button size="sm" variant="secondary" @click="preview('error')">{{ t('permission.soundPreviewError') }}</Button>
      <Button size="sm" variant="secondary" @click="preview('success')">{{ t('permission.soundPreviewSuccess') }}</Button>
    </div>
  </Card>

  <Card :title="t('permission.settingsHeading')">
    <p class="permission-settings-intro">{{ t('permission.settingsIntro') }}</p>
    <ul class="permission-settings-list">
      <li>
        <strong>{{ approverAgents }}</strong>
        <span>{{ t('permission.settingsCanApprove') }}</span>
      </li>
      <li>
        <strong>{{ reminderAgents }}</strong>
        <span>{{ t('permission.settingsReminderOnly') }}</span>
      </li>
    </ul>
    <ToggleRow
      :model-value="store.claudePermissionRespondEnabled"
      :label="t('permission.claudeRespond')"
      :help="t('permission.claudeRespondHelp')"
      @update:model-value="store.setClaudePermissionRespondEnabled($event)"
    />
    <div class="claude-wait">
      <NumberField
        :model-value="store.claudePermissionWaitSeconds"
        :label="t('permission.claudeWait')"
        :help="t('permission.claudeWaitHelp', { min: CLAUDE_PERMISSION_WAIT_MIN_SECONDS, max: CLAUDE_PERMISSION_WAIT_MAX_SECONDS })"
        :min="CLAUDE_PERMISSION_WAIT_MIN_SECONDS"
        :max="CLAUDE_PERMISSION_WAIT_MAX_SECONDS"
        :step="5"
        :disabled="!store.claudePermissionRespondEnabled"
        @commit="setClaudeWait"
      />
    </div>
    <p class="permission-settings-intro">{{ t('permission.settingsRiskRules') }}</p>
  </Card>

  <Card :title="t('permission.auditHeading')">
    <p v-if="auditEntries.length === 0" class="permission-settings-intro">{{ t('permission.auditEmpty') }}</p>
    <ul v-else class="permission-audit-list">
      <li v-for="(entry, index) in auditEntries" :key="`${entry.resolvedAt}-${index}`">
        <span class="permission-audit-time">{{ auditTime(entry.resolvedAt) }}</span>
        <code>{{ entry.action }}</code>
        <span>{{ permissionSourceName(entry.agentId) }}</span>
        <strong>{{ auditResult(entry) }}</strong>
      </li>
    </ul>
    <p class="permission-settings-intro">{{ t('permission.auditPrivacy') }}</p>
    <Button size="sm" variant="secondary" :disabled="auditEntries.length === 0" @click="confirmClearAudit = true">{{ t('permission.auditClear') }}</Button>
    <ConfirmDialog
      :open="confirmClearAudit"
      :title="t('permission.auditClearTitle')"
      :message="t('permission.auditClearMessage')"
      :confirm-label="t('permission.auditClear')"
      tone="danger"
      focus-cancel
      @confirm="clearAudit"
      @cancel="confirmClearAudit = false"
    />
  </Card>

  <Card :title="t('system')">
    <ToggleRow :model-value="store.presentationMcpEnabled" :label="t('presentationMcp')" :help="t('presentationMcpHelp')" @update:model-value="store.setPresentationMcpEnabled($event)" />
    <ToggleRow
      :model-value="store.launchAtStartup"
      :label="t('launchAtStartup')"
      :help="launchHelp"
      :disabled="!store.launchAtStartupSupported"
      @update:model-value="store.setLaunchAtStartup($event)"
    />
    <div v-if="showOpenLoginItems" class="launch-action">
      <Button size="sm" variant="secondary" @click="store.openLoginItemsSettings()">{{ t('reliability.launch.openSettings') }}</Button>
    </div>
  </Card>
</template>

<style scoped>
.launch-action {
  padding-bottom: var(--space-2);
}

.claude-wait {
  padding: var(--space-2) 0 var(--space-3);
}

.permission-audit-list {
  display: flex;
  max-height: 180px;
  margin: 0 0 var(--space-3);
  padding: 0;
  flex-direction: column;
  gap: var(--space-1);
  overflow-y: auto;
  list-style: none;
}

.permission-audit-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--font-sm);
}

.permission-audit-list code {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.permission-audit-time {
  min-width: 9ch;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.permission-audit-list strong {
  min-width: 0;
  margin-left: auto;
  text-align: right;
}

.permission-sound-volume {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  font-size: var(--font-sm);
}

.permission-sound-volume input[type='range'] {
  min-width: 0;
  flex: 1;
  accent-color: var(--accent);
}

.permission-sound-volume input[type='range']:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

.permission-sound-volume output {
  min-width: 3ch;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.permission-sound-preview {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-2);
}

.permission-settings-intro {
  margin: 0 0 var(--space-3);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
}

.permission-settings-list {
  display: flex;
  margin: 0 0 var(--space-3);
  padding: 0;
  flex-direction: column;
  gap: var(--space-2);
  list-style: none;
}

.permission-settings-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.permission-settings-list span {
  color: var(--text-secondary);
}
</style>
