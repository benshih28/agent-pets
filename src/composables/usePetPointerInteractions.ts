import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import type { PresentationReaction } from '@/types/presentation'

interface PetAnimationHandle {
  playReaction: (reaction?: PresentationReaction) => void
  playCursorLook: (direction: -1 | 1) => void
}

// A shaky trackpad click must still open the panel.
const DRAG_START_DISTANCE_PX = 4
// Lets a double click (pat) cancel the pending panel toggle.
const SINGLE_CLICK_DELAY_MS = 220
const CURSOR_LOOK_DEAD_ZONE_PX = 12
const CURSOR_LOOK_COOLDOWN_MS = 350

export function usePetPointerInteractions(options: {
  clickAreaRef: Ref<HTMLElement | null>
  animations: () => PetAnimationHandle[]
  dismissCoach: () => void
}) {
  const store = useAgentStore()
  const dragLift = ref(false)
  const hasMoved = ref(false)
  let singleClickTimer: ReturnType<typeof setTimeout> | null = null
  let lastCursorLookAt = 0
  let lastCursorLookDirection: -1 | 0 | 1 = 0

  function onKeydown(e: KeyboardEvent): void {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      store.markPetInteraction()
      store.clearUnreadResults()
      store.togglePanel()
    }
  }

  function onMouseMove(e: MouseEvent): void {
    store.markPetInteraction()
    if (!store.shimejiEnabled || !store.reactionsActive || store.currentState !== 'idle') return
    if (store.petWindowMode.mode !== 'normal' || store.isDragging) return
    const area = options.clickAreaRef.value
    if (!area) return
    const rect = area.getBoundingClientRect()
    const offset = e.clientX - (rect.left + rect.width / 2)
    const direction: -1 | 0 | 1 = offset < -CURSOR_LOOK_DEAD_ZONE_PX ? -1 : offset > CURSOR_LOOK_DEAD_ZONE_PX ? 1 : 0
    if (direction === 0 || direction === lastCursorLookDirection) return
    const now = Date.now()
    if (now - lastCursorLookAt < CURSOR_LOOK_COOLDOWN_MS) return
    lastCursorLookAt = now
    lastCursorLookDirection = direction
    options.animations().forEach(anim => anim.playCursorLook(direction))
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return
    options.dismissCoach()
    store.markPetInteraction()
    hasMoved.value = false
    // Keeps the window catching events while held, even before a drag begins.
    store.isDragging = true
    const startX = e.screenX
    const startY = e.screenY
    let dragStarted = false

    // Window movement comes from the main process polling the cursor, not from mousemove deltas:
    // on Windows a moved frameless window triggers a synthetic mousemove, which feeds back as drift.
    const onMove = (moveEvent: MouseEvent) => {
      if (dragStarted) return
      const dx = moveEvent.screenX - startX
      const dy = moveEvent.screenY - startY
      if (Math.abs(dx) > DRAG_START_DISTANCE_PX || Math.abs(dy) > DRAG_START_DISTANCE_PX) {
        dragStarted = true
        hasMoved.value = true
        dragLift.value = true
        window.electronAPI?.startDrag()
      }
    }

    const onUp = () => {
      store.isDragging = false
      dragLift.value = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      // Must fire even on a plain click: it is the only signal that stops the main process' cursor-poll loop.
      window.electronAPI?.notifyDragEnd(hasMoved.value)
      if (dragStarted) options.animations().forEach(anim => anim.playReaction())
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function onDoubleClick(e: MouseEvent): void {
    if (e.button !== 0 || hasMoved.value) return
    if (singleClickTimer) clearTimeout(singleClickTimer)
    singleClickTimer = null
    store.patPet()
    options.animations().forEach(anim => anim.playReaction('encouraging'))
  }

  function onClick(e: MouseEvent): void {
    if (e.button !== 0) return
    if (hasMoved.value) return
    store.clearUnreadResults()
    options.animations().forEach(anim => anim.playReaction())
    if (singleClickTimer) clearTimeout(singleClickTimer)
    singleClickTimer = setTimeout(() => {
      singleClickTimer = null
      store.togglePanel()
    }, SINGLE_CLICK_DELAY_MS)
  }

  function onContextMenu(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    // Only the sprite and its Edge form are hide targets, not permission cards, toasts or other controls.
    if (!target.closest('[data-pet-context-target="hide"]')) return
    if (store.rightClickHideEnabled) window.electronAPI?.requestPetHide()
    else window.electronAPI?.showPetContextMenu()
  }

  onBeforeUnmount(() => {
    if (singleClickTimer) clearTimeout(singleClickTimer)
  })

  return { dragLift, onKeydown, onMouseMove, onMouseDown, onDoubleClick, onClick, onContextMenu }
}
