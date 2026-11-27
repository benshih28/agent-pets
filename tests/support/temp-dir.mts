import * as fs from 'node:fs'

// Windows 的防毒或索引服務會短暫鎖住剛建立的檔案，rmSync 因而拋 EPERM／EBUSY；靠 Node 內建的線性退避重試吸收（最多約 1.1 秒）。
export const TEMP_TREE_REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 20 } as const

export function removeTempTree(target: string): void {
  fs.rmSync(target, TEMP_TREE_REMOVE_OPTIONS)
}

export async function removeTempTreeAsync(target: string): Promise<void> {
  await fs.promises.rm(target, TEMP_TREE_REMOVE_OPTIONS)
}
