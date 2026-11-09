<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { t } from '@/i18n'
import ActionMenu, { type ActionMenuItem } from '@/components/ui/ActionMenu.vue'
import Button from '@/components/ui/Button.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Dialog from '@/components/ui/Dialog.vue'
import Icon from '@/components/ui/Icon.vue'
import Input from '@/components/ui/Input.vue'
import PanelThemeCard from '@/components/panel-theme/PanelThemeCard.vue'
import { panelThemeState, refreshPanelThemeState } from '@/composables/usePanelTheme'
import { usePanelThemeActions } from '@/composables/usePanelThemeActions'
import { useElementVisible } from '@/composables/useElementVisible'
import { openPanelThemeEditor, refreshUserPanelThemes, userPanelThemes, useUserThemeActions } from '@/composables/useMyPanelThemes'
import { USER_PANEL_THEME_MAX_COUNT, USER_PANEL_THEME_NAME_MAX, USER_PANEL_THEME_OWNER, type UserPanelThemeRecord } from '@/types/panel-theme-user'

// 「我的主題」清單（spec R22）：主題插件分頁的第二個區塊，也出現在 通用 → 外觀。
// 套用沿用插件主題的插槽；編輯、新增與匯入開啟同一個全面板編輯器。

const themeActions = usePanelThemeActions()
const userActions = useUserThemeActions()
const busy = computed(() => themeActions.busy.value || userActions.busy.value)
const status = computed(() => userActions.status.value || themeActions.status.value)
const error = computed(() => userActions.error.value || themeActions.error.value)

const root = ref<HTMLElement | null>(null)
const visible = useElementVisible(root)

const rows = computed(() => userPanelThemes.value.map(record => ({
  record,
  entry: panelThemeState.value?.themes.find(theme => theme.ref.pluginId === USER_PANEL_THEME_OWNER && theme.ref.themeId === record.id) ?? null,
})))
const full = computed(() => userPanelThemes.value.length >= USER_PANEL_THEME_MAX_COUNT)

const deleting = ref<UserPanelThemeRecord | null>(null)
const renaming = ref<UserPanelThemeRecord | null>(null)
const renameValue = ref('')
const renameError = computed(() => {
  const length = renameValue.value.trim().length
  return length === 0 || length > USER_PANEL_THEME_NAME_MAX ? t('design.themeEditor.invalidName') : ''
})

function menuItems(): ActionMenuItem[] {
  return [
    { id: 'duplicate', label: t('design.themeEditor.duplicate'), disabled: full.value },
    { id: 'rename', label: t('design.themeEditor.rename') },
    { id: 'export', label: t('design.themeEditor.export') },
    { id: 'delete', label: t('design.themeEditor.delete'), danger: true },
  ]
}

const MENU_ACTIONS: Record<string, (record: UserPanelThemeRecord) => void> = {
  duplicate: record => {
    void userActions.run(() => window.electronAPI?.duplicateUserPanelTheme(record.id, copyName(record.name)), t('design.themeEditor.duplicated'))
  },
  rename: record => {
    renameValue.value = record.name
    renaming.value = record
  },
  export: record => {
    void userActions.run(() => window.electronAPI?.exportUserPanelTheme(record.id), t('design.themeEditor.exported'))
  },
  delete: record => { deleting.value = record },
}

/** 「<名稱> 副本」，超過長度上限時截短名稱本身。 */
function copyName(name: string): string {
  const full = t('design.themeEditor.copyName', { name })
  if (full.length <= USER_PANEL_THEME_NAME_MAX) return full
  const overflow = full.length - USER_PANEL_THEME_NAME_MAX
  return t('design.themeEditor.copyName', { name: name.slice(0, Math.max(1, name.length - overflow)).trimEnd() })
}

async function confirmRename(): Promise<void> {
  const record = renaming.value
  if (!record || renameError.value) return
  const result = await userActions.run(() => window.electronAPI?.renameUserPanelTheme(record.id, renameValue.value.trim()), t('design.themeEditor.renamed'))
  if (result?.ok) renaming.value = null
}

async function confirmDelete(): Promise<void> {
  const record = deleting.value
  deleting.value = null
  if (record) await userActions.run(() => window.electronAPI?.deleteUserPanelTheme(record.id), t('design.themeEditor.deleted'))
}

function importTheme(): void {
  void userActions.run(() => window.electronAPI?.importUserPanelTheme(), t('design.themeEditor.imported'))
}

onMounted(() => {
  void refreshUserPanelThemes()
  void refreshPanelThemeState()
})
</script>

<template>
  <section ref="root" class="my-themes" data-testid="my-panel-themes">
    <p class="my-themes-help">{{ t('design.themeEditor.myThemesHelp') }}</p>
    <div class="my-themes-toolbar">
      <Button size="sm" variant="primary" :disabled="busy || full" data-testid="my-theme-new" @click="openPanelThemeEditor(null)">{{ t('design.themeEditor.newTheme') }}</Button>
      <Button size="sm" variant="secondary" :disabled="busy || full" data-testid="my-theme-import" @click="importTheme">{{ t('design.themeEditor.import') }}</Button>
    </div>
    <p v-if="full" class="my-themes-note" role="status">{{ t('design.themeEditor.error.limitReached') }}</p>
    <p v-if="rows.length === 0" class="my-themes-note">{{ t('design.themeEditor.empty') }}</p>

    <template v-for="row in rows" :key="row.record.id">
      <PanelThemeCard
        v-if="row.entry"
        :entry="row.entry"
        :title="row.record.name"
        :visible="visible"
        :busy="busy"
        @apply="modes => themeActions.applyTheme(row.entry!.ref, modes)"
      >
        <template #actions>
          <Button size="sm" variant="secondary" :disabled="busy" :data-testid="`my-theme-edit-${row.record.id}`" @click="openPanelThemeEditor(row.record.id)">{{ t('design.themeEditor.edit') }}</Button>
          <ActionMenu :items="menuItems()" icon-only :aria-label="t('design.themeEditor.actions', { name: row.record.name })" :disabled="busy" :data-testid="`my-theme-menu-${row.record.id}`" @select="id => MENU_ACTIONS[id]?.(row.record)">
            <Icon name="more" :size="16" />
          </ActionMenu>
        </template>
      </PanelThemeCard>
      <!-- 記錄在磁碟上但沒通過目前的檢查（例如規則在新版本變嚴）：不能套用，但可以編輯修正或刪除。 -->
      <article v-else class="my-theme-invalid" :data-testid="`my-theme-invalid-${row.record.id}`">
        <strong class="my-theme-invalid-name">{{ row.record.name }}</strong>
        <span class="my-themes-note">{{ t('design.themeEditor.error.invalid') }}</span>
        <div class="my-themes-toolbar">
          <Button size="sm" variant="secondary" :disabled="busy" @click="openPanelThemeEditor(row.record.id)">{{ t('design.themeEditor.edit') }}</Button>
          <Button size="sm" variant="danger" :disabled="busy" @click="deleting = row.record">{{ t('design.themeEditor.delete') }}</Button>
        </div>
      </article>
    </template>

    <p class="my-themes-live" role="status">{{ status }}</p>
    <p v-if="error" class="my-themes-error" role="alert">{{ error }}</p>

    <Dialog :open="renaming !== null" :title="t('design.themeEditor.renameTitle')" size="md" @close="renaming = null">
      <form class="rename-form" @submit.prevent="confirmRename">
        <Input v-model="renameValue" :label="t('design.themeEditor.nameLabel')" :error="renameError" :maxlength="USER_PANEL_THEME_NAME_MAX" data-testid="my-theme-rename-input" />
      </form>
      <template #footer>
        <Button size="sm" variant="secondary" @click="renaming = null">{{ t('cancel') }}</Button>
        <Button size="sm" variant="primary" :disabled="busy || Boolean(renameError)" data-testid="my-theme-rename-save" @click="confirmRename">{{ t('design.themeEditor.save') }}</Button>
      </template>
    </Dialog>
    <ConfirmDialog
      :open="deleting !== null"
      tone="danger"
      focus-cancel
      :title="t('design.themeEditor.deleteTitle', { name: deleting?.name ?? '' })"
      :message="t('design.themeEditor.deleteBody')"
      :confirm-label="t('design.themeEditor.delete')"
      @confirm="confirmDelete"
      @cancel="deleting = null"
    />
  </section>
</template>

<style scoped>
.my-themes {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.my-themes-help,
.my-themes-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.my-themes-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.my-themes-live {
  min-height: 1em;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.my-themes-error {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}

.my-theme-invalid {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.my-theme-invalid-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--font-md);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename-form {
  display: flex;
  flex-direction: column;
}
</style>
