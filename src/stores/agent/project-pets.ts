// 專案寵物（把專案資料夾綁到指定寵物）：清單、啟用開關與錯誤訊息，實際的選檔與持久化都在主程序。
//
// - 事件輸入：面板呼叫 `refreshProjectPets()`、`addProjectPet()`、`setProjectPetBinding()`、
//   `removeProjectPet()`、`setProjectPetsEnabled()`；寵物模組在移除寵物後也會重新整理。
// - 計時器：無。
// - storage：無（持久化在主程序）。
// - 跨視窗同步：無；專案寵物的 IPC 只有面板視窗能呼叫，寵物視窗不持有這份清單。
import { ref } from 'vue'
import { t, translateBackendError } from '@/i18n'
import type { ProjectPetView } from '@/types/project-pet'

export function useProjectPets() {
  const projectPets = ref<ProjectPetView[]>([])
  const projectPetsLoading = ref(false)
  const projectPetsError = ref('')
  const projectPetsEnabled = ref(true)

  // Project-pet IPC is panel-only (main.ts rejects other senders), and the pet
  // window also calls loadPets(), so panel callers refresh this explicitly.
  async function refreshProjectPets(): Promise<ProjectPetView[]> {
    if (window.electronAPI?.getProjectPetsEnabled) {
      try {
        projectPetsEnabled.value = await window.electronAPI.getProjectPetsEnabled()
      } catch {
        projectPetsEnabled.value = false
      }
    }
    if (!window.electronAPI?.listProjectPets || !projectPetsEnabled.value) return projectPets.value
    projectPetsLoading.value = true
    projectPetsError.value = ''
    try {
      const list = await window.electronAPI.listProjectPets()
      projectPets.value = Array.isArray(list) ? list : []
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
    } finally {
      projectPetsLoading.value = false
    }
    return projectPets.value
  }

  async function setProjectPetsEnabled(enabled: boolean): Promise<boolean> {
    if (!window.electronAPI?.setProjectPetsEnabled) return false
    try {
      projectPetsEnabled.value = await window.electronAPI.setProjectPetsEnabled(enabled)
    } catch {
      return false
    }
    if (projectPetsEnabled.value) void refreshProjectPets()
    else projectPets.value = []
    return projectPetsEnabled.value
  }

  async function addProjectPet(): Promise<boolean> {
    if (!window.electronAPI?.pickProjectPet) return false
    projectPetsError.value = ''
    try {
      const result = await window.electronAPI.pickProjectPet()
      if (!result.ok) {
        if (result.error !== 'cancelled') projectPetsError.value = t('projectPetsUnavailable')
        return false
      }
      const existing = projectPets.value.findIndex(project => project.projectId === result.project.projectId)
      if (existing >= 0) projectPets.value[existing] = result.project
      else projectPets.value = [result.project, ...projectPets.value]
      return true
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
      return false
    }
  }

  async function setProjectPetBinding(projectId: string, petId: string | null): Promise<boolean> {
    if (!window.electronAPI?.setProjectPetBinding) return false
    projectPetsError.value = ''
    try {
      const result = await window.electronAPI.setProjectPetBinding(projectId, petId)
      if (!result.ok) {
        projectPetsError.value = t('projectPetsUnavailable')
        return false
      }
      const index = projectPets.value.findIndex(project => project.projectId === result.project.projectId)
      if (index >= 0) projectPets.value[index] = result.project
      return true
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
      return false
    }
  }

  async function removeProjectPet(projectId: string): Promise<boolean> {
    if (!window.electronAPI?.archiveProjectPet) return false
    projectPetsError.value = ''
    try {
      const result = await window.electronAPI.archiveProjectPet(projectId)
      if (!result.ok) {
        projectPetsError.value = t('projectPetsUnavailable')
        return false
      }
      projectPets.value = projectPets.value.filter(project => project.projectId !== projectId)
      return true
    } catch (error) {
      projectPetsError.value = translateBackendError(error instanceof Error ? error.message : t('projectPetsUnavailable'))
      return false
    }
  }

  return {
    projectPets,
    projectPetsLoading,
    projectPetsError,
    projectPetsEnabled,
    refreshProjectPets,
    addProjectPet,
    setProjectPetBinding,
    removeProjectPet,
    setProjectPetsEnabled,
  }
}
