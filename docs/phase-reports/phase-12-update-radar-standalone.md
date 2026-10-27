# Phase 12 — Standalone AI Update Radar

## Scope

This phase creates an isolated proof of concept under `update-radar/`. It does not modify Agent Pets renderer, Electron main/preload, Event Core, MCP, permission, XP, notification, packaging, or version metadata.

The standalone program fetches allowlisted official OpenAI and Anthropic Markdown or GitHub release JSON, normalizes entries into `schemaVersion: 1`, writes an atomic local JSON feed, and exposes a read-only loopback dashboard. Its normal `pnpm start` mode now keeps the feed current with an in-process scheduler while the standalone process is running.

## Acceptance criteria

- Collect at least one current entry from OpenAI API, Anthropic Platform, and Claude Code official sources when those sources are reachable.
- A failed source does not discard cached entries from that source.
- The feed has deterministic IDs, bounded text, official source links, categories, change types, dates, and source health.
- The dashboard filters by provider, category, change type, and text without rendering remote HTML.
- Official-update cards expose deterministic change, scope, and attention cues before the source headline, while longer official text remains available through a native keyboard-accessible disclosure.
- No API key, account login, Electron API, Agent Pets state, or third-party runtime dependency is required.
- The server binds only to loopback, allows only GET/HEAD, and serves only fixed routes.
- `pnpm start` refreshes missing, expired (one hour), or degraded feeds on startup, prevents overlapping collection, applies ±5-minute jitter to healthy refreshes, and retries degraded collection after 15/30/60 minutes.
- `pnpm serve` remains display-only, and the dashboard reloads the local feed every minute without exposing a write-capable HTTP route.

## Trust boundaries and security review

- Network: exact official HTTPS hosts and bounded path prefixes; manual redirect validation; three-redirect limit; 15-second timeout; 2 MiB response limit.
- Remote content: treated as untrusted text, normalized and length bounded; browser rendering uses `textContent`; external URLs are allowlisted again in the browser.
- Local HTTP: `127.0.0.1` only, fixed route table, GET/HEAD only, CSP and clickjacking/content-type protections.
- Scheduler: in-process only, single-flight collection, bounded one-hour cadence and retry delays, no OS task registration, daemon installation, IPC, or new HTTP mutation endpoint.
- Filesystem: fixed feed path, 5 MiB read limit, same-directory temporary file plus atomic rename, restrictive creation mode where supported.
- Credentials: no credentials are accepted, stored, logged, or transmitted.

## Validation evidence

- Latest combined standalone unit/security tests: `pnpm test` passed 32/32 tests. Coverage includes dated Markdown, GitHub releases, deterministic classification, malformed JSON, stale-cache fallback, source URL allowlisting, redirect revalidation, response-size rejection, read-only fixed server routing, freshness decisions, jitter bounds, progressive retry, overlapping-refresh suppression, Tibo thread grouping, and deterministic quick-read cues for migration, compatibility, cost, limits, and security/compliance.
- Live official-source collection: `pnpm collect` fetched all 5 sources successfully and produced 160 normalized entries. No API key was used. The generated feed is ignored by Git.
- Browser runtime: the loopback server returned health `200`, rejected POST with `405`, rejected an unlisted path with `404`, and returned the configured CSP/security headers.
- Browser visual/function check: the real dashboard rendered 160 cards and 5 source-health rows. Provider filtering returned 62 OpenAI items, developer-tool filtering returned 60 items after the classification refinement, and searching `prompt caching` returned 4 items. The checked 1265px viewport had equal client and scroll widths, so no horizontal overflow was present. The page was also checked for keyboard-labelled native controls, visible focus state, reduced motion/transparency rules, and a stable non-glass content list.
- Quick-read UI check: the current 160-entry feed rendered every OpenAI card with three cues. Sample live cards correctly showed `新增 / API · 產品功能 / 未標示必要動作` and `新增 / API · API 變更 / 檢查成本`. The native disclosure expanded and exposed the complete normalized source text. At the 390px test viewport, document client and scroll widths were both 375px, the first card stayed within the 355px content width, and the three-column cue changed to one column without overflow. The browser console reported no warning or error.
- Scheduler runtime: `pnpm start -- --port 4318` bound successfully on loopback, recognized the healthy 27-minute-old feed without collecting again, scheduled the next refresh about 30 minutes later, and continued serving `/healthz` plus the unchanged 160-entry feed. The real browser dashboard rendered that feed successfully.
- Root Agent Pets regression: `pnpm exec vue-tsc --noEmit` passed; `pnpm exec vite build` passed for renderer/main/preload; `pnpm test:unit` passed 118/118 after rerunning outside the restricted sandbox because seven existing loopback tests initially received sandbox `EPERM`.
- Secret scan: the repository scan excluding generated/dependency/`.claude/` directories returned no credential-pattern candidates.
- Dependency audit: `pnpm audit --prod --audit-level high` and JSON mode were attempted with registry/network permission, but both produced no output and did not complete; JSON mode was stopped after more than 60 seconds. No dependency or lockfile changes were made by this phase.
- Diff review: `git diff --check` passed for tracked content; untracked phase files were separately checked for syntax/trailing whitespace. Agent Pets source, package metadata, lockfile, `.claude/`, build configuration, and generated feed were not added or modified.

## Residual risks

- Official Markdown structure can change; zero parsed entries fail closed as `source_format_changed` and preserve the previous cache.
- Rule-based quick-read cues remain in the source language context and are not AI summaries or semantic comparisons. Explicit keyword signals can be conservative or broad, so users must verify consequential changes against the expandable official text.
- The standalone dashboard has not yet been integrated into Electron or tested as a packaged Windows/macOS surface.
- Automatic collection runs only while `pnpm start` remains active. It does not install an OS task or update while the process or computer is off.

## Version recommendation

Do not change Agent Pets `1.2.2`. The standalone package remains private and intentionally has no version field. If this subsystem is later integrated into Agent Pets with persistent state and a new network/UI boundary, evaluate a minor increment only after the integration phase passes its own gates and receives explicit user confirmation.
