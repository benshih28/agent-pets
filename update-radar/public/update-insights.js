const productLabels = Object.freeze({
  api: 'API',
  'claude-code': 'Claude Code',
  model: '模型',
})

const categoryLabels = Object.freeze({
  'new-model': '新模型',
  feature: '產品功能',
  'developer-tool': '開發工具',
  'api-change': 'API 變更',
})

const changeLabels = Object.freeze({
  added: '新增',
  improved: '改善',
  fixed: '修正',
  deprecated: '棄用',
  removed: '移除',
})

function attentionSignal(update) {
  const text = `${update?.title ?? ''} ${update?.summary ?? ''}`.toLowerCase()
  if (update?.replacement) return { label: `改用 ${update.replacement}`, tone: 'critical' }
  if (update?.changeType === 'deprecated' || update?.changeType === 'removed') {
    return { label: '需要規劃遷移', tone: 'critical' }
  }
  if (update?.effectiveAt) return { label: '留意生效日期', tone: 'critical' }
  if (/\b(breaking changes?|can break|migrat(?:e|ion|ing))\b/.test(text)) {
    return { label: '檢查相容性', tone: 'warn' }
  }
  if (/\b(pric(?:e|ing)|costs?|bill(?:ed|ing)?)\b/.test(text)) {
    return { label: '檢查成本', tone: 'warn' }
  }
  if (/\b(rate limits?|usage limits?|spend limits?|output limits?)\b/.test(text)) {
    return { label: '檢查限制', tone: 'warn' }
  }
  if (/\b(security|safety|permission|compliance|certificate|hipaa)\b/.test(text)) {
    return { label: '檢查安全／合規', tone: 'warn' }
  }
  return { label: '未標示必要動作', tone: 'neutral' }
}

export function deriveUpdateInsight(update) {
  const product = productLabels[update?.product] ?? '其他'
  const category = categoryLabels[update?.category] ?? '其他更新'
  return {
    change: changeLabels[update?.changeType] ?? '更新',
    scope: product === category ? product : `${product} · ${category}`,
    attention: attentionSignal(update),
  }
}
