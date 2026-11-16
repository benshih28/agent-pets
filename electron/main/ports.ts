import { DEFAULT_LOCAL_PORTS, LOCAL_PORT_ENV } from '../../src/types/local-wire.ts'

export { DEFAULT_LOCAL_PORTS }

export type LocalPorts = Record<keyof typeof DEFAULT_LOCAL_PORTS, number>

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d{4,5}$/.test(value)) return fallback
  const port = Number(value)
  // Unprivileged range only; anything else silently falls back to the default.
  return port >= 1024 && port <= 65_535 ? port : fallback
}

/**
 * Development and e2e runs may override the three loopback ports so they never
 * fight an installed Agent Pets. Packaged builds ignore the environment
 * entirely: the installed hook scripts always talk to the default ports.
 */
export function resolveLocalPorts(env: Record<string, string | undefined>, isPackaged: boolean): LocalPorts {
  if (isPackaged) return { ...DEFAULT_LOCAL_PORTS }
  return {
    event: parsePort(env[LOCAL_PORT_ENV.event], DEFAULT_LOCAL_PORTS.event),
    permission: parsePort(env[LOCAL_PORT_ENV.permission], DEFAULT_LOCAL_PORTS.permission),
    presentation: parsePort(env[LOCAL_PORT_ENV.presentation], DEFAULT_LOCAL_PORTS.presentation),
  }
}
