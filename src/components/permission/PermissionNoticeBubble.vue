<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { t } from '@/i18n'
import { hostAppLabel } from '@/types/host-app'
import Button from '@/components/ui/Button.vue'

// Read-only reminder for agents (Codex / Claude) whose permission prompts can
// only be answered in their own tool. There is deliberately no allow / deny
// here: the broker has no response channel for these sessions.
const store = useAgentStore()
const helpOpen = ref(false)
const switchFailed = ref(false)

// The most urgent waiting session (items are already in attention order) can be jumped back to
// directly: this activates its app, it does not pick a window or tab.
const switchTarget = computed(() => {
  const first = store.permissionNotice?.items[0]
  if (!first) return null
  const session = store.sessionByKey(first.sessionKey)
  if (!store.canSwitchToSessionApp(session)) return null
  const app = hostAppLabel(session?.host?.app)
  return app ? { key: first.sessionKey, app, project: first.project } : null
})

async function switchToApp(): Promise<void> {
  const target = switchTarget.value
  if (!target) return
  const result = await store.runSessionJump(target.key, 'switch-app')
  switchFailed.value = !result.ok
}
</script>

<template>
  <section
    v-if="store.permissionNotice"
    class="permission-notice-card"
    role="status"
    aria-live="polite"
    data-pet-hit-target="solid"
    @mousedown.stop
    @click.stop
  >
    <header class="permission-notice-header">
      <strong>{{ store.permissionNotice.title }}</strong>
      <Button
        icon-only
        variant="ghost"
        class="permission-notice-help"
        :aria-expanded="helpOpen"
        :aria-label="t('permission.noticeHelpLabel')"
        :title="t('permission.noticeHelpLabel')"
        @mousedown.stop
        @click.stop="helpOpen = !helpOpen"
      >
        ?
      </Button>
    </header>
    <p class="permission-notice-detail">{{ store.permissionNotice.detail }}</p>
    <ul v-if="store.permissionNotice.items.length > 1" class="permission-notice-list">
      <li v-for="item in store.permissionNotice.items.slice(0, 4)" :key="item.key">
        {{ item.source }} · {{ item.project || t('projectUnknown') }}
      </li>
    </ul>
    <p v-if="helpOpen" class="permission-notice-explain">{{ t('permission.noticeExplain') }}</p>
    <p class="permission-notice-hint">{{ t('permission.noticeExternalOnly') }}</p>
    <p v-if="switchFailed" class="permission-notice-hint" role="alert">{{ t('pet.switchAppFailed') }}</p>
    <div class="permission-notice-actions">
      <Button
        v-if="switchTarget"
        class="permission-notice-button"
        :title="t('pet.switchAppHint')"
        :aria-label="t('pet.switchAppAria', { app: switchTarget.app, project: switchTarget.project || t('projectUnknown') })"
        @mousedown.stop
        @click.stop="switchToApp()"
      >
        {{ t('pet.switchApp', { app: switchTarget.app }) }}
      </Button>
      <Button class="permission-notice-button" @mousedown.stop @click.stop="store.dismissPermissionNotice()">
        {{ t('permission.dismiss') }}
      </Button>
    </div>
  </section>
</template>

<style scoped>
.permission-notice-card {
  position: absolute;
  top: 2px;
  left: 50%;
  z-index: calc(var(--z-base) + 8);
  display: flex;
  width: min(248px, calc(var(--pet-w, 260px) - 8px));
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border: 1px solid var(--state-warn);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  backdrop-filter: var(--surface-blur);
  -webkit-backdrop-filter: var(--surface-blur);
  box-shadow: var(--shadow-panel);
  color: var(--text-bright);
  font-family: var(--font-ui);
  text-align: left;
  transform: translateX(-50%);
}

.permission-notice-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.permission-notice-header strong {
  min-width: 0;
  flex: 1;
  font-size: var(--font-md);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.permission-notice-detail,
.permission-notice-hint,
.permission-notice-explain {
  margin: 0;
  font-size: var(--font-sm);
  line-height: var(--leading-normal);
}

.permission-notice-hint,
.permission-notice-explain {
  color: var(--text-secondary);
  font-size: var(--font-xs);
}

.permission-notice-list {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--text-primary);
  font-size: var(--font-xs);
  line-height: var(--leading-normal);
}

.permission-notice-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.permission-notice-card .permission-notice-help,
.permission-notice-card .permission-notice-button {
  min-height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-bright);
  cursor: pointer;
  font: var(--weight-bold) var(--font-sm) / 1 var(--font-ui);
}

.permission-notice-card .permission-notice-help {
  flex: 0 0 28px;
  width: 28px;
  border-radius: var(--radius-pill);
}

.permission-notice-card .permission-notice-button {
  padding: 0 var(--space-4);
}

.permission-notice-card .permission-notice-help:hover,
.permission-notice-card .permission-notice-button:hover {
  background: var(--surface-raised-hover);
}

.permission-notice-card .permission-notice-help:focus-visible,
.permission-notice-card .permission-notice-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring-color);
  outline-offset: var(--focus-ring-offset);
}

@media (prefers-contrast: more) {
  .permission-notice-card {
    border-width: 2px;
    border-color: var(--state-warn-bright);
    background: var(--surface-overlay);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .permission-notice-card {
    background: var(--surface-overlay);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
