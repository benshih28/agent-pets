import type { ProgressionSnapshot } from '../../src/types/progression.ts'

export function progressionSnapshotKey(s: ProgressionSnapshot): string {
  return `${s.petId}|${s.totalXp}|${s.level}|${s.xpIntoLevel}|${s.xpToNext}|${s.evolutionStage}|${s.currentStreak}|${s.longestStreak}|${s.lastActiveLocalDate ?? ''}|${s.updatedAt}`
}

export function createProgressionChangeGate(): {
  shouldBroadcast(snapshot: ProgressionSnapshot): boolean
  record(snapshot: ProgressionSnapshot): void
} {
  let last = ''
  return {
    shouldBroadcast(snapshot) { return progressionSnapshotKey(snapshot) !== last },
    record(snapshot) { last = progressionSnapshotKey(snapshot) },
  }
}

export interface DeferrableWindow {
  isDestroyed(): boolean
  isVisible(): boolean
}

// Hidden windows are remembered and resynced when they are shown.
export function createVisibleSender<W extends DeferrableWindow>() {
  const stale = new WeakSet<W>()
  return {
    send(window: W | null | undefined, deliver: (w: W) => void): void {
      if (!window || window.isDestroyed()) return
      if (!window.isVisible()) { stale.add(window); return }
      stale.delete(window)
      deliver(window)
    },
    resync(window: W, deliver: (w: W) => void): void {
      if (window.isDestroyed() || !stale.has(window)) return
      stale.delete(window)
      deliver(window)
    },
  }
}
