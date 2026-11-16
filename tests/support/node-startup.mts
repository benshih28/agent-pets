import { spawn } from 'node:child_process'

/**
 * 空的 node 程序（和 hook 相同的環境）要多久。機器忙時 node 光是啟動就可能超過一秒，
 * 所以 hook 的耗時判斷一律相對於這個基準：基準吸收負載，加上的餘裕才是要擋的行為（重試等待、等 app 回答）。
 * 取兩次的最大值，避免剛好遇到一次比較快的啟動。
 */
export async function nodeStartupBaselineMs(env: NodeJS.ProcessEnv): Promise<number> {
  const once = () => new Promise<number>((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(process.execPath, ['-e', ''], { env, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', () => resolve(Date.now() - startedAt))
  })
  return Math.max(await once(), await once())
}

/**
 * 執行 hook，並在前後各量一次基準取較大值：負載會在 hook 執行期間變動，只在之前量可能剛好量到空檔
 * （F2 實測：基準 314 ms，hook 卻因負載升高花了 8066 ms）。
 */
export async function withStartupBaseline<T extends object>(env: NodeJS.ProcessEnv, run: () => Promise<T>): Promise<T & { baseline: number }> {
  const before = await nodeStartupBaselineMs(env)
  const result = await run()
  return { ...result, baseline: Math.max(before, await nodeStartupBaselineMs(env)) }
}
