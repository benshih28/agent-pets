type Schedule = (callback: () => void) => void

const scheduleInNextTurn: Schedule = callback => { setImmediate(callback) }

/** Coalesces projections where only the most recent value is observable. */
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

/** Batches events while preserving every item and its insertion order. */
export function createOrderedBatchCoalescer<T>(flush: (values: readonly T[]) => void, schedule: Schedule = scheduleInNextTurn): (value: T) => void {
  let scheduled = false
  let pending: T[] = []

  return value => {
    pending.push(value)
    if (scheduled) return
    scheduled = true
    schedule(() => {
      scheduled = false
      const values = pending
      pending = []
      if (values.length > 0) flush(values)
    })
  }
}
