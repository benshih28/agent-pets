import type { PermissionRequestView } from '../../src/types/permission.ts'

export function makePermissionRequestView(overrides: Partial<PermissionRequestView> = {}): PermissionRequestView {
  return {
    requestId: 'r1', adapterId: 'opencode-cli', agentId: 'opencode-cli', sessionId: 's1', generation: 1,
    action: 'read', description: 'a.ts', details: [], truncatedChars: 0, risk: 'low', network: false,
    receivedAt: 0, expiresAt: 60_000, status: 'pending', allowedDecisions: ['allow_once', 'deny'],
    queuePosition: 0, queueSize: 1, hotkeyEligible: false, truncated: false,
    ...overrides,
  }
}
