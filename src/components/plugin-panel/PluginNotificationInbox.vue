<script setup lang="ts">
import { computed, ref } from 'vue'
import { locale, t } from '@/i18n'
import Button from '@/components/ui/Button.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import Select from '@/components/ui/Select.vue'
import { usePluginController } from '@/composables/plugin/context'
import { formatRelativeTime, linkHost } from '@/utils/relative-time'
import { formatDateTimeFull } from '@/utils/intl-format'
import type { PluginNotificationRecord } from '@/types/plugin'

const {
  visibleNotifications, notificationSource, markNotificationRead, markAllNotificationsRead,
  openNotificationLink, clearNotifications,
} = usePluginController()

const pluginFilter = ref('')
const expanded = ref(new Set<string>())
const now = Date.now()

const sources = computed(() => {
  const seen = new Map<string, string>()
  for (const record of visibleNotifications.value) seen.set(record.item.pluginId, notificationSource(record))
  return [...seen.entries()].map(([id, name]) => ({ id, name }))
})
const shown = computed(() => visibleNotifications.value.filter(record => !pluginFilter.value || record.item.pluginId === pluginFilter.value))
const unreadShown = computed(() => shown.value.filter(record => !record.read).length)

function toggle(id: string): void {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

function when(record: PluginNotificationRecord): string {
  return formatRelativeTime(record.item.createdAt, now, locale.value)
}
</script>

<template>
  <section class="inbox" :aria-label="t('pluginNotificationsHeading')">
    <p class="help">{{ t('pluginNotificationsHelp') }}</p>
    <EmptyState
      v-if="visibleNotifications.length === 0"
      icon="bell"
      :title="t('pluginNoNotifications')"
      :description="t('plugins.inboxEmptyHelp')"
    />
    <template v-else>
      <div class="toolbar">
        <Select v-if="sources.length > 1" v-model="pluginFilter" size="sm" :aria-label="t('plugins.inboxFilter')">
          <option value="">{{ t('plugins.inboxAllPlugins') }}</option>
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
        </Select>
        <span class="toolbar-spacer" />
        <Button variant="secondary" size="sm" :disabled="unreadShown === 0" @click="markAllNotificationsRead(pluginFilter || undefined)">
          {{ t('plugins.markAllRead') }}
        </Button>
        <Button variant="secondary" size="sm" @click="clearNotifications(pluginFilter || undefined)">
          {{ pluginFilter ? t('plugins.clearThisPlugin') : t('pluginClearAll') }}
        </Button>
      </div>
      <ul class="list">
        <li v-for="record in shown" :key="record.item.id" class="row" :class="{ unread: !record.read }">
          <span class="dot" :class="{ on: !record.read }" aria-hidden="true" />
          <div class="copy">
            <div class="head">
              <span class="source">{{ notificationSource(record) }}</span>
              <time class="time" :datetime="new Date(record.item.createdAt).toISOString()" :title="formatDateTimeFull(record.item.createdAt, locale)">{{ when(record) }}</time>
              <span v-if="!record.read" class="sr-only">{{ t('plugins.unread') }}</span>
            </div>
            <strong class="title">{{ record.item.title }}</strong>
            <p class="body" :class="{ clamped: !expanded.has(record.item.id) }">{{ record.item.body }}</p>
            <div class="actions">
              <Button variant="ghost" size="sm" :aria-expanded="expanded.has(record.item.id)" @click="toggle(record.item.id)">
                {{ expanded.has(record.item.id) ? t('plugins.lessDetails') : t('plugins.inboxExpand') }}
              </Button>
              <Button v-if="record.item.link" variant="ghost" size="sm" @click="openNotificationLink(record.item.id)">
                <Icon name="external-link" :size="14" />
                {{ linkHost(record.item.link) ? t('plugins.openLinkHost', { host: linkHost(record.item.link) }) : t('pluginFeedOpenLink') }}
              </Button>
              <Button v-if="!record.read" variant="secondary" size="sm" @click="markNotificationRead(record.item.id)">
                {{ t('pluginMarkRead') }}
              </Button>
            </div>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.inbox {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.help {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-xs);
  line-height: var(--leading-relaxed);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.toolbar-spacer {
  flex: 1 1 auto;
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  box-shadow: var(--shadow-raised);
}

.dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  margin-top: 6px;
  border-radius: 50%;
}

.dot.on {
  background: var(--accent);
}

.copy {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
}

.source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-weight: var(--weight-normal);
  overflow-wrap: anywhere;
}

.unread .title {
  font-weight: var(--weight-bold);
}

.body {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}

.body.clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (forced-colors: active) {
  .dot.on {
    background: Highlight;
  }
}
</style>
