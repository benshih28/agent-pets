import * as fs from 'node:fs'
import { clipboard, shell } from 'electron'
import { activateMacBundle, SessionJumpService } from '../session-jump.ts'
import type { DesktopPreferences } from '../../src/types/desktop'

// Electron wiring for the session jump service; the policy lives in electron/session-jump.ts.
export { takeSessionJumpContext, withSessionJumpContext } from '../session-jump.ts'

export function createSessionJumpService(getPreferences: () => DesktopPreferences): SessionJumpService {
  return new SessionJumpService({
    platform: process.platform,
    getPreferences,
    activateBundle: bundleId => activateMacBundle(bundleId),
    // Reveal only (Finder / Explorer selects the folder); never shell.openPath, which can launch apps.
    revealDirectory: directory => shell.showItemInFolder(directory),
    writeClipboard: text => clipboard.writeText(text),
    realpath: target => fs.promises.realpath(target),
    stat: target => fs.promises.stat(target),
    exists: async target => {
      try {
        await fs.promises.lstat(target)
        return true
      } catch {
        return false
      }
    },
  })
}
