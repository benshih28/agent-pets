<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { locale, t, type TranslationKey } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import { panelThemeMedia, panelThemeState, refreshPanelThemeState } from '@/composables/usePanelTheme'
import { usePanelThemeActions } from '@/composables/usePanelThemeActions'
import { openPanelThemeSettings } from '@/utils/settings-navigation'
import { panelThemeSettingsTarget } from '@/utils/panel-theme-css'
import { openPanelThemeEditor } from '@/composables/useMyPanelThemes'
import { resolvedTheme } from '@/composables/useTheme'
import { USER_PANEL_THEME_OWNER } from '@/types/panel-theme-user'
import { PANEL_THEME_MODES, type PanelThemeMode } from '@/types/panel-theme'

// Settings -> General -> Appearance：精簡且常駐的各模式插件面板主題
// 狀態、通往所屬插件 Panel themes 區塊的連結，以及固定的一鍵
// "Restore built-in"（spec §8）。選擇與自訂主題則在
// Plugins -> <plugin> -> Panel themes 中進行。

const MODE_LABEL: Record<PanelThemeMode, TranslationKey> = { light: 'design.panelTheme.lightSlot', dark: 'design.panelTheme.darkSlot' }
const { busy, status, error, restoreBuiltIn } = usePanelThemeActions()

const rows = computed(() => PANEL_THEME_MODES.map(mode => {
  const slot = panelThemeState.value?.slots[mode]
  const entry = slot?.ref
    ? panelThemeState.value?.themes.find(theme => theme.ref.pluginId === slot.ref!.pluginId && theme.ref.themeId === slot.ref!.themeId)
    : undefined
  let text = t('design.panelTheme.builtIn')
  if (slot?.status === 'active' && entry) {
    text = entry.ref.pluginId === USER_PANEL_THEME_OWNER
      ? t('design.themeEditor.ownedLabel', { name: entry.displayName[locale.value] })
      : t('design.panelTheme.statusRow', { theme: entry.displayName[locale.value], plugin: entry.pluginName[locale.value] })
  } else if (slot?.status === 'unavailable') {
    text = slot.reason === 'plugins_off' ? t('design.panelTheme.unavailablePluginsOff')
      : slot.reason === 'plugin_disabled' ? t('design.panelTheme.unavailablePluginDisabled')
        : t('design.panelTheme.unavailableRemoved')
  }
  return { mode, text, ref: slot?.status === 'active' ? slot.ref : null }
}))
const anySlotSet = computed(() => Boolean(panelThemeState.value?.slots.light.ref || panelThemeState.value?.slots.dark.ref))
// 「開啟插件設定」只指向插件（我的主題不是插件，在下方的「我的主題」卡片管理）。
const openTarget = computed(() => panelThemeSettingsTarget(panelThemeState.value))

/** 「自訂…」：正在用的是我的主題就編輯它；是插件主題就以它為起點建立新主題；否則從內建開始。 */
function customize(): void {
  const active = rows.value.find(row => row.mode === resolvedTheme.value)?.ref ?? null
  if (active?.pluginId === USER_PANEL_THEME_OWNER) openPanelThemeEditor(active.themeId)
  else openPanelThemeEditor(null, active ?? undefined)
}

onMounted(() => { void refreshPanelThemeState() })
</script>

<template>
  <Card :title="t('design.panelTheme.title')" data-testid="panel-theme-status">
    <p class="status-help">{{ t('design.panelTheme.statusHelp') }}</p>
    <p v-if="panelThemeMedia.forcedColors" class="status-help" role="status">{{ t('design.panelTheme.suspendedForcedColors') }}</p>
    <dl class="status-rows">
      <div v-for="row in rows" :key="row.mode" class="status-row">
        <dt>{{ t(MODE_LABEL[row.mode]) }}</dt>
        <dd :data-testid="`panel-theme-status-${row.mode}`">{{ row.text }}</dd>
      </div>
    </dl>
    <div class="status-actions">
      <Button size="sm" variant="primary" data-testid="panel-theme-customize" @click="customize">{{ t('design.themeEditor.customize') }}</Button>
      <Button v-if="openTarget" size="sm" variant="secondary" data-testid="panel-theme-open-plugin" @click="openPanelThemeSettings(openTarget)">{{ t('design.panelTheme.openPluginSettings') }}</Button>
      <Button size="sm" variant="secondary" :disabled="busy || !anySlotSet" data-testid="panel-theme-restore" @click="restoreBuiltIn">{{ t('design.panelTheme.restoreBuiltIn') }}</Button>
    </div>
    <p class="status-live" role="status">{{ status }}</p>
    <p v-if="error" class="status-error" role="alert">{{ error }}</p>
  </Card>
</template>

<style scoped>
.status-help {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.status-rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}

.status-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}

.status-row dt {
  flex: 0 0 auto;
  color: var(--text-primary);
  font-size: var(--font-sm);
}

.status-row dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.status-live {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.status-error {
  margin: var(--space-1) 0 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}
</style>
