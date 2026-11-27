import { spawn } from 'node:child_process'

// 機器忙時 node 光是啟動就可能超過一秒，hook 的耗時判斷一律相對於這個基準；取兩次最大值避免剛好遇到較快的啟動。
export async function nodeStartupBaselineMs(env: NodeJS.ProcessEnv): Promise<number> {
  const once = () => new Promise<number>((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(process.execPath, ['-e', ''], { env, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', () => resolve(Date.now() - startedAt))
  })
  return Math.max(await once(), await once())
}

// 負載會在 hook 執行期間變動，所以前後各量一次基準取較大值。
export async function withStartupBaseline<T extends object>(env: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T & { baseline: number }> {
  const before = await nodeStartupBaselineMs(env)
  const result = await run()
  return { ...result, baseline: Math.max(before, await nodeStartupBaselineMs(env)) }
}
