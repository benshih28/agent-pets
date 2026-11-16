// 量測用的原型 worker：只做檔案走訪與 JSONL 解析（純函式），把解析結果批次回傳，
// 不碰 node:sqlite。只供 local-usage-lag.mjs 比較「主執行緒掃描」與「worker 解析」，
// 不是 production 程式碼。
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { createHash } from 'node:crypto'
import { createIncrementalLocalUsageParserState, parseIncrementalLocalUsageChunk } from '../../electron/local-usage.ts'

const SLICE = 1024 * 1024

async function* walk(directory) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield full
  }
}

async function parseFile(provider, filePath, maxLineBytes) {
  const handle = await open(filePath, 'r')
  const state = createIncrementalLocalUsageParserState()
  const records = new Map()
  const fileKey = createHash('sha256').update(`${provider}:${filePath}`).digest('hex').slice(0, 48)
  try {
    const { size } = await handle.stat()
    let position = 0
    let carry = Buffer.alloc(0)
    while (position < size) {
      const want = Math.min(SLICE, size - position)
      const slice = Buffer.allocUnsafe(want)
      const { bytesRead } = await handle.read(slice, 0, want, position)
      if (bytesRead <= 0) break
      position += bytesRead
      const fresh = slice.subarray(0, bytesRead)
      const chunk = carry.length > 0 ? Buffer.concat([carry, fresh]) : fresh
      const chunkStart = position - chunk.length
      for (const record of parseIncrementalLocalUsageChunk(provider, fileKey, chunk, chunkStart, maxLineBytes, state)) {
        records.set(record.dedupeKey, record)
      }
      carry = Buffer.from(chunk.subarray(Math.max(0, state.readOffset - chunkStart)))
    }
  } finally {
    await handle.close()
  }
  return [...records.values()]
}

const { roots, maxLineBytes } = workerData
for (const { provider, directory } of roots) {
  for await (const filePath of walk(directory)) {
    parentPort.postMessage({ type: 'records', records: await parseFile(provider, filePath, maxLineBytes) })
  }
}
parentPort.postMessage({ type: 'done' })
