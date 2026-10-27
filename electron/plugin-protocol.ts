import { constants as fsConstants } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const PLUGIN_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src agent-pets://plugin; worker-src agent-pets://plugin; connect-src 'none'; img-src agent-pets://plugin; style-src agent-pets://plugin; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export const PLUGIN_WORKER_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src agent-pets://plugin; worker-src 'none'; connect-src 'none'; img-src agent-pets://plugin; style-src agent-pets://plugin; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export const PLUGIN_PANEL_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src agent-pets://plugin; connect-src 'none'; img-src agent-pets://plugin; style-src agent-pets://plugin; font-src agent-pets://plugin; media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
export const PLUGIN_PROTOCOL_MAX_FILE_BYTES = 5 * 1024 * 1024

export interface PluginProtocolAssets {
  'index.html': string
  'host.js': string
  'worker-bootstrap.js': string
}

export interface PluginProtocolOptions {
  pluginRootForId: (pluginId: string) => string | null
  hostAssets: PluginProtocolAssets
  pluginSkinAssetForId?: (pluginId: string, relativePath: string) => { data: Uint8Array; contentType: string } | null | undefined
    | Promise<{ data: Uint8Array; contentType: string } | null | undefined>
}

export interface PluginHostProtocolOptions {
  pluginRootForToken: (token: string) => string | null
  hostAssets: PluginProtocolAssets
}

export interface PluginPanelProtocolOptions {
  pluginRootForToken: (token: string) => string | null
  tokensCss: string
}

export interface PluginProtocolRequestLike {
  url: string
  method?: string
}

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function readRegularFileWithin(root: string, relativePath: string): Promise<Buffer | null> {
  if (!path.isAbsolute(root) || typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.length > 512 || relativePath.includes('\\')) return null
  const segments = relativePath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null

  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    const rootStat = await fs.lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null
    const rootReal = await fs.realpath(root)
    const candidate = path.resolve(root, ...segments)
    if (!isPathInside(root, candidate)) return null
    const candidateStat = await fs.lstat(candidate)
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink() || candidateStat.size > PLUGIN_PROTOCOL_MAX_FILE_BYTES) return null
    const candidateReal = await fs.realpath(candidate)
    if (!isPathInside(rootReal, candidateReal)) return null
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(candidateReal, fsConstants.O_RDONLY | noFollow)
    const openedStat = await handle.stat()
    if (!openedStat.isFile() || openedStat.size > PLUGIN_PROTOCOL_MAX_FILE_BYTES) return null
    return await handle.readFile()
  } catch {
    return null
  } finally {
    try { await handle?.close() } catch {}
  }
}

function contentType(relativePath: string): string {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    default: return 'application/octet-stream'
  }
}

function pluginResponse(relativePath: string, bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      'content-type': contentType(relativePath),
      'x-content-type-options': 'nosniff',
      'content-security-policy': PLUGIN_CONTENT_SECURITY_POLICY,
    },
  })
}

function pluginSkinResponse(bytes: Uint8Array, type: string): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      'content-type': type,
      'x-content-type-options': 'nosniff',
      'content-security-policy': PLUGIN_CONTENT_SECURITY_POLICY,
      'cache-control': 'no-store',
    },
  })
}

function pluginHostResponse(relativePath: string, bytes: Uint8Array, workerResponse = false): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      'content-type': contentType(relativePath),
      'x-content-type-options': 'nosniff',
      'content-security-policy': workerResponse
        ? PLUGIN_WORKER_CONTENT_SECURITY_POLICY
        : PLUGIN_CONTENT_SECURITY_POLICY,
    },
  })
}

function pluginPanelResponse(relativePath: string, bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      'content-type': contentType(relativePath),
      'x-content-type-options': 'nosniff',
      'content-security-policy': PLUGIN_PANEL_CONTENT_SECURITY_POLICY,
      'cache-control': 'no-store',
    },
  })
}

function decodePluginPanelPath(pathname: string): string[] | null {
  if (!pathname.startsWith('/') || pathname.includes('\\')) return null
  const segments = pathname.slice(1).split('/')
  if (segments.some(segment => segment.length === 0)) return null
  const decoded: string[] = []
  for (const segment of segments) {
    let value: string
    try { value = decodeURIComponent(segment) } catch { return null }
    if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('%')) return null
    decoded.push(value)
  }
  return decoded
}

const PLUGIN_PANEL_ALLOWED_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.png', '.webp'])

/** Creates a panel-only handler scoped to a random plugin token plus one read-only shared stylesheet. */
export function createPluginPanelProtocolHandler(options: PluginPanelProtocolOptions): (request: PluginProtocolRequestLike) => Promise<Response> {
  return async request => {
    if (request.method && request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    try {
      const url = new URL(request.url)
      if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin' || url.username || url.password || url.port
        || url.search || url.hash) return new Response('Not found', { status: 404 })
      const segments = decodePluginPanelPath(url.pathname)
      if (!segments || segments.length < 2) return new Response('Not found', { status: 404 })
      const [scope, ...relativeSegments] = segments
      const relativePath = relativeSegments.join('/')
      if (scope === '_shared') {
        if (relativePath !== 'tokens.css' || typeof options.tokensCss !== 'string'
          || Buffer.byteLength(options.tokensCss, 'utf8') > 256 * 1024) return new Response('Not found', { status: 404 })
        return pluginPanelResponse('tokens.css', new TextEncoder().encode(options.tokensCss))
      }
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(scope ?? '')
        || !PLUGIN_PANEL_ALLOWED_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())) {
        return new Response('Not found', { status: 404 })
      }
      const root = options.pluginRootForToken(scope)
      if (!root) return new Response('Not found', { status: 404 })
      const data = await readRegularFileWithin(root, relativePath)
      if (!data) return new Response('Not found', { status: 404 })
      return pluginPanelResponse(relativePath, data)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }
}

async function handlePluginHostProtocolRequest(requestUrl: string, options: PluginHostProtocolOptions): Promise<Response> {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin' || url.username || url.password || url.port
      || url.search || url.hash || url.pathname.includes('%')) return new Response('Not found', { status: 404 })
    const pathname = decodeURIComponent(url.pathname)
    const match = pathname.match(/^\/([^/]+)\/(.+)$/)
    if (!match) return new Response('Not found', { status: 404 })
    const tokenOrHost = match[1] ?? ''
    const relativePath = match[2] ?? ''
    if (tokenOrHost === '_host') {
      if (!Object.hasOwn(options.hostAssets, relativePath)) return new Response('Not found', { status: 404 })
      return pluginHostResponse(
        relativePath,
        new TextEncoder().encode(options.hostAssets[relativePath as keyof PluginProtocolAssets]),
        relativePath === 'worker-bootstrap.js',
      )
    }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(tokenOrHost)) {
      return new Response('Not found', { status: 404 })
    }
    const root = options.pluginRootForToken(tokenOrHost)
    if (!root) return new Response('Not found', { status: 404 })
    const data = await readRegularFileWithin(root, relativePath)
    if (!data) return new Response('Not found', { status: 404 })
    return pluginHostResponse(relativePath, data, true)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

/** Creates the isolated partition handler; it can only serve plugin-host resources. */
export function createPluginHostProtocolHandler(options: PluginHostProtocolOptions): (request: PluginProtocolRequestLike) => Promise<Response> {
  return async request => {
    if (request.method && request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    return await handlePluginHostProtocolRequest(request.url, options)
  }
}

/** Serves only embedded host resources and explicitly supplied current-version plugin roots. */
export async function handlePluginProtocolRequest(requestUrl: string, options: PluginProtocolOptions): Promise<Response> {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== 'agent-pets:' || url.hostname !== 'plugin' || url.username || url.password || url.port
      || url.search || url.hash || url.pathname.includes('\\')) return new Response('Not found', { status: 404 })
    const encodedSegments = url.pathname.startsWith('/') ? url.pathname.slice(1).split('/') : []
    if (encodedSegments.length < 2 || encodedSegments.some(segment => segment.length === 0)) return new Response('Not found', { status: 404 })
    const segments: string[] = []
    for (const segment of encodedSegments) {
      let decoded: string
      try { decoded = decodeURIComponent(segment) } catch { return new Response('Not found', { status: 404 }) }
      if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')
        || decoded.includes('%') || /[\u0000-\u001f\u007f]/.test(decoded)) return new Response('Not found', { status: 404 })
      segments.push(decoded)
    }
    const pathname = `/${segments.join('/')}`
    const match = pathname.match(/^\/([^/]+)\/(.+)$/)
    if (!match) return new Response('Not found', { status: 404 })
    const id = match[1] ?? ''
    const relativePath = match[2] ?? ''
    if (id === '_host') {
      if (!Object.hasOwn(options.hostAssets, relativePath)) return new Response('Not found', { status: 404 })
      const source = options.hostAssets[relativePath as keyof PluginProtocolAssets]
      return pluginResponse(relativePath, new TextEncoder().encode(source))
    }
    if (!PLUGIN_ID.test(id)) return new Response('Not found', { status: 404 })
    const root = options.pluginRootForId(id)
    if (!root) return new Response('Not found', { status: 404 })
    const skinAsset = await options.pluginSkinAssetForId?.(id, relativePath)
    if (skinAsset === null) return new Response('Not found', { status: 404 })
    if (skinAsset) return pluginSkinResponse(skinAsset.data, skinAsset.contentType)
    const data = await readRegularFileWithin(root, relativePath)
    if (!data) return new Response('Not found', { status: 404 })
    return pluginResponse(relativePath, data)
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
