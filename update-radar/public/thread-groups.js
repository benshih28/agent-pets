const MAX_THREAD_DEPTH = 20

function isTiboUpdate(update) {
  return update?.sourceId === 'tibo-x' && update?.provider === 'x' && /^x-\d{1,19}$/.test(update?.id ?? '')
}

function findThreadRootId(update, updatesById) {
  if (!isTiboUpdate(update)) return null
  if (update.postKind === 'root') return update.id

  let current = update
  const visited = new Set([update.id])
  for (let depth = 0; depth < MAX_THREAD_DEPTH; depth += 1) {
    if (!/^x-\d{1,19}$/.test(current.replyToId ?? '') || visited.has(current.replyToId)) return null
    visited.add(current.replyToId)
    current = updatesById.get(current.replyToId)
    if (!current || !isTiboUpdate(current)) return null
    if (current.postKind === 'root') return current.id
  }
  return null
}

function compareThreadItems(left, right) {
  if (left.postKind === 'root' && right.postKind !== 'root') return -1
  if (right.postKind === 'root' && left.postKind !== 'root') return 1
  const leftTime = Date.parse(left.publishedAtTime ?? '')
  const rightTime = Date.parse(right.publishedAtTime ?? '')
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime
  return left.id.localeCompare(right.id)
}

export function groupUpdatesForDisplay(updates) {
  if (!Array.isArray(updates)) return []

  const updatesById = new Map(updates.map(update => [update?.id, update]))
  const rootIds = new Map()
  for (const update of updates) {
    const rootId = findThreadRootId(update, updatesById)
    if (rootId) rootIds.set(update.id, rootId)
  }

  const emittedRoots = new Set()
  const groups = []
  for (const update of updates) {
    const rootId = rootIds.get(update?.id)
    if (!rootId) {
      groups.push({ kind: 'single', updates: [update] })
      continue
    }
    if (emittedRoots.has(rootId)) continue
    emittedRoots.add(rootId)
    const threadUpdates = updates
      .filter(candidate => rootIds.get(candidate?.id) === rootId)
      .sort(compareThreadItems)
    groups.push({
      kind: threadUpdates.length > 1 ? 'thread' : 'single',
      rootId,
      updates: threadUpdates,
    })
  }
  return groups
}
