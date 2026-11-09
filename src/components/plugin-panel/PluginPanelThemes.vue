<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { locale, t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import PanelThemeCard from '@/components/panel-theme/PanelThemeCard.vue'
import { panelThemeMedia, panelThemeState, refreshPanelThemeState } from '@/composables/usePanelTheme'
import { usePanelThemeActions } from '@/composables/usePanelThemeActions'
import { useElementVisible } from '@/composables/useElementVisible'

// Plugins -> <plugin> -> Panel themes（spec §8）。列出此插件的主題與
// light/dark 預覽，並可套用到 Light、Dark 或 Both。所有插件每個模式
// 只有一個插槽，所以在這裡套用會取代原本啟用的主題。

const props = defineProps<{ pluginId: string; pluginEnabled: boolean }>()
const { busy, status, error, applyTheme, restoreBuiltIn } = usePanelThemeActions()

const root = ref<HTMLElement | null>(null)
const visible = useElementVisible(root)

const themes = computed(() => (panelThemeState.value?.themes ?? []).filter(entry => entry.ref.pluginId === props.pluginId))
const anySlotSet = computed(() => Boolean(panelThemeState.value?.slots.light.ref || panelThemeState.value?.slots.dark.ref))

onMounted(() => { void refreshPanelThemeState() })
</script>

<template>
  <section ref="root" class="plugin-panel-themes" data-testid="plugin-panel-themes">
    <p class="themes-help">{{ t('design.panelTheme.help') }}</p>
    <p v-if="panelThemeMedia.forcedColors" class="themes-note" role="status">{{ t('design.panelTheme.suspendedForcedColors') }}</p>
    <p v-if="!pluginEnabled || themes.length === 0" class="themes-note" role="status">{{ t('design.panelTheme.pluginOff') }}</p>

    <PanelThemeCard
      v-for="entry in themes"
      :key="entry.ref.themeId"
      :entry="entry"
      :title="entry.displayName[locale]"
      :visible="visible"
      :busy="busy"
      @apply="modes => applyTheme(entry.ref, modes)"
    />

    <div class="themes-footer">
      <Button size="sm" variant="secondary" :disabled="busy || !anySlotSet" data-testid="panel-theme-restore" @click="restoreBuiltIn">{{ t('design.panelTheme.restoreBuiltIn') }}</Button>
    </div>
    <p class="themes-live" role="status">{{ status }}</p>
    <p v-if="error" class="themes-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.plugin-panel-themes {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.themes-help,
.themes-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.themes-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

.themes-live {
  min-height: 1em;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.themes-error {
  margin: 0;
  color: var(--text-danger);
  font-size: var(--font-xs);
}
</style>
