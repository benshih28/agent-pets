#!/usr/bin/env node
// 發版用的本機下載轉接：GitHub 的 releases/download 網址偶爾對特定檔案持續回 504，
// 但同一個檔案經 GitHub API 下載正常。這個服務只監聽 127.0.0.1，把 electron-builder
// 與 @electron/get 的下載改走 API；檔案內容不變，checksum 仍由打包工具照原本方式驗證。
//
// 路徑：/electron/<tag>/<file> → electron/electron
//       /builder/<release>/<file> → electron-userland/electron-builder-binaries
// 啟動後把埠號寫到 stdout 第一行，例如 `port=43123`。
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const REPOSITORIES = new Map([
  ['electron', 'electron/electron'],
  ['builder', 'electron-userland/electron-builder-binaries'],
])
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const RELEASE_CACHE_LIMIT = 16
const token = process.env.GITHUB_TOKEN ?? ''
const apiHeaders = {
  'User-Agent': 'agent-pets-release-asset-mirror',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
}
// tag → Map<檔名, asset API 網址>；同一次打包會重複查同一個 release。
const releaseAssets = new Map()

/** 解析並驗證請求路徑；不合規則時回傳 null。 */
export function parseRequest(url) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname)
  } catch {
    return null
  }
  const parts = pathname.split('/')
  if (parts.length !== 4 || parts[0] !== '') return null
  const repository = REPOSITORIES.get(parts[1])
  const [tag, file] = [parts[2], parts[3]]
  if (!repository || !TAG_PATTERN.test(tag) || !FILE_PATTERN.test(file) || tag.includes('..') || file.includes('..')) return null
  return { repository, tag, file }
}

async function assetUrl({ repository, tag, file }) {
  const key = `${repository}@${tag}`
  let assets = releaseAssets.get(key)
  if (!assets) {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`, { headers: apiHeaders })
    if (!response.ok) throw Object.assign(new Error(`release ${key}: HTTP ${response.status}`), { status: response.status === 404 ? 404 : 502 })
    const release = await response.json()
    assets = new Map((release.assets ?? []).map(asset => [asset.name, asset.url]))
    if (releaseAssets.size >= RELEASE_CACHE_LIMIT) releaseAssets.delete(releaseAssets.keys().next().value)
    releaseAssets.set(key, assets)
  }
  return assets.get(file) ?? null
}

const server = createServer(async (request, response) => {
  const target = request.method === 'GET' || request.method === 'HEAD' ? parseRequest(request.url ?? '') : null
  if (!target) {
    response.writeHead(400).end()
    return
  }
  try {
    const url = await assetUrl(target)
    if (!url) {
      response.writeHead(404).end()
      return
    }
    const upstream = await fetch(url, { headers: { ...apiHeaders, Accept: 'application/octet-stream' }, redirect: 'follow' })
    if (!upstream.ok || !upstream.body) {
      response.writeHead(502).end()
      return
    }
    const length = upstream.headers.get('content-length')
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', ...(length ? { 'Content-Length': length } : {}) })
    if (request.method === 'HEAD') {
      await upstream.body.cancel()
      response.end()
      return
    }
    await pipeline(Readable.fromWeb(upstream.body), response)
  } catch (error) {
    console.error(`mirror: ${target.repository} ${target.tag}/${target.file}: ${error.message}`)
    if (!response.headersSent) response.writeHead(error.status ?? 502)
    response.end()
  }
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(0, '127.0.0.1', () => {
    console.log(`port=${server.address().port}`)
  })
}
