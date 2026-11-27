import {
  APP_UPDATE_ALLOWED_HOSTS, APP_UPDATE_API_URL, APP_UPDATE_MAX_RESPONSE_BYTES, APP_UPDATE_REQUESTS_PER_MINUTE,
  APP_UPDATE_TIMEOUT_MS, isAppReleaseUrl, isNewerAppVersion, isValidAppVersion, parseLatestRelease,
} from '../app-update.ts'
import { AppUpdateStore, type AppUpdateStored } from '../app-update-store.ts'
import { DailyCheckSchedule } from '../daily-check-schedule.ts'
import { SlidingWindowLimiter } from '../sliding-window-limiter.ts'
import { isRecord } from '../value-guards.ts'
import type { AppUpdateCheckResponse, AppUpdateResult, AppUpdateState } from '../../src/types/app-update.ts'
import type { TranslationKey, TranslationParams } from '../../src/i18n'
import type { MainState } from './state.ts'

// 只檢查並提示，不下載也不安裝（未簽章建置無法安全自動更新）。
// 網路走 plugin 的 `pluginNetworkClient`（主機白名單、逾時、大小上限、頻率限制），網址是常數，renderer 無法指定。
// e2e 模式（globalThis.__agentPetsE2E 存在）只讀 `appUpdateFixture`，絕不連網。

export type AppUpdateRuntimeState = Pick<MainState, 'pluginNetworkClient' | 'pluginFeedController'>

export interface AppUpdateRuntimeDeps {
  state: AppUpdateRuntimeState
  userDataDirectory(): string
  appVersion(): string
  translate(key: TranslationKey, params?: TranslationParams): string
  openExternal(url: string): Promise<void>
  now?(): number
  wakeIntervalMs?: number
}

export interface AppUpdateRuntime {
  getState(): AppUpdateState
  setEnabled(enabled: boolean): AppUpdateState
  /** 不受「自動檢查」開關限制，但有頻率限制。 */
  checkNow(): Promise<AppUpdateCheckResponse>
  openRelease(): Promise<boolean>
  initializeAutoCheck(): void
  dispose(): void
}

const MANUAL_CHECKS_PER_MINUTE = 3
const NOTIFY_PLUGIN_ID = 'agent-pets-app-update'

type FetchOutcome = { status: number; body: string } | null

export function createAppUpdateRuntime(deps: AppUpdateRuntimeDeps): AppUpdateRuntime {
  const now = deps.now ?? Date.now
  const manualLimiter = new SlidingWindowLimiter(60_000, MANUAL_CHECKS_PER_MINUTE)
  let store: AppUpdateStore | null = null
  let inFlight: Promise<AppUpdateResult> | null = null
  let schedule: DailyCheckSchedule<AppUpdateResult> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function readStore(): AppUpdateStore {
    store ??= new AppUpdateStore(deps.userDataDirectory())
    return store
  }

  function stored(): AppUpdateStored {
    try { return readStore().get() } catch {
      return { enabled: false, lastCheckedAt: null, lastCheckedDay: null, lastResult: null, latestVersion: null, latestUrl: null, lastNotifiedVersion: null }
    }
  }

  function persist(patch: Partial<AppUpdateStored>): void {
    try { readStore().update(patch) } catch { /* silent */ }
  }

  // 已知可用更新與最近一次檢查結果分開：檢查失敗不會抹掉先前確認過的新版；每次讀取都重新驗證。
  function knownUpdate(value: AppUpdateStored): { version: string; url: string } | null {
    if (!isValidAppVersion(value.latestVersion) || !isAppReleaseUrl(value.latestUrl)) return null
    if (!isNewerAppVersion(deps.appVersion(), value.latestVersion)) return null
    return { version: value.latestVersion, url: value.latestUrl }
  }

  function snapshot(): AppUpdateState {
    const value = stored()
    return {
      currentVersion: deps.appVersion(),
      enabled: value.enabled,
      lastCheckedAt: value.lastCheckedAt,
      lastResult: value.lastResult,
      latestVersion: knownUpdate(value)?.version ?? null,
    }
  }

  async function fetchLatest(): Promise<FetchOutcome> {
    if (Object.prototype.hasOwnProperty.call(globalThis, '__agentPetsE2E')) {
      const e2e = (globalThis as typeof globalThis & { __agentPetsE2E?: unknown }).__agentPetsE2E
      const fixture = isRecord(e2e) ? e2e.appUpdateFixture : null
      if (!isRecord(fixture) || typeof fixture.body !== 'string') return null
      return { status: typeof fixture.status === 'number' ? fixture.status : 200, body: fixture.body }
    }
    const client = deps.state.pluginNetworkClient
    if (!client) return null
    const result = await client.fetch('agent-pets-app-update', APP_UPDATE_API_URL,
      { headers: { accept: 'application/vnd.github+json' } }, APP_UPDATE_ALLOWED_HOSTS,
      { maxResponseBytes: APP_UPDATE_MAX_RESPONSE_BYTES, timeoutMs: APP_UPDATE_TIMEOUT_MS, requestsPerMinute: APP_UPDATE_REQUESTS_PER_MINUTE })
    if (!result.ok || result.value.isBase64Encoded) return null
    return { status: result.value.status, body: result.value.body }
  }

  async function evaluate(): Promise<{ result: AppUpdateResult; latest?: { version: string; url: string } }> {
    let outcome: FetchOutcome
    try { outcome = await fetchLatest() } catch { return { result: 'failed' } }
    if (!outcome) return { result: 'failed' }
    // 還沒有任何 release 時 GitHub 回 404：沒有更新可提示。
    if (outcome.status === 404) return { result: 'up_to_date' }
    if (outcome.status < 200 || outcome.status >= 300) return { result: 'failed' }
    const parsed = parseLatestRelease(outcome.body)
    if (parsed.kind === 'invalid') return { result: 'failed' }
    if (parsed.kind === 'ignored') return { result: 'up_to_date' }
    return isNewerAppVersion(deps.appVersion(), parsed.release.version)
      ? { result: 'update_available', latest: parsed.release }
      : { result: 'up_to_date' }
  }

  function runCheck(): Promise<AppUpdateResult> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const { result, latest } = await evaluate()
      // failed 只更新時間與最近結果，保留先前的已知新版；up_to_date 才清掉。
      const known = latest
        ? { latestVersion: latest.version, latestUrl: latest.url }
        : result === 'up_to_date' ? { latestVersion: null, latestUrl: null } : {}
      persist({ lastCheckedAt: now(), lastResult: result, ...known })
      return result
    })().finally(() => { inFlight = null })
    return inFlight
  }

  function notifyUpdate(result: AppUpdateResult): void {
    if (result !== 'update_available') return
    const value = stored()
    if (!value.latestVersion || value.lastNotifiedVersion === value.latestVersion) return
    const added = deps.state.pluginFeedController?.addSystemNotification(
      NOTIFY_PLUGIN_ID,
      { 'zh-TW': 'Agent Pets', 'en-US': 'Agent Pets' },
      deps.translate('update.notifyTitle'),
      deps.translate('update.notifyBody', { version: value.latestVersion }),
    )
    // 通知沒送出（服務未就緒）就不記成已提示，下一次檢查再試。
    if (added) persist({ lastNotifiedVersion: value.latestVersion })
  }

  function ensureSchedule(): DailyCheckSchedule<AppUpdateResult> {
    schedule ??= new DailyCheckSchedule<AppUpdateResult>({
      isEnabled: () => stored().enabled,
      getLastCheckedDay: () => stored().lastCheckedDay,
      setLastCheckedDay: day => { readStore().update({ lastCheckedDay: day }) },
      check: runCheck,
      notify: notifyUpdate,
      now,
    })
    return schedule
  }

  return {
    getState: snapshot,
    setEnabled(enabled) {
      persist({ enabled })
      if (enabled && schedule) void schedule.checkIfDue()
      return snapshot()
    },
    async checkNow() {
      if (inFlight) return { state: snapshot(), outcome: 'in_progress' }
      if (!manualLimiter.consume(now(), MANUAL_CHECKS_PER_MINUTE).allowed) return { state: snapshot(), outcome: 'rate_limited' }
      await runCheck()
      return { state: snapshot(), outcome: 'done' }
    },
    async openRelease() {
      const value = stored()
      const known = knownUpdate(value)
      if (!known) return false
      try {
        await deps.openExternal(known.url)
        return true
      } catch {
        return false
      }
    },
    initializeAutoCheck() {
      if (timer) return
      const current = ensureSchedule()
      void current.checkIfDue()
      timer = setInterval(() => { void current.checkIfDue() }, deps.wakeIntervalMs ?? 60 * 60 * 1_000)
      timer.unref?.()
    },
    dispose() {
      if (timer) clearInterval(timer)
      timer = null
    },
  }
}
