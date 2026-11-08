export type LocalServerId = 'event' | 'permission' | 'presentation'

export type LocalServerState = 'starting' | 'listening' | 'retrying' | 'failed'

export interface LocalServerHealth {
  id: LocalServerId
  port: number
  state: LocalServerState
  /** Number of failed bind attempts since the last successful listen. */
  attempt: number
  /** Node error code of the last failure (for example EADDRINUSE, EACCES). */
  code?: string
  /** Best-effort identity of whatever holds the port. */
  occupant?: 'agent-pets' | 'other' | 'unknown'
}

export interface LocalServerHealthSnapshot {
  servers: LocalServerHealth[]
}
