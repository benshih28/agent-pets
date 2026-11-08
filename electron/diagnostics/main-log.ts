import { app } from 'electron'
import { join } from 'node:path'
import { createLogger, type Logger, type LogLevel } from './logger.ts'

let logger: Logger | null = null
let teed = false

export function mainLogger(): Logger {
  if (!logger) logger = createLogger({ directory: join(app.getPath('userData'), 'logs') })
  return logger
}

export function logMain(level: LogLevel, channel: string, message: string, detail?: unknown): void {
  try { mainLogger().log(level, channel, message, detail) } catch {}
}

function formatArgs(args: unknown[]): { message: string; detail?: unknown } {
  const [first, ...rest] = args
  const message = typeof first === 'string' ? first : first instanceof Error ? first.message : String(first)
  const detail = (typeof first === 'string' ? rest : [first, ...rest].filter(item => item instanceof Error))
  return { message, detail: Array.isArray(detail) && detail.length === 0 ? undefined : detail }
}

/**
 * Mirrors console.error/warn into the rotating log so existing call sites
 * are captured in packaged builds without touching each of them.
 */
export function teeConsoleToLog(): void {
  if (teed) return
  teed = true
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    originalError(...args)
    const { message, detail } = formatArgs(args)
    logMain('error', 'main', message, detail)
  }
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    const { message, detail } = formatArgs(args)
    logMain('warn', 'main', message, detail)
  }
}

export function flushMainLog(): void {
  try { logger?.flush() } catch {}
}
