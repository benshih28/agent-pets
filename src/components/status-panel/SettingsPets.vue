<script setup lang="ts">
import { ref } from 'vue'
import { t, translateBackendError, type TranslationKey } from '@/i18n'
import { useAgentStore } from '@/stores/agentStore'
import { SOURCE_FAMILIES } from '@/types/agent'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import Icon from '@/components/ui/Icon.vue'
import Select from '@/components/ui/Select.vue'
import ToggleRow from '@/components/ui/ToggleRow.vue'

const store = useAgentStore()
const importing = ref(false)
const importingZip = ref(false)
const importZipError = ref('')
const editingPetId = ref<string | null>(null)
const editName = ref('')
const confirmDialog = ref<{
  title: string
  message?: string
  tone: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
} | null>(null)
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
  const result = await window.electronAPI?.importPetZip()
  if (result?.ok && result.id) {
    await store.loadPets()
    void store.refreshProjectPets()
    store.setPet(result.id)
  } else if (result && !result.ok && result.error !== 'cancelled') {
    importZipError.value = translateBackendError(result.error || t('failed'))
  }
  importingZip.value = false
}

function startRename(pet: { id: string; displayName: string }): void {
  editingPetId.value = pet.id
  editName.value = pet.displayName
}

async function confirmRename(): Promise<void> {
  if (!editingPetId.value || !editName.value.trim()) {
    editingPetId.value = null
    return
  }
  await store.renamePet(editingPetId.value, editName.value.trim())
  editingPetId.value = null
}

function cancelRename(): void {
  editingPetId.value = null
  editName.value = ''
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
    <div class="pet-list">
      <template v-for="pet in store.visiblePets" :key="pet.id">
        <input
          v-if="editingPetId === pet.id"
          v-model="editName"
          class="pet-rename-input"
          maxlength="64"
          @keyup.enter="confirmRename"
          @keyup.escape="cancelRename"
          @blur="confirmRename"
        />
        <!-- This container has nested actions, so use a keyboard-reachable role instead of a button. -->
        <div
          v-else
          class="pet-option"
          :class="{ active: store.selectedPet === pet.id }"
          role="button"
          tabindex="0"
          :aria-pressed="store.selectedPet === pet.id"
          @click="store.setPet(pet.id)"
          @keydown.enter="store.setPet(pet.id)"
          @keydown.space.prevent="store.setPet(pet.id)"
        >
          <span class="pet-copy">
            <span class="pet-name">{{ pet.displayName }}</span>
            <small v-if="pet.pluginSkin" class="pet-plugin-source">{{ t('pluginPetFromPlugin', { name: pet.pluginSkin.pluginName }) }}</small>
          </span>
          <span class="pet-actions">
            <Button v-if="!pet.builtIn && !pet.pluginSkin" variant="ghost" size="sm" :title="t('rename')" :aria-label="t('rename')" @click.stop="startRename(pet)">
              <Icon name="edit" :size="13" />
            </Button>
            <Button v-if="pet.id !== store.defaultPetId && !pet.pluginSkin" variant="ghost" size="sm" :title="pet.builtIn ? t('hide') : t('remove')" :aria-label="pet.builtIn ? t('hide') : t('remove')" @click.stop="confirmRemovePet(pet)">
              <Icon name="close" :size="13" />
            </Button>
          </span>
        </div>
      </template>
    </div>
    <div class="import-row">
      <Button variant="primary" size="sm" :disabled="importing" @click="importPet">{{ importing ? t('importing') : t('importSprite') }}</Button>
      <Button variant="primary" size="sm" :disabled="importingZip" @click="importPetZip">{{ importingZip ? t('importing') : t('importZip') }}</Button>
    </div>
    <div v-if="importZipError" class="import-error">{{ importZipError }}</div>
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
      <div v-if="store.projectPetsError" class="import-error" role="status">{{ store.projectPetsError }}</div>
      <div v-if="store.projectPetsLoading && store.projectPets.length === 0" class="project-pet-empty">{{ t('checking') }}</div>
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
      <div v-else class="project-pet-empty">{{ t('projectPetsNoProjects') }}</div>
    </template>
  </Card>

  <ConfirmDialog
    :open="confirmDialog !== null"
    :title="confirmDialog?.title ?? ''"
    :message="confirmDialog?.message"
    :tone="confirmDialog?.tone"
    @confirm="acceptConfirm"
    @cancel="confirmDialog = null"
  />
</template>
