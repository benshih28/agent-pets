// 測試直接用 Node 載入這個檔，執行期 import 必須用相對路徑（見 agent-pets-conventions §1）。
import { t } from '../i18n.ts'
import { AGENT_ADAPTER_REGISTRY } from '../types/agent-adapter.ts'
import type { TranslationKey } from '@/i18n'
import type { AgentFamilyKey } from '@/types/agent'

// key 是既有的 i18n key（ProjectMcpPanel 也用），不能改名；新增家族時 satisfies 會要求補一格。
const FAMILY_LABEL_KEYS = {
  codex: 'clientCodex',
  claude: 'clientClaudeCode',
  opencode: 'clientOpenCode',
} as const satisfies Record<AgentFamilyKey, TranslationKey>

// adapter id 由 registry 對到家族；沒有家族的 adapter（generic-http）與未知 id 都原樣顯示。
const LABEL_KEY_BY_ADAPTER: ReadonlyMap<string, TranslationKey> = new Map(
  AGENT_ADAPTER_REGISTRY.flatMap(adapter => adapter.family ? [[adapter.id, FAMILY_LABEL_KEYS[adapter.family]] as const] : []),
)

/** Display name for a History adapter id; unknown ids are shown as-is. */
export function agentDisplayName(adapterId: string): string {
  const key = LABEL_KEY_BY_ADAPTER.get(adapterId)
  return key ? t(key) : adapterId
}
