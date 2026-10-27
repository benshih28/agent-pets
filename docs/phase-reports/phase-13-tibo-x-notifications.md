# Phase 13 — Tibo public-page notifications

## Scope

This phase extends the standalone `update-radar/` proof of concept with local, credential-free tracking for Tibo (`@thsottiaux`). It deliberately does not integrate the source into Agent Pets Electron, preload/IPC, native notification policy, settings, packaging, or version metadata.

The source reads the fixed public profile page at `https://x.com/thsottiaux`, parses the rendered Posts timeline, and keeps only posts whose timestamp falls on the device's current local calendar day. It then inspects up to five current-day conversation pages and retains replies only when both the author and replied-to account are `thsottiaux`. It does not use the X API, an X login, a Developer App, cookies, or a bearer token. OpenAI and Anthropic retain their hourly schedule; Tibo uses an independent ten-minute schedule. The standalone browser can issue desktop notifications while its page remains open.

## Acceptance criteria

- Current-day root posts and Tibo-to-Tibo self-replies enter the feed; replies by other accounts, Tibo replies to other accounts, reposts, future timestamps, and prior-day entries are excluded.
- X access requires no account, credential, central service, or X API quota.
- Tibo checks every ten minutes with bounded one-minute jitter and 2/5/10-minute retry delays; the five official changelog sources remain hourly.
- Partial refreshes preserve the other source group, serialize feed writes, and remove prior-day Tibo cache entries after the local day changes.
- Enabling notifications immediately reports any current-day posts, then only unseen post IDs, with a 100-ID local history and grouped notification fan-out above three posts.
- The dashboard supports Tibo provider filtering, safe status links, and explicit notification permission.
- A root post and its self-replies render in one chronological conversation card. Text labels, marker shape, connector lines, and reply surface treatment distinguish post kinds without relying on color alone.

## Trust boundaries and security review

- Credentials: none are accepted or stored for X. The implementation sends no authorization header and does not read browser cookies.
- Network: the collector allowlist accepts only `https://x.com/thsottiaux` and numeric `https://x.com/thsottiaux/status/<id>` paths, with no query, fragment, credentials, or alternate host. Tibo requests accept no redirects, so a login-wall redirect fails closed. Conversation inspection is capped at five status pages per collection.
- Remote content: the public HTML and embedded streamed JSON are untrusted and bounded to 2 MiB with a 15-second timeout. Post IDs, author and reply-target screen names, 13-digit timestamps, local-day membership, five-minute future skew, instruction/entry counts, and required markup are validated. Unexpected profile or conversation markup fails closed rather than guessing a relationship.
- Rendering: remote text goes through bounded normalization and is inserted with `textContent`; remote HTML is never rendered. Status links must match the exact browser-side `x.com/thsottiaux/status/` allowlist.
- Scheduling/filesystem: source-specific freshness prevents Tibo refreshes from masking stale official sources. Both schedulers share a serialized collector queue and atomic same-directory feed replacement. Same-day stale Tibo data may be retained on a transient failure, but prior-day entries are discarded.
- Notifications: bodies contain only bounded public post text. Notification state is local to the browser origin and bounded to 100 validated IDs.

## Validation evidence

- Standalone tests: `pnpm test` passed 29/29. Coverage includes local-timezone day boundaries, prior-day removal, future timestamp rejection, repeated marker deduplication, changed markup, exact public URLs and no authorization, redirect refusal, author/reply-target relationship filtering, exclusion of other-account replies, graceful detail-page failure, chronological thread grouping, orphan/non-Tibo group isolation, partial-feed preservation, source-specific freshness, the ten-minute scheduling policy, and bounded source responses.
- Live collection: `pnpm collect` completed with all six sources healthy, no stale/error/disabled source, and a bounded 160-item feed. Tibo returned two current-day roots and two verified self-replies. The self-replies were `Lands tomorrow before 10am PST.` (`2113162413008884099`, replying to `2113162277688070445`) and `Fully included in the Pro plan, doesn't draw on your weekly usage.` (`2113029854417600834`, replying to `2113029655095836957`).
- Public-page parser check: a captured anonymous profile response parsed `Dot, Dotter, Dottest` as `2026-10-22` in `Asia/Taipei` and excluded older posts.
- Browser behavior: `pnpm start -- --port 4318` reported the hourly official schedule and approximately ten-minute Tibo schedule. The dashboard rendered two current-day roots plus two verified self-replies, six healthy source rows, and the notification control. Selecting `Tibo / X` produced two conversation cards with two items each, ordered root then reply, and the expected four `原始貼文`／`串內回覆` labels. At the desktop viewport, document client and scroll widths were both 826px. At the 390px test viewport, client and scroll widths were both 375px and each thread card remained within the 355px content width. The browser console reported no warning or error.
- Visual/accessibility review: conversation content remains on an opaque content-layer card; no nested backdrop blur was added. Root/reply state uses wording and marker shape in addition to color. Existing focus-visible, reduced-motion, reduced-transparency, high-contrast, and dark-scheme rules remain active; light mode was visually inspected at desktop and 390px widths. Dark/high-contrast visual emulation was not available in the in-app browser and remains a manual verification item before packaging.
- Notification logic: review confirmed that notification permission is requested only by a user gesture, current-day entries are not marked seen before permission is granted, the first granted pass notifies current entries, and subsequent passes deduplicate them. Operating-system delivery was not triggered during automated validation to avoid changing the user's notification permission.
- Root regression: `pnpm test:unit` passed 118/118; `pnpm exec vue-tsc --noEmit` passed; and `pnpm exec vite build` passed for renderer, Electron main, and preload.
- Dependency audit: this phase adds no package or runtime dependency. The standalone package has no lockfile or external dependency, so pnpm reports `ERR_PNPM_AUDIT_NO_LOCKFILE`; the root production audit made no progress for 60 seconds and was stopped without a result. Existing dependency risk is unchanged by this phase.
- Repository safety: targeted credential-pattern scans returned no secret candidate after documentation was updated; source/test syntax checks and `git diff --check` passed. The branch remains `feature/agent-updates-radar` at `a4faa6c`, Agent Pets remains `1.2.2`, and `.claude/` was not modified.

## Residual risks

- This is best-effort parsing of anonymous public profile and conversation pages, not an X-supported API contract. X can change markup, embedded JSON, anonymous visibility, rate controls, or conversation ranking without notice.
- The profile page exposes only a bounded recent window. The ten-minute interval makes missed same-day posts unlikely at Tibo's observed cadence, but cannot guarantee capture if posts are deleted quickly or anonymous access is temporarily unavailable.
- Quote posts authored by Tibo may appear in the Posts timeline. A self-reply must appear in the bounded anonymous conversation response to be detected; deeply ranked or omitted replies can still be missed.
- Browser notifications work only while the standalone page and `pnpm start` process remain active. A future Agent Pets integration should use the existing native notification policy and packaged lifecycle.
- Repeated anonymous requests from many independently installed desktops shift load to X rather than a central service. A collection performs one profile request plus up to five conversation requests. Ten minutes plus jitter is the current compromise; it should not be shortened without re-evaluating reliability and responsible request volume.

## Version recommendation

Do not change Agent Pets `1.2.2` in this phase. This remains an isolated standalone extension. Re-evaluate a minor increment only if the feed, schedule, and notification boundaries are integrated into the Electron application, and only after explicit user confirmation.
