// Shimeji 自主行為：排程 tick、走路碰牆折返、省電／電池／分頁可見性閘門。
// 從 DesktopPet.vue 抽出；只吐出元件需要渲染的狀態（行為、面向、游標是否在寵物上）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import {
  canRunAutonomousBehavior,
  ShimejiScheduler,
  SHIMEJI_IDLE_DELAY_MS,
  SHIMEJI_IDLE_DELAY_MIN_MS,
  type PetAutonomousBehavior,
  type ShimejiContext,
} from '@/types/pet'
import { useReducedMotion } from '@/composables/useReducedMotion'

interface ShimejiBattery {
  charging: boolean
  level: number
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

export function useShimejiBehavior() {
  const store = useAgentStore()
  const behavior = ref<PetAutonomousBehavior>('idle')
  const facing = ref<-1 | 1>(1)
  const pointerOverPet = ref(false)
  const scheduler = new ShimejiScheduler()
  // shimejiGate 已經監看這個值，系統設定改變時會自動重排 Shimeji。
  const reducedMotion = useReducedMotion()
  const powerSave = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  let idleSince = Date.now()
  let cleanupPowerSave: (() => void) | null = null
  let battery: ShimejiBattery | null = null

  function updatePowerSave(): void {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    powerSave.value = Boolean(
      connection?.saveData
      || (battery && !battery.charging && battery.level <= 0.2),
    )
  }

  const manifestCapabilities = computed(() => {
    const multiPetActive = store.multiPetEnabled && store.familyLines.length > 1
    const petIds = multiPetActive
      ? store.familyLines.map(line => line.petId)
      : [store.activePetId]
    // 一次建索引，不對每個 petId 掃一遍 pets。
    const petsById = new Map(store.pets.map(pet => [pet.id, pet]))
    const entries = petIds
      .map(id => petsById.get(id))
      .filter((pet): pet is NonNullable<typeof pet> => Boolean(pet))
    return {
      canWalk: entries.length > 0 && entries.every(pet => Boolean(pet.behaviorManifest?.walk)),
      canSleep: entries.length > 0 && entries.every(pet => Boolean(pet.behaviorManifest?.sleep)),
    }
  })

  function context(random?: number): ShimejiContext {
    return {
      enabled: store.shimejiEnabled,
      reactionsEnabled: store.reactionsEnabled,
      dndEnabled: store.dndEnabled,
      reducedMotion: reducedMotion.value,
      powerSave: powerSave.value,
      documentVisible: document.visibilityState === 'visible',
      isDragging: store.isDragging,
      windowMode: store.petWindowMode.mode,
      currentState: store.currentState,
      activeSessionCount: store.activeSessions.length,
      pendingPermission: store.permissionRequests.length > 0,
      canWalk: manifestCapabilities.value.canWalk,
      canSleep: manifestCapabilities.value.canSleep,
      idleMs: Math.max(0, Date.now() - idleSince),
      ...(random === undefined ? {} : { random }),
    }
  }

  function stopTimer(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  function schedule(delayMs: number = SHIMEJI_IDLE_DELAY_MS): void {
    stopTimer()
    if (!store.shimejiEnabled || !canRunAutonomousBehavior(context())) return
    timer = setTimeout(runTick, Math.max(1_500, delayMs))
  }

  // Would the next step run into the edge of the current display? Then the pet
  // turns around instead of marching on the spot against the wall.
  function walkDeltaAwayFromWall(deltaX: number): number {
    const margin = 4
    const left = (window.screen as Screen & { availLeft?: number }).availLeft ?? 0
    const right = left + window.screen.availWidth
    const nextLeft = window.screenX + deltaX
    const nextRight = window.screenX + window.outerWidth + deltaX
    return nextLeft < left + margin || nextRight > right - margin ? -deltaX : deltaX
  }

  function runTick(): void {
    timer = null
    // A pet under the cursor stays put rather than walking away from it.
    if (pointerOverPet.value) {
      schedule(SHIMEJI_IDLE_DELAY_MIN_MS)
      return
    }
    const tick = scheduler.next(context(Math.random()))
    behavior.value = tick.behavior
    if (tick.walkDeltaX !== undefined && tick.behavior === 'walk') {
      const deltaX = walkDeltaAwayFromWall(tick.walkDeltaX)
      facing.value = deltaX < 0 ? -1 : 1
      window.electronAPI?.shimejiWalkStep(deltaX)
    }
    schedule(tick.delayMs)
  }

  function restart(): void {
    stopTimer()
    scheduler.reset()
    behavior.value = 'idle'
    idleSince = Date.now()
    schedule()
  }

  // The cursor arriving wakes a sleeping pet and holds it in place.
  function onPointerEnter(): void {
    pointerOverPet.value = true
    if (scheduler.isSleeping) restart()
  }

  function onPointerLeave(): void {
    pointerOverPet.value = false
  }

  const gate = computed(() => [
    store.shimejiEnabled,
    store.reactionsEnabled,
    store.dndEnabled,
    store.currentState,
    store.activeSessions.length,
    store.permissionRequests.length,
    store.petWindowMode.mode,
    store.isDragging,
    store.petsLoaded,
    manifestCapabilities.value.canWalk,
    manifestCapabilities.value.canSleep,
    reducedMotion.value,
    powerSave.value,
    document.visibilityState,
  ].join('|'))

  watch(gate, restart)

  async function initializeEnvironment(): Promise<void> {
    document.addEventListener('visibilitychange', restart)

    if (window.electronAPI?.getPowerSaveState) {
      try {
        powerSave.value = await window.electronAPI.getPowerSaveState()
      } catch {}
    }
    cleanupPowerSave = window.electronAPI?.onPowerSaveStateUpdated?.((next) => {
      powerSave.value = next
    }) ?? null

    const getBattery = (navigator as Navigator & {
      getBattery?: () => Promise<ShimejiBattery>
    }).getBattery
    if (getBattery) {
      try {
        battery = await getBattery()
        battery.addEventListener('chargingchange', updatePowerSave)
        battery.addEventListener('levelchange', updatePowerSave)
        updatePowerSave()
      } catch {
        // Battery API 在 Electron 中可能不存在；仍保留 Reduced Motion 與 DND 閘門。
      }
    }
  }

  function disposeEnvironment(): void {
    stopTimer()
    document.removeEventListener('visibilitychange', restart)
    cleanupPowerSave?.()
    cleanupPowerSave = null
    battery?.removeEventListener('chargingchange', updatePowerSave)
    battery?.removeEventListener('levelchange', updatePowerSave)
    battery = null
  }

  onMounted(() => { void initializeEnvironment() })
  onBeforeUnmount(disposeEnvironment)

  return { behavior, facing, reducedMotion, onPointerEnter, onPointerLeave }
}
