// 寵物本體的滑鼠／鍵盤互動：拖曳、單擊開面板、雙擊摸頭、游標注視、右鍵選單。
// 視窗移動完全由主程序輪詢游標座標驅動（見 electron/ipc/pet-motion.ts），這裡只負責
// 「按下／放開」的訊號與表情回饋。動畫實例由父層以 getter 提供，單寵物與多寵物共用。
import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import type { PresentationReaction } from '@/types/presentation'

interface PetAnimationHandle {
  playReaction: (reaction?: PresentationReaction) => void
  playCursorLook: (direction: -1 | 1) => void
}

// A press only becomes a drag after the pointer travels this far; a shaky
// click on a trackpad must still open the panel.
const DRAG_START_DISTANCE_PX = 4
// A single click waits briefly so a double click (pat) can cancel it instead of
// also toggling the panel twice.
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
    // Keeps the window catching events while the button is held, even before a
    // drag has actually begun.
    store.isDragging = true
    const startX = e.screenX
    const startY = e.screenY
    let dragStarted = false

    // Actual window movement is driven entirely by the main process polling
    // screen.getCursorScreenPoint() rather than by accumulating deltas between
    // renderer mousemove events. On Windows, moving a frameless window under the
    // cursor makes the OS resend a synthetic mousemove for the new window
    // position; a delta-from-previous approach picks that up as extra "movement"
    // and re-moves the window again — a feedback loop that reads as the pet
    // drifting for as long as the button is held. Polling the OS cursor position
    // directly sidesteps that loop.
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
      // Must fire unconditionally, even on a plain click with no movement: it is
      // the only signal that stops the main process' cursor-poll loop, and
      // gating it on hasMoved left that loop running after a plain click so the
      // pet kept chasing the cursor until the next mousedown replaced it.
      window.electronAPI?.notifyDragEnd(hasMoved.value)
      // Landing squash: the pet settles where it was dropped.
      if (dragStarted) options.animations().forEach(anim => anim.playReaction())
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function onDoubleClick(e: MouseEvent): void {
    if (e.button !== 0 || hasMoved.value) return
    if (singleClickTimer) clearTimeout(singleClickTimer)
    singleClickTimer = null
    // Rewarded pats show a heart and bump mood; capped pats still react.
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
    // Only the actual sprite and its compact Edge representation are hide
    // targets. Permission cards, status lines, toasts, and other controls do not
    // inherit this shortcut.
    if (!target.closest('[data-pet-context-target="hide"]')) return
    // "Hide on right-click" is an explicit opt-in; otherwise show the full menu.
    if (store.rightClickHideEnabled) window.electronAPI?.requestPetHide()
    else window.electronAPI?.showPetContextMenu()
  }

  onBeforeUnmount(() => {
    if (singleClickTimer) clearTimeout(singleClickTimer)
  })

  return { dragLift, onKeydown, onMouseMove, onMouseDown, onDoubleClick, onClick, onContextMenu }
}
