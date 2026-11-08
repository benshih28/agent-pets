<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { t, translateBackendError, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { SOURCE_FAMILIES } from '@/types/agent'
import type { PetImportDecision, PetImportPreview } from '@/types/pet-import'
import { useRovingTabs } from '@/composables/useRovingTabs'
import { PET_NAME_MAX_LENGTH, groupPets, validatePetName } from '@/utils/pet-groups'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import PetImportDialog from '@/components/status-panel/PetImportDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import Select from '@/components/ui/Select.vue'
import TextField from '@/components/ui/TextField.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const importing = ref(false)
const importingZip = ref(false)
const importZipError = ref('')
const importPreview = ref<PetImportPreview | null>(null)
const importCommitting = ref(false)
const importDialogError = ref('')
watch(() => importPreview.value !== null, open => store.setPanelModalLock('pets-import', open))
const editingPetId = ref<string | null>(null)
const editName = ref('')
const petQuery = ref('')
const renameError = ref('')
const PET_SEARCH_THRESHOLD = 8
const showPetSearch = computed(() => store.visiblePets.length > PET_SEARCH_THRESHOLD)
const petGroups = computed(() => groupPets(store.visiblePets, store.selectedPet, showPetSearch.value ? petQuery.value : ''))
const flatPetIds = computed(() => petGroups.value.flatMap(group => group.pets.map(pet => pet.id)))
const { onKeydown: onPetKeydown } = useRovingTabs({
  ids: () => flatPetIds.value,
  current: () => store.selectedPet,
  select: id => store.setPet(id),
  elementId: id => `pet-radio-${id}`,
  orientation: 'vertical',
})
const PET_GROUP_LABELS = {
  current: 'panel.petGroupCurrent', builtIn: 'panel.petGroupBuiltIn', imported: 'panel.petGroupImported', plugin: 'panel.petGroupPlugin',
} as const
const confirmDialog = ref<{
  title: string
  message?: string
  tone: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
} | null>(null)
const confirmDialogOpen = computed(() => confirmDialog.value !== null)
watch(confirmDialogOpen, open => store.setPanelModalLock('pets-confirm', open))
const PROJECT_PET_STATUS_LABEL_KEYS: Record<'unbound' | 'bound' | 'missing-pet', TranslationKey> = {
  unbound: 'projectPetUnbound', bound: 'projectPetBound', 'missing-pet': 'projectPetMissing',
}

function askConfirm(request: NonNullable<typeof confirmDialog.value>): void {
  confirmDialog.value = request
}

async function acceptConfirm(): Promise<void> {
  const pending = confirmDialog.value
  confirmDialog.value = null
  await pending?.onConfirm()
}

async function importPet(): Promise<void> {
  importing.value = true
  const id = `custom-${Date.now()}`
  const fileUrl = await window.electronAPI?.importPetSprite(id, t('customPet'))
  if (fileUrl) {
    await store.loadPets()
    void store.refreshProjectPets()
    store.setPet(id)
  }
  importing.value = false
}

async function importPetZip(): Promise<void> {
  importingZip.value = true
  importZipError.value = ''
  try {
    const result = await window.electronAPI?.prepareImportPetZip()
    if (result?.ok) {
      importDialogError.value = ''
      importPreview.value = result.preview
    } else if (result && result.error !== 'cancelled') {
      importZipError.value = translateBackendError(result.error || t('failed'))
    }
  } finally {
    importingZip.value = false
  }
}

async function commitImport(decision: PetImportDecision): Promise<void> {
  const preview = importPreview.value
  if (!preview || importCommitting.value) return
  importCommitting.value = true
  importDialogError.value = ''
  try {
    const result = await window.electronAPI?.commitImportPetZip(preview.token, decision, preview.expectedState)
    if (!result) return
    if (result.ok) {
      importPreview.value = null
      await store.loadPets()
      void store.refreshProjectPets()
      store.setPet(result.id)
      return
    }
    // 主程序發現預覽後狀態有變：換成新的預覽，讓使用者重新選擇，而不是沿用舊的決定。
    if (result.code === 'E_IMPORT_STATE_CHANGED' && result.preview) {
      importPreview.value = result.preview
      importDialogError.value = t('pet.importStateChanged')
      return
    }
    importPreview.value = null
    importZipError.value = translateBackendError(result.error)
  } finally {
    importCommitting.value = false
  }
}

function cancelImport(): void {
  const preview = importPreview.value
  if (importCommitting.value) return
  importPreview.value = null
  if (preview) void window.electronAPI?.cancelImportPetZip(preview.token)
}

// 面板切走時丟棄尚未確認的預覽，主程序會一併刪除暫存目錄。
onUnmounted(() => {
  const preview = importPreview.value
  importPreview.value = null
  store.setPanelModalLock('pets-import', false)
  if (preview) void window.electronAPI?.cancelImportPetZip(preview.token)
})

function startRename(pet: { id: string; displayName: string }): void {
  editingPetId.value = pet.id
  editName.value = pet.displayName
  renameError.value = ''
}

const RENAME_ERROR_KEYS = {
  empty: 'panel.renameEmpty', duplicate: 'panel.renameDuplicate', tooLong: 'panel.renameTooLong',
} as const

async function confirmRename(): Promise<void> {
  const petId = editingPetId.value
  if (!petId) return
  const problem = validatePetName(editName.value, petId, store.visiblePets)
  if (problem) {
    renameError.value = t(RENAME_ERROR_KEYS[problem])
    return
  }
  editingPetId.value = null
  await store.renamePet(petId, editName.value.trim())
}

function cancelRename(): void {
  editingPetId.value = null
  editName.value = ''
  renameError.value = ''
}

// Losing window focus (e.g. the panel hiding) must not commit a half-typed name.
function onRenameBlur(): void {
  if (editingPetId.value && document.hasFocus()) void confirmRename()
}

function confirmRemovePet(pet: { id: string; displayName: string; builtIn: boolean }): void {
  askConfirm({
    title: pet.builtIn ? t('hide') : t('remove'),
    message: pet.builtIn ? t('hidePetConfirm', { name: pet.displayName }) : t('removePetConfirm', { name: pet.displayName }),
    tone: 'danger',
    onConfirm: () => store.removePet(pet.id),
  })
}

function confirmRemoveProjectPet(project: { projectId: string; displayName: string }): void {
  askConfirm({
    title: t('remove'),
    message: t('removeProjectPetConfirm', { name: project.displayName }),
    tone: 'danger',
    onConfirm: () => { void store.removeProjectPet(project.projectId) },
  })
}

function projectPetStatusLabel(status: 'unbound' | 'bound' | 'missing-pet'): string {
  return t(PROJECT_PET_STATUS_LABEL_KEYS[status])
}
</script>

<template>
  <Card :title="t('pets')">
    <TextField v-if="showPetSearch" v-model="petQuery" type="search" search size="sm" :aria-label="t('panel.petSearchLabel')" :placeholder="t('panel.petSearchLabel')" :clear-label="t('panel.searchClear')" />
    <div class="pet-list" role="radiogroup" :aria-label="t('pets')">
      <template v-for="group in petGroups" :key="group.id">
        <div class="pet-group-heading">{{ t(PET_GROUP_LABELS[group.id]) }}</div>
        <div v-for="pet in group.pets" :key="pet.id" class="pet-row" role="presentation">
          <TextField
            v-if="editingPetId === pet.id"
            v-model="editName"
            class="pet-rename-field"
            :aria-label="t('rename')"
            :maxlength="PET_NAME_MAX_LENGTH"
            :error="renameError"
            size="sm"
            consume-escape
            @enter="confirmRename"
            @escape="cancelRename"
            @blur="onRenameBlur"
          />
          <template v-else>
            <button
              :id="`pet-radio-${pet.id}`"
              type="button"
              class="pet-option"
              :class="{ active: store.selectedPet === pet.id }"
              role="radio"
              :aria-checked="store.selectedPet === pet.id"
              :tabindex="store.selectedPet === pet.id || (!flatPetIds.includes(store.selectedPet) && flatPetIds[0] === pet.id) ? 0 : -1"
              @click="store.setPet(pet.id)"
              @keydown="onPetKeydown"
            >
              <span class="pet-copy">
                <span class="pet-name">{{ pet.displayName }}</span>
                <small v-if="pet.pluginSkin" class="pet-plugin-source">{{ t('pluginPetFromPlugin', { name: pet.pluginSkin.pluginName }) }}</small>
              </span>
            </button>
            <span class="pet-actions">
              <Button v-if="!pet.builtIn && !pet.pluginSkin" variant="ghost" size="sm" :title="t('rename')" :aria-label="`${t('rename')} ${pet.displayName}`" @click="startRename(pet)">
                <Icon name="edit" :size="13" />
              </Button>
              <Button v-if="pet.id !== store.defaultPetId && !pet.pluginSkin" variant="ghost" size="sm" :title="pet.builtIn ? t('hide') : t('remove')" :aria-label="`${pet.builtIn ? t('hide') : t('remove')} ${pet.displayName}`" @click="confirmRemovePet(pet)">
                <Icon name="close" :size="13" />
              </Button>
            </span>
          </template>
        </div>
      </template>
      <EmptyState v-if="petGroups.length === 0" compact :title="t('panel.petSearchEmpty')" />
    </div>
    <div class="import-row">
      <Button variant="primary" size="sm" :disabled="importing" @click="importPet">{{ importing ? t('importing') : t('importSprite') }}</Button>
      <Button variant="primary" size="sm" :disabled="importingZip || importPreview !== null" @click="importPetZip">{{ importingZip ? t('importing') : t('importZip') }}</Button>
    </div>
    <div v-if="importZipError" class="import-error" role="alert">{{ importZipError }}</div>
  </Card>

  <Card :title="t('multiPet')">
    <ToggleRow :model-value="store.multiPetEnabled" :label="t('multiPet')" @update:model-value="store.setMultiPetEnabled($event)" />
  </Card>

  <Card v-if="store.multiPetEnabled" :title="t('perAgentPet')">
    <div class="field-row" v-for="family in SOURCE_FAMILIES" :key="family.key">
      <span class="family-pet-name"><span class="family-pet-dot" :class="`family-${family.key}`" />{{ family.label }}</span>
      <Select size="sm" class="field-control" :aria-label="family.label" :model-value="store.familyPetIds[family.key] || ''" @update:model-value="store.setFamilyPet(family.key, $event || null)">
        <option value="">{{ t('defaultPet') }}</option>
        <option v-for="pet in store.visiblePets" :key="pet.id" :value="pet.id">{{ pet.displayName }}</option>
      </Select>
    </div>
  </Card>

  <Card :title="t('projectPets')">
    <ToggleRow :model-value="store.projectPetsEnabled" :label="t('projectPetsEnable')" :help="t('projectPetsEnableHelp')" @update:model-value="store.setProjectPetsEnabled($event)" />
    <template v-if="store.projectPetsEnabled">
      <p class="section-copy">{{ t('projectPetsHelp') }}</p>
      <div class="project-pet-actions">
        <Button variant="secondary" size="sm" :disabled="store.projectPetsLoading" @click="store.addProjectPet()">{{ store.projectPetsLoading ? t('checking') : t('addProjectPet') }}</Button>
      </div>
      <div v-if="store.projectPetsError" class="import-error" role="alert">{{ store.projectPetsError }}</div>
      <EmptyState v-if="store.projectPetsLoading && store.projectPets.length === 0" compact :title="t('panel.loading')" aria-busy="true" />
      <div v-else-if="store.projectPets.length > 0" class="project-pet-list">
        <div v-for="project in store.projectPets" :key="project.projectId" class="project-pet-row">
          <span class="field-copy">
            <span class="field-label" :title="project.displayName">{{ project.displayName }}</span>
            <span class="field-help" :class="{ 'project-pet-missing': project.bindingStatus === 'missing-pet' }">{{ projectPetStatusLabel(project.bindingStatus) }}</span>
          </span>
          <span class="project-pet-controls">
            <Select size="sm" class="field-control" :aria-label="`${project.displayName} ${t('projectPets')}`" :model-value="project.boundPetId ?? ''" @update:model-value="store.setProjectPetBinding(project.projectId, $event || null)">
              <option value="">{{ t('useSelectedPet') }}</option>
              <option v-if="project.bindingStatus === 'missing-pet' && project.boundPetId" :value="project.boundPetId">{{ t('missingPet') }}</option>
              <option v-for="pet in store.visiblePets" :key="pet.id" :value="pet.id">{{ pet.displayName }}</option>
            </Select>
            <Button variant="ghost" size="sm" :title="t('remove')" :aria-label="`${t('remove')} ${project.displayName}`" @click="confirmRemoveProjectPet(project)">
              <Icon name="close" :size="13" />
            </Button>
          </span>
        </div>
      </div>
      <EmptyState v-else icon="pets" :title="t('projectPetsNoProjects')" :description="t('panel.projectPetsEmptyHint')" />
    </template>
  </Card>

  <PetImportDialog
    :preview="importPreview"
    :busy="importCommitting"
    :error="importDialogError"
    @cancel="cancelImport"
    @commit="commitImport"
  />

  <ConfirmDialog
    :open="confirmDialog !== null"
    :title="confirmDialog?.title ?? ''"
    :message="confirmDialog?.message"
    :tone="confirmDialog?.tone"
    @confirm="acceptConfirm"
    @cancel="confirmDialog = null"
  />
</template>
