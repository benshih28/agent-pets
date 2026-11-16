// 量測本機用量掃描（Codex／Claude JSONL）對主執行緒事件迴圈的影響，並比較
// 「現行主執行緒掃描」與「worker 解析 + 主執行緒寫入」兩種做法。
//
// 用法：node --experimental-strip-types scripts/bench/local-usage-lag.mjs [--rounds=5] [--claude-files=100] [--codex-files=60]
// 只使用暫存目錄產生的 fixture，絕不讀取真實的 ~/.codex、~/.claude。
// 兩種模式在獨立子行程中交錯執行（每一輪依序跑完所有組合），各自有乾淨的 JIT 與暫存資料庫。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
  return [key, value]
}))
const here = dirname(fileURLToPath(import.meta.url))
const NODE_FLAGS = ['--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON']

function fixtureHome(root, claudeFiles, codexFiles) {
  const now = Date.now()
  const pad = 'x'.repeat(900)
  for (let f = 0; f < claudeFiles; f += 1) {
    const lines = []
    for (let i = 0; i < 300; i += 1) {
      const at = new Date(now - (300 - i) * 1000 - f * 60_000).toISOString()
      // 約三分之一是 assistant usage，其餘是 user／tool 大行，與真實 transcript 比例相近。
      lines.push(i % 3 === 0
        ? JSON.stringify({ type: 'assistant', timestamp: at, sessionId: `claude-${f}`, cwd: `/work/project-${f % 10}`, message: { id: `m-${f}-${i}`, model: 'claude-sonnet-4', usage: { input_tokens: 100 + i, output_tokens: 20 + i, cache_read_input_tokens: 500, cache_creation_input_tokens: 50 }, content: pad } })
        : JSON.stringify({ type: 'user', timestamp: at, sessionId: `claude-${f}`, message: { content: pad } }))
    }
    const file = join(root, '.claude', 'projects', `p${f % 10}`, `s${f}.jsonl`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${lines.join('\n')}\n`)
  }
  for (let f = 0; f < codexFiles; f += 1) {
    const lines = [JSON.stringify({ type: 'session_meta', timestamp: new Date(now - 400_000).toISOString(), payload: { cwd: `/work/project-${f % 10}`, id: `codex-${f}` } })]
    let total = 0
    for (let i = 0; i < 400; i += 1) {
      const at = new Date(now - (400 - i) * 1000 - f * 60_000).toISOString()
      if (i % 4 === 0) {
        total += 200
        lines.push(JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 200, output_tokens: 30 }, total_token_usage: { input_tokens: total, cached_input_tokens: total / 2, output_tokens: total / 6 } } } }))
      } else {
        lines.push(JSON.stringify({ type: 'response_item', timestamp: at, payload: { type: 'message', content: pad } }))
      }
    }
    const date = new Date(now)
    const file = join(root, '.codex', 'sessions', String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0'), `rollout-${f}.jsonl`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${lines.join('\n')}\n`)
  }
}

async function runChild(modeName, home) {
  const { kind: mode, batch } = MODES[modeName]
  const { HistoryStore } = await import('../../electron/history.ts')
  const { LocalUsageReader } = await import('../../electron/local-usage.ts')
  const dir = mkdtempSync(join(tmpdir(), 'ap-usage-db-'))
  const store = new HistoryStore(join(dir, 'history.sqlite'))
  const histogram = monitorEventLoopDelay({ resolution: 1 })
  const started = performance.now()
  histogram.enable()
  let imported = 0
  if (mode === 'main') {
    const reader = new LocalUsageReader({ homeDir: home, history: store, maxScanMs: 60_000, importBatchRecords: batch })
    imported = (await reader.scan()).recordsImported
  } else {
    const cutoff = Math.max(store.getLocalUsageCutoff(), Date.now() - store.getRetentionDays() * 86_400_000)
    const worker = new Worker(join(here, 'local-usage-worker-prototype.mjs'), {
      workerData: {
        maxLineBytes: 256 * 1024,
        roots: [
          { provider: 'codex', directory: join(home, '.codex', 'sessions') },
          { provider: 'claude-code', directory: join(home, '.claude', 'projects') },
        ],
      },
    })
    // 與 importRecords 相同：每批寫入，批次之間讓出事件迴圈。
    let queue = Promise.resolve()
    await new Promise((resolve, reject) => {
      worker.on('error', reject)
      worker.on('message', message => {
        if (message.type === 'done') { queue.then(resolve); return }
        queue = queue.then(async () => {
          const fresh = message.records.filter(record => record.occurredAt > cutoff)
          for (let offset = 0; offset < fresh.length; offset += batch) {
            imported += store.recordTokenUsageBatch(fresh.slice(offset, offset + batch))
            await new Promise(r => setImmediate(r))
          }
        })
      })
    })
    await worker.terminate()
  }
  const totalMs = performance.now() - started
  histogram.disable()
  store.close()
  rmSync(dir, { recursive: true, force: true })
  const ms = value => value / 1e6
  process.stdout.write(`${JSON.stringify({ mode: modeName, imported, totalMs, mean: ms(histogram.mean), p99: ms(histogram.percentile(99)), max: ms(histogram.max) })}\n`)
}

// 受測組合：main500 是改前（主執行緒掃描、500 筆一批寫入），main100 只改批次大小，
// worker100 是 worker 解析 + 100 筆一批寫入。
const MODES = { main500: { kind: 'main', batch: 500 }, main100: { kind: 'main', batch: 100 }, worker100: { kind: 'worker', batch: 100 } }
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

if (args.child) {
  await runChild(args.child, args.home)
} else {
  const rounds = Number(args.rounds ?? 5)
  const root = mkdtempSync(join(tmpdir(), 'ap-usage-fixture-'))
  try {
    fixtureHome(root, Number(args['claude-files'] ?? 100), Number(args['codex-files'] ?? 60))
    const results = Object.fromEntries(Object.keys(MODES).map(name => [name, []]))
    for (let round = 0; round < rounds; round += 1) {
      for (const mode of Object.keys(MODES)) {
        const run = spawnSync(process.execPath, [...NODE_FLAGS, fileURLToPath(import.meta.url), `--child=${mode}`, `--home=${root}`], { encoding: 'utf8' })
        if (run.status !== 0) throw new Error(`${mode} failed: ${run.stderr}`)
        results[mode].push(JSON.parse(run.stdout.trim().split('\n').pop()))
      }
    }
    const summary = {}
    for (const mode of Object.keys(MODES)) {
      summary[mode] = Object.fromEntries(['mean', 'p99', 'max', 'totalMs'].map(key => [key, Number(median(results[mode].map(r => r[key])).toFixed(2))]))
      summary[mode].imported = results[mode][0].imported
    }
    console.log(JSON.stringify({ rounds, runs: results, medianMs: summary }, null, 2))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
