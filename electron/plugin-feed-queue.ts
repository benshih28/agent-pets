import type { PluginFeedItem } from '../src/types/plugin.ts'

type FeedPriority = PluginFeedItem['priority']

interface FeedQueueNode {
  item: PluginFeedItem
  sequence: number
  removed: boolean
}

interface FeedPriorityBucket {
  entries: FeedQueueNode[]
  head: number
}

/** FIFO queue indexed by id and partitioned by the feed's fixed priority set. */
export class PluginFeedQueue {
  private readonly buckets = new Map<FeedPriority, FeedPriorityBucket>([
    ['low', { entries: [], head: 0 }],
    ['normal', { entries: [], head: 0 }],
  ])
  private readonly byId = new Map<string, FeedQueueNode>()
  private nextSequence = 0
  private activeCount = 0

  get length(): number {
    return this.activeCount
  }

  push(item: PluginFeedItem): boolean {
    if (this.byId.has(item.id)) return false
    const bucket = this.buckets.get(item.priority)
    if (!bucket) return false
    const node: FeedQueueNode = { item, sequence: this.nextSequence++, removed: false }
    bucket.entries.push(node)
    this.byId.set(item.id, node)
    this.activeCount += 1
    return true
  }

  peek(): PluginFeedItem | undefined {
    let earliest: FeedQueueNode | undefined
    for (const bucket of this.buckets.values()) {
      this.advanceHead(bucket)
      const candidate = bucket.entries[bucket.head]
      if (candidate && (!earliest || candidate.sequence < earliest.sequence)) earliest = candidate
    }
    return earliest?.item
  }

  last(): PluginFeedItem | undefined {
    let latest: FeedQueueNode | undefined
    for (const node of this.byId.values()) if (!latest || node.sequence > latest.sequence) latest = node
    return latest?.item
  }

  values(): PluginFeedItem[] {
    return Array.from(this.byId.values(), node => node.item)
  }

  shift(): PluginFeedItem | undefined {
    const item = this.peek()
    if (item) this.remove(item.id)
    return item
  }

  remove(itemId: string): boolean {
    const node = this.byId.get(itemId)
    if (!node) return false
    node.removed = true
    this.byId.delete(itemId)
    this.activeCount -= 1
    const bucket = this.buckets.get(node.item.priority)
    if (bucket) this.compact(bucket)
    return true
  }

  clear(): void {
    this.byId.clear()
    this.activeCount = 0
    this.nextSequence = 0
    for (const bucket of this.buckets.values()) {
      bucket.entries = []
      bucket.head = 0
    }
  }

  private advanceHead(bucket: FeedPriorityBucket): void {
    while (bucket.head < bucket.entries.length && bucket.entries[bucket.head]?.removed) bucket.head += 1
  }

  private compact(bucket: FeedPriorityBucket): void {
    this.advanceHead(bucket)
    if (bucket.head > 32 && bucket.head * 2 > bucket.entries.length) {
      bucket.entries = bucket.entries.slice(bucket.head)
      bucket.head = 0
    }
  }
}
