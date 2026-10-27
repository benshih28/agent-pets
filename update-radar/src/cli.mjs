#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { collectFeed } from './collector.mjs'
import { DEFAULT_PORT, SOURCE_DEFINITIONS, TIBO_X_SOURCE } from './config.mjs'
import {
  createFeedScheduler,
  REFRESH_INTERVAL_MS,
  X_REFRESH_INTERVAL_MS,
  X_REFRESH_JITTER_MS,
  X_RETRY_DELAYS_MS,
} from './scheduler.mjs'
import { createRadarServer, listenOnLoopback } from './server.mjs'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const projectDirectory = dirname(moduleDirectory)
const feedPath = join(projectDirectory, 'data', 'feed.json')
const publicDirectory = join(projectDirectory, 'public')

function readPort(args) {
  const index = args.indexOf('--port')
  if (index < 0) return DEFAULT_PORT
  const port = Number(args[index + 1])
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) throw new Error('Port 必須是 1024–65535 的整數。')
  return port
}

async function runCollect(sourceIds) {
  const feed = await collectFeed({ feedPath, sourceIds })
  const ok = feed.sources.filter(source => source.status === 'ok').length
  const stale = feed.sources.filter(source => source.status === 'stale').length
  const failed = feed.sources.filter(source => source.status === 'error').length
  const disabled = feed.sources.filter(source => source.status === 'disabled').length
  console.log(`已整理 ${feed.updates.length} 筆更新；來源成功 ${ok}、沿用快取 ${stale}、失敗 ${failed}、未啟用 ${disabled}。`)
  for (const source of feed.sources.filter(item => ['stale', 'error'].includes(item.status))) {
    console.warn(`${source.id}: ${source.status} (${source.error})`)
  }
  return feed
}

function schedulerLog(event) {
  if (event.type === 'scheduled') {
    const minutes = Math.max(1, Math.round(event.delayMs / 60_000))
    console.log(`下次自動檢查約在 ${minutes} 分鐘後。`)
  } else if (event.type === 'error') {
    console.warn('自動更新失敗，將依退避排程重試。')
  }
}

async function runServe(args, options = {}) {
  const port = readPort(args)
  const server = createRadarServer({ feedPath, publicDirectory })
  await listenOnLoopback(server, port)
  console.log(`AI Update Radar: http://127.0.0.1:${port}`)

  const schedulers = []
  let collectionQueue = Promise.resolve()
  const queuedCollect = sourceIds => () => {
    const task = collectionQueue.then(() => runCollect(sourceIds))
    collectionQueue = task.catch(() => {})
    return task
  }

  if (options.autoUpdate) {
    const officialSourceIds = SOURCE_DEFINITIONS.map(source => source.id)
    schedulers.push(createFeedScheduler({
      feedPath,
      collect: queuedCollect(officialSourceIds),
      healthSourceIds: officialSourceIds,
      onEvent: schedulerLog,
    }))

    schedulers.push(createFeedScheduler({
      feedPath,
      collect: queuedCollect([TIBO_X_SOURCE.id]),
      healthSourceIds: [TIBO_X_SOURCE.id],
      intervalMs: X_REFRESH_INTERVAL_MS,
      jitterMs: X_REFRESH_JITTER_MS,
      retryDelaysMs: X_RETRY_DELAYS_MS,
      onEvent: schedulerLog,
    }))
  }
  const stop = () => {
    for (const scheduler of schedulers) scheduler.stop()
    server.close(() => process.exit(0))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  if (schedulers.length > 0) {
    console.log(`自動更新已啟用；正常間隔 ${REFRESH_INTERVAL_MS / 60_000} 分鐘。`)
    console.log(`Tibo X 當日貼文與 self-reply 檢查間隔 ${X_REFRESH_INTERVAL_MS / 60_000} 分鐘。`)
    for (const scheduler of schedulers) await scheduler.start()
  }
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2)
  if (command === 'collect') return runCollect()
  if (command === 'serve') return runServe(args)
  if (command === 'start') return runServe(args, { autoUpdate: true })

  console.log('用法：node src/cli.mjs <collect|serve|start> [--port 4317]')
  process.exitCode = command === 'help' ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : '執行失敗')
  process.exitCode = 1
})
