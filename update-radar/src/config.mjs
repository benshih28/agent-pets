export const FEED_SCHEMA_VERSION = 1
export const DEFAULT_PORT = 4317
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024
export const MAX_FEED_BYTES = 5 * 1024 * 1024
export const FETCH_TIMEOUT_MS = 15_000
export const MAX_REDIRECTS = 3
export const MAX_FEED_ITEMS = 160

export const TIBO_X_SOURCE = Object.freeze({
  id: 'tibo-x',
  provider: 'x',
  product: 'social',
  kind: 'x-public-profile',
  username: 'thsottiaux',
  url: 'https://x.com/thsottiaux',
  publicUrl: 'https://x.com/thsottiaux',
  maxItems: 20,
})

export const SOURCE_DEFINITIONS = Object.freeze([
  {
    id: 'openai-api',
    provider: 'openai',
    product: 'api',
    kind: 'dated-markdown',
    url: 'https://developers.openai.com/api/docs/changelog.md',
    publicUrl: 'https://developers.openai.com/api/docs/changelog',
    splitBullets: false,
    maxItems: 48,
  },
  {
    id: 'openai-deprecations',
    provider: 'openai',
    product: 'api',
    kind: 'dated-markdown',
    url: 'https://developers.openai.com/api/docs/deprecations.md',
    publicUrl: 'https://developers.openai.com/api/docs/deprecations',
    splitBullets: false,
    maxItems: 32,
  },
  {
    id: 'anthropic-platform',
    provider: 'anthropic',
    product: 'api',
    kind: 'dated-markdown',
    url: 'https://platform.claude.com/docs/en/release-notes/overview.md',
    publicUrl: 'https://platform.claude.com/docs/en/release-notes/overview',
    splitBullets: true,
    maxItems: 48,
  },
  {
    id: 'anthropic-model-deprecations',
    provider: 'anthropic',
    product: 'model',
    kind: 'dated-markdown',
    url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md',
    publicUrl: 'https://platform.claude.com/docs/en/about-claude/model-deprecations',
    splitBullets: false,
    maxItems: 24,
  },
  {
    id: 'claude-code',
    provider: 'anthropic',
    product: 'claude-code',
    kind: 'github-releases',
    url: 'https://api.github.com/repos/anthropics/claude-code/releases?per_page=10',
    publicUrl: 'https://github.com/anthropics/claude-code/releases',
    maxItems: 48,
  },
])

export function isAllowedSourceUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false

  if (url.hostname === 'developers.openai.com') {
    return url.search === '' && url.pathname.startsWith('/api/docs/')
  }

  if (url.hostname === 'platform.claude.com') {
    return url.search === '' && url.pathname.startsWith('/docs/en/')
  }

  if (url.hostname === 'api.github.com') {
    if (url.pathname !== '/repos/anthropics/claude-code/releases') return false
    if ([...url.searchParams.keys()].some(key => key !== 'per_page')) return false
    const perPage = Number(url.searchParams.get('per_page') ?? '10')
    return Number.isInteger(perPage) && perPage >= 1 && perPage <= 20
  }

  if (url.hostname === 'x.com') {
    return url.search === '' && (
      url.pathname === '/thsottiaux'
      || /^\/thsottiaux\/status\/\d{1,19}$/.test(url.pathname)
    )
  }

  return false
}
