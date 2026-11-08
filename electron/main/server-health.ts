import { request } from 'node:http'
import type { LocalServerHealth, LocalServerHealthSnapshot, LocalServerId } from '../../src/types/reliability.ts'
import type { LocalServerListenHandle, LocalServerListenStatus } from '../local-server-listen.ts'

export const AGENT_PETS_SERVER_HEADER = 'x-agent-pets-server'

export interface ServerHealthTrackerOptions {
  onChange?: (snapshot: LocalServerHealthSnapshot) => void
  /** One-shot user notice for a persistent failure; never called again until the server recovers. */
  onPersistentFailure?: (health: LocalServerHealth) => void
  probe?: (port: number) => Promise<LocalServerHealth['occupant']>
}

export interface ServerHealthTracker {
  register(id: LocalServerId, port: number): {
    onStatus(status: LocalServerListenStatus): void
    onPersistentFailure(status: LocalServerListenStatus): void
    attach(handle: LocalServerListenHandle): void
  }
  snapshot(): LocalServerHealthSnapshot
  retry(id?: LocalServerId): void
}

/** Identifies another Agent Pets instance holding the port, without sending any token. */
export function probePortOccupant(port: number, timeoutMs = 800): Promise<LocalServerHealth['occupant']> {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path: '/v1/events', timeout: timeoutMs }, res => {
      res.resume()
      resolve(res.headers[AGENT_PETS_SERVER_HEADER] ? 'agent-pets' : 'other')
    })
    req.on('timeout', () => { req.destroy(); resolve('unknown') })
    req.on('error', () => resolve('unknown'))
    req.end()
  })
}

export function createServerHealthTracker(options: ServerHealthTrackerOptions = {}): ServerHealthTracker {
  const entries = new Map<LocalServerId, LocalServerHealth>()
  const handles = new Map<LocalServerId, LocalServerListenHandle>()
  const probe = options.probe ?? probePortOccupant
  const emit = () => { try { options.onChange?.(snapshot()) } catch {} }
  const snapshot = (): LocalServerHealthSnapshot => ({ servers: [...entries.values()].map(entry => ({ ...entry })) })

  return {
    register(id, port) {
      entries.set(id, { id, port, state: 'starting', attempt: 0 })
      return {
        onStatus: status => {
          const previous = entries.get(id)
          const next: LocalServerHealth = {
            id, port, state: status.state, attempt: status.attempt,
            ...(status.code ? { code: status.code } : {}),
            ...(status.state === 'listening' ? {} : previous?.occupant ? { occupant: previous.occupant } : {}),
          }
          entries.set(id, next)
          emit()
        },
        onPersistentFailure: status => {
          const health = entries.get(id)
          if (!health) return
          try { options.onPersistentFailure?.({ ...health, state: status.state, code: status.code }) } catch {}
          if (status.code === 'EADDRINUSE') {
            void probe(port).then(occupant => {
              const latest = entries.get(id)
              if (!latest || latest.state === 'listening') return
              entries.set(id, { ...latest, occupant })
              emit()
            }).catch(() => {})
          }
        },
        attach: handle => { handles.set(id, handle) },
      }
    },
    snapshot,
    retry(id) {
      for (const [serverId, handle] of handles) if (!id || id === serverId) handle.retryNow()
    },
  }
}
