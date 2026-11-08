import type { AgentAdapterId, InstallErrorCode, InstallOutcome, InstallReport } from '../src/types/agent-adapter.ts'
import type { ConfigWriteResult } from './safe-config-write.ts'
import { ConfigRefusedError } from './safe-config-write.ts'
import { NodeNotFoundError, NodeUnsupportedError } from './node-resolver.ts'

export function reportFromWrites(results: ReadonlyArray<ConfigWriteResult>): InstallReport {
  const written = results.filter(result => result.status === 'written')
  return {
    changedFiles: written.map(result => result.path),
    backupPaths: written.flatMap(result => (result.backupPath ? [result.backupPath] : [])),
  }
}

export function classifyInstallError(error: unknown): { code: InstallErrorCode, path?: string } {
  if (error instanceof ConfigRefusedError) {
    const code: InstallErrorCode = error.code === 'unsafe'
      ? 'config_unsafe'
      : error.code === 'too_large' ? 'config_too_large' : 'config_unparseable'
    return { code, path: error.filePath }
  }
  if (error instanceof NodeNotFoundError) return { code: 'node_missing' }
  if (error instanceof NodeUnsupportedError) return { code: 'node_unsupported' }
  const errno = (error as NodeJS.ErrnoException | null)?.code
  const target = (error as NodeJS.ErrnoException | null)?.path
  const path = typeof target === 'string' ? target : undefined
  if (errno === 'EACCES' || errno === 'EPERM') return { code: 'permission_denied', path }
  if (errno === 'EBUSY') return { code: 'file_busy', path }
  if (errno === 'EROFS') return { code: 'read_only', path }
  return { code: 'unknown', path }
}

/**
 * `before` is the health before the install: a degraded integration that gets files rewritten is
 * a repair; nothing rewritten is "unchanged".
 */
export function buildOutcome(
  adapterId: AgentAdapterId,
  report: InstallReport,
  before: 'ready' | 'needs_install' | 'degraded' | 'needs_approval' | 'error',
): InstallOutcome {
  const action = report.changedFiles.length === 0
    ? 'unchanged'
    : before === 'degraded' ? 'repaired' : 'installed'
  return { adapterId, action, changedFiles: report.changedFiles, backupPaths: report.backupPaths }
}

export function failedOutcome(adapterId: AgentAdapterId, error: unknown): InstallOutcome {
  const { code, path } = classifyInstallError(error)
  return {
    adapterId,
    action: 'failed',
    changedFiles: [],
    backupPaths: [],
    errorCode: code,
    ...(path ? { errorPath: path } : {}),
  }
}
