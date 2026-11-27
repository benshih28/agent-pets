import { app } from 'electron'
import { memoizeUserDataPaths } from './user-data-paths.ts'

export const appUserDataPaths = memoizeUserDataPaths(() => app.getPath('userData'))
