import * as fs from 'node:fs'

// Windows 的防毒或索引服務會短暫鎖住剛建立的檔案，這時 rmSync 拋 EPERM／EBUSY。
// 平行跑全量測試時實測約每 3000 次刪除出現一次（F2 報告）；Node 對這些錯誤碼內建線性退避重試，
// 10 次、每次多等 20 ms，最多約 1.1 秒，正常情況下第一次就成功、不增加耗時。
export const TEMP_TREE_REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 10, retryDelay: 20 } as const

export function removeTempTree(target: string): void {
  fs.rmSync(target, TEMP_TREE_REMOVE_OPTIONS)
}

export async function removeTempTreeAsync(target: string): Promise<void> {
  await fs.promises.rm(target, TEMP_TREE_REMOVE_OPTIONS)
}
