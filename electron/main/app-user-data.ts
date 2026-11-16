import { app } from 'electron'
import { memoizeUserDataPaths } from './user-data-paths.ts'

/** 執行中 app 的 userData 路徑表；`app.getPath('userData')` 只在第一次使用時讀一次。 */
export const appUserDataPaths = memoizeUserDataPaths(() => app.getPath('userData'))
