export type LocalServerId = 'event' | 'permission' | 'presentation'

export type LocalServerState = 'starting' | 'listening' | 'retrying' | 'failed'

export interface LocalServerHealth {
  id: LocalServerId
  port: number
  state: LocalServerState
  /** Number of failed bind attempts since the last successful listen. */
  attempt: number
  code?: string
  occupant?: 'agent-pets' | 'other' | 'unknown'
}

export interface LocalServerHealthSnapshot {
  servers: LocalServerHealth[]
}
