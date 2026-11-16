import type { PermissionRequestView } from '../../src/types/permission.ts'

/** 完整的待決權限請求；各測試只覆寫自己在意的欄位，其餘維持合法的中性值。 */
export function makePermissionRequestView(overrides: Partial<PermissionRequestView> = {}): PermissionRequestView {
  return {
    requestId: 'r1', adapterId: 'opencode-cli', agentId: 'opencode-cli', sessionId: 's1', generation: 1,
    action: 'read', description: 'a.ts', details: [], truncatedChars: 0, risk: 'low', network: false,
    receivedAt: 0, expiresAt: 60_000, status: 'pending', allowedDecisions: ['allow_once', 'deny'],
    queuePosition: 0, queueSize: 1, hotkeyEligible: false, truncated: false,
    ...overrides,
  }
}
