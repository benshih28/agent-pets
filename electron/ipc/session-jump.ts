import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { ALL_SOURCES } from '../../src/types/agent.ts'
import { isSessionJumpAction, type SessionJumpAction, type SessionJumpResult } from '../../src/types/session-jump.ts'
import { sessionJumpKey } from '../session-jump.ts'
import { IPC_CHANNELS } from './channels.ts'

const MAX_SESSION_ID_LENGTH = 256
const SOURCES: ReadonlySet<string> = new Set(ALL_SOURCES)

export interface SessionJumpIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>
  /** Pet or panel main frame. */
  assertTrustedIpcSender(event: IpcMainInvokeEvent): void
  runSessionJump(action: SessionJumpAction, key: string): Promise<SessionJumpResult>
}

function isValidSessionJumpRequest(value: unknown): value is { action: SessionJumpAction; source: string; sessionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  if (Object.keys(raw).length !== 3) return false
  return isSessionJumpAction(raw.action)
    && typeof raw.source === 'string' && SOURCES.has(raw.source)
    && typeof raw.sessionId === 'string' && raw.sessionId.length > 0 && raw.sessionId.length <= MAX_SESSION_ID_LENGTH
}

export function registerSessionJumpIpc(deps: SessionJumpIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.sessionJump, async (event, payload: unknown): Promise<SessionJumpResult> => {
    deps.assertTrustedIpcSender(event)
    if (!isValidSessionJumpRequest(payload)) return { ok: false, error: 'invalid_request' }
    return deps.runSessionJump(payload.action, sessionJumpKey(payload.source, payload.sessionId))
  })
}
