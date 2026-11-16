<script setup lang="ts">
import { computed, ref } from 'vue'
import { t, type TranslationKey } from '@/i18n'
import type { DbMaintenanceResult, DbMaintenanceSuccess, GrowthResetResult } from '@/types/growth-maintenance'
import { formatBytes } from '@/utils/bytes-format'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

// 兩個使用者觸發的資料維護：重設成長資料（破壞性，需確認）與資料庫整理（VACUUM，可能數秒）。
// 結果由主程序決定；這裡只負責確認、忙碌狀態與結果文字。
const confirmReset = ref(false)
const resetting = ref(false)
const resetMessage = ref('')
const resetFailed = ref(false)

const compacting = ref(false)
const compactResult = ref<DbMaintenanceSuccess | null>(null)
const compactMessage = ref('')

const RESET_ERRORS: Record<string, TranslationKey> = {
  unavailable: 'growth.resetUnavailable',
  rate_limited: 'growth.maintenanceRateLimited',
}
const COMPACT_ERRORS: Record<string, TranslationKey> = {
  busy: 'growth.compactBusy',
  scanning: 'growth.compactScanning',
  unavailable: 'growth.resetUnavailable',
  rate_limited: 'growth.maintenanceRateLimited',
}

async function performReset(): Promise<void> {
  confirmReset.value = false
  if (resetting.value) return
  resetting.value = true
  resetMessage.value = ''
  try {
    // 使用者在對話框按下確認之後才向主程序申請一次性 token，再立刻用它重設。
    const armed = await window.electronAPI?.armGrowthReset()
    const result: GrowthResetResult | undefined = armed?.ok
      ? await window.electronAPI?.resetGrowth(armed.token)
      : armed
    resetFailed.value = !result?.ok
    resetMessage.value = result?.ok
      ? t('growth.resetDone')
      : t(RESET_ERRORS[result?.error ?? ''] ?? 'growth.resetFailed')
  } catch {
    resetFailed.value = true
    resetMessage.value = t('growth.resetFailed')
  } finally {
    resetting.value = false
  }
}

async function compactDatabases(): Promise<void> {
  if (compacting.value) return
  compacting.value = true
  compactResult.value = null
  compactMessage.value = ''
  try {
    const result: DbMaintenanceResult | undefined = await window.electronAPI?.runDbMaintenance()
    if (result?.ok) compactResult.value = result
    else if (result?.error === 'insufficient_space') {
      compactMessage.value = t('growth.compactInsufficientSpace', {
        needed: formatBytes(result.neededBytes),
        available: formatBytes(result.availableBytes),
      })
    } else compactMessage.value = t(COMPACT_ERRORS[result?.error ?? ''] ?? 'growth.compactFailed')
  } catch {
    compactMessage.value = t('growth.compactFailed')
  } finally {
    compacting.value = false
  }
}

const compactSummary = computed(() => {
  const result = compactResult.value
  if (!result) return ''
  return t('growth.compactDone', {
    before: formatBytes(result.beforeBytes),
    after: formatBytes(result.afterBytes),
    freed: formatBytes(result.freedBytes),
  })
})
</script>

<template>
  <Card :title="t('growth.compactTitle')">
    <p class="section-copy">{{ t('growth.compactHelp') }}</p>
    <Button variant="secondary" size="sm" block :disabled="compacting" :loading="compacting" @click="compactDatabases">
      {{ compacting ? t('growth.compactRunning') : t('growth.compactAction') }}
    </Button>
    <p v-if="compactSummary" class="section-copy" role="status">{{ compactSummary }}</p>
    <p v-else-if="compactMessage" class="section-copy" role="status">{{ compactMessage }}</p>
  </Card>
  <Card tone="warn" :title="t('growth.resetTitle')">
    <p class="section-copy">{{ t('growth.resetHelp') }}</p>
    <Button variant="danger" size="sm" block :disabled="resetting" @click="confirmReset = true">{{ t('growth.resetAction') }}</Button>
    <p v-if="resetMessage" class="section-copy" role="status" :data-failed="resetFailed || undefined">{{ resetMessage }}</p>
  </Card>
  <ConfirmDialog
    :open="confirmReset"
    :title="t('growth.resetConfirmTitle')"
    :message="t('growth.resetConfirmDetail')"
    :confirm-label="t('growth.resetConfirmAction')"
    tone="danger"
    focus-cancel
    @confirm="performReset"
    @cancel="confirmReset = false"
  />
</template>
