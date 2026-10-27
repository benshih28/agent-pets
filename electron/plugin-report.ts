import { comparePluginSemver } from './plugin-catalog.ts'

const PLUGIN_ID = /^(?!_host$|_shared$)[a-z0-9-]{3,48}$/
export const DEFAULT_PLUGIN_ISSUE_REPORT_URL = 'https://github.com/Ponpon55837/agent-pets-plugins/issues/new'

export function buildPluginIssueReportUrl(
  baseUrl: unknown,
  pluginId: unknown,
  version: unknown,
  localInstall: unknown,
): string | null {
  if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)
    || typeof version !== 'string' || comparePluginSemver(version, version) === null
    || typeof localInstall !== 'boolean') return null
  let url: URL
  try { url = new URL(String(baseUrl)) } catch { return null }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
    || url.username || url.password || (url.port && url.port !== '443')
    || url.search || url.hash || !/^\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/issues\/new\/?$/.test(url.pathname)) {
    return null
  }
  const title = localInstall
    ? `[local install] [${pluginId}] ${version}`
    : `[${pluginId}] ${version}`
  url.searchParams.set('title', title)
  return url.href
}
