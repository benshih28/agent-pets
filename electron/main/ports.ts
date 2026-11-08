export interface LocalPorts {
  event: number
  permission: number
  presentation: number
}

export const DEFAULT_LOCAL_PORTS: LocalPorts = { event: 17_373, permission: 17_374, presentation: 17_375 }

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
    event: parsePort(env.AGENT_PETS_EVENT_PORT, DEFAULT_LOCAL_PORTS.event),
    permission: parsePort(env.AGENT_PETS_PERMISSION_PORT, DEFAULT_LOCAL_PORTS.permission),
    presentation: parsePort(env.AGENT_PETS_PRESENTATION_PORT, DEFAULT_LOCAL_PORTS.presentation),
  }
}
