import type { AgentSession, AgentState } from '@/types/agent'

interface HeapEntry {
  key: string
  state: AgentState
  lastSeenAt: number
  insertionOrder: number
}

function compareEvictionPriority(left: HeapEntry, right: HeapEntry): number {
  const offlineDelta = Number(left.state !== 'offline') - Number(right.state !== 'offline')
  if (offlineDelta !== 0) return offlineDelta
  const timestampDelta = left.lastSeenAt - right.lastSeenAt
  if (timestampDelta !== 0) return timestampDelta
  return left.insertionOrder - right.insertionOrder
}

/** Map-backed session lookup with an indexed heap for bounded-session eviction. */
export class AgentSessionIndex<T extends AgentSession = AgentSession> {
  private readonly sessions: Map<string, T>
  private readonly heap: HeapEntry[] = []
  private readonly heapIndexByKey = new Map<string, number>()
  private nextInsertionOrder = 0

  constructor(sessions: Map<string, T> = new Map()) {
    this.sessions = sessions
  }

  get size(): number {
    return this.sessions.size
  }

  get(key: string): T | undefined {
    return this.sessions.get(key)
  }

  values(): IterableIterator<T> {
    return this.sessions.values()
  }

  upsert(session: T, maximum: number): T | undefined {
    const existed = this.sessions.has(session.key)
    let evicted: T | undefined
    if (!existed && this.sessions.size >= maximum) {
      const key = this.heap[0]?.key
      if (key) {
        evicted = this.sessions.get(key)
        this.delete(key)
      }
    }

    this.sessions.set(session.key, session)
    this.setHeapPriority(session.key, session.state, session.lastSeenAt)
    return evicted
  }

  updatePriority(key: string, state: AgentState, lastSeenAt: number): void {
    if (!this.sessions.has(key)) return
    this.setHeapPriority(key, state, lastSeenAt)
  }

  delete(key: string): T | undefined {
    const session = this.sessions.get(key)
    if (!session) return undefined
    this.sessions.delete(key)
    const index = this.heapIndexByKey.get(key)
    if (index !== undefined) this.removeHeapEntry(index)
    return session
  }

  private setHeapPriority(key: string, state: AgentState, lastSeenAt: number): void {
    const currentIndex = this.heapIndexByKey.get(key)
    if (currentIndex === undefined) {
      const entry = { key, state, lastSeenAt, insertionOrder: this.nextInsertionOrder++ }
      this.heap.push(entry)
      const index = this.heap.length - 1
      this.heapIndexByKey.set(key, index)
      this.siftUp(index)
      return
    }

    const entry = this.heap[currentIndex]
    entry.state = state
    entry.lastSeenAt = lastSeenAt
    const nextIndex = this.siftUp(currentIndex)
    this.siftDown(nextIndex)
  }

  private removeHeapEntry(index: number): void {
    const removed = this.heap[index]
    const last = this.heap.pop()
    this.heapIndexByKey.delete(removed.key)
    if (!last || index >= this.heap.length) return

    this.heap[index] = last
    this.heapIndexByKey.set(last.key, index)
    this.siftDown(this.siftUp(index))
  }

  private siftUp(startIndex: number): number {
    let index = startIndex
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (compareEvictionPriority(this.heap[parentIndex], this.heap[index]) <= 0) break
      this.swap(parentIndex, index)
      index = parentIndex
    }
    return index
  }

  private siftDown(startIndex: number): number {
    let index = startIndex
    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      let smallestIndex = index
      if (leftIndex < this.heap.length && compareEvictionPriority(this.heap[leftIndex], this.heap[smallestIndex]) < 0) {
        smallestIndex = leftIndex
      }
      if (rightIndex < this.heap.length && compareEvictionPriority(this.heap[rightIndex], this.heap[smallestIndex]) < 0) {
        smallestIndex = rightIndex
      }
      if (smallestIndex === index) return index
      this.swap(index, smallestIndex)
      index = smallestIndex
    }
  }

  private swap(leftIndex: number, rightIndex: number): void {
    const left = this.heap[leftIndex]
    const right = this.heap[rightIndex]
    this.heap[leftIndex] = right
    this.heap[rightIndex] = left
    this.heapIndexByKey.set(left.key, rightIndex)
    this.heapIndexByKey.set(right.key, leftIndex)
  }
}
