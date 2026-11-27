type Schedule = (callback: () => void) => void

const scheduleInNextTurn: Schedule = callback => { setImmediate(callback) }

export function createLatestValueCoalescer<T>(flush: (value: T) => void, schedule: Schedule = scheduleInNextTurn): (value: T) => void {
  let scheduled = false
  let hasValue = false
  let latest: T

  return value => {
    latest = value
    hasValue = true
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      if (!hasValue) return
      const valueToFlush = latest
      hasValue = false
      flush(valueToFlush)
    })
  }
}

export interface OrderedBatchLimits<T> {
  maxPending: number
  /** Survive overflow (terminal events); others are dropped first, oldest first. */
  isPriority?: (value: T) => boolean
  onDrop?: (value: T) => void
}

interface QueueEntry<T> { value: T, dropped: boolean }

export function createOrderedBatchCoalescer<T>(
  flush: (values: readonly T[]) => void,
  schedule: Schedule = scheduleInNextTurn,
  limits?: OrderedBatchLimits<T>,
): (value: T) => void {
  let scheduled = false
  let entries: Array<QueueEntry<T>> = []
  let normalQueue: Array<QueueEntry<T>> = []
  let priorityQueue: Array<QueueEntry<T>> = []
  let normalHead = 0
  let priorityHead = 0
  let allHead = 0
  let live = 0

  const reset = (): void => {
    entries = []; normalQueue = []; priorityQueue = []
    normalHead = 0; priorityHead = 0; allHead = 0; live = 0
  }
  const oldestLive = (queue: Array<QueueEntry<T>>, head: number): { entry: QueueEntry<T> | undefined, head: number } => {
    let index = head
    while (index < queue.length && queue[index]!.dropped) index += 1
    return { entry: queue[index], head: index }
  }
  const compact = (): void => {
    entries = entries.filter(entry => !entry.dropped)
    normalQueue = normalQueue.filter(entry => !entry.dropped)
    priorityQueue = priorityQueue.filter(entry => !entry.dropped)
    normalHead = 0; priorityHead = 0; allHead = 0
  }

  return value => {
    if (limits && live >= limits.maxPending) {
      let victim: QueueEntry<T> | undefined
      if (!limits.isPriority) {
        const found = oldestLive(entries, allHead)
        allHead = found.head
        victim = found.entry
      } else {
        const found = oldestLive(normalQueue, normalHead)
        normalHead = found.head
        victim = found.entry
        if (!victim) {
          // The queue is all priority items: shed the incoming one only if it is
          // not priority itself, otherwise the oldest priority item.
          if (!limits.isPriority(value)) { limits.onDrop?.(value); return }
          const oldest = oldestLive(priorityQueue, priorityHead)
          priorityHead = oldest.head
          victim = oldest.entry
        }
      }
      if (victim) {
        victim.dropped = true
        live -= 1
        limits.onDrop?.(victim.value)
        if (entries.length > limits.maxPending * 2) compact()
      }
    }
    const entry: QueueEntry<T> = { value, dropped: false }
    entries.push(entry)
    if (limits?.isPriority) (limits.isPriority(value) ? priorityQueue : normalQueue).push(entry)
    live += 1
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      const values = entries.filter(item => !item.dropped).map(item => item.value)
      reset()
      if (values.length > 0) flush(values)
    })
  }
}
