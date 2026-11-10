# Phase validation, security, and version gates

## Before implementation

- Record `git status --short`, current branch/commit, and `package.json` version.
- Read the active phase in the architecture roadmap and convert it to explicit acceptance criteria.
- Identify current user changes and files that must remain untouched.
- List changed trust boundaries: renderer, preload/IPC, local HTTP, filesystem, credentials, hooks, native notifications, global shortcuts, or MCP.

## Functional gate

- Run `pnpm.cmd exec vue-tsc --noEmit`.
- Run `pnpm.cmd exec vite build` for normal source changes.
- Run `pnpm.cmd build` before a release candidate or when packaging/native behavior changes.
- Add targeted automated tests when a test harness exists; if it does not, record the gap and add deterministic fixture or runtime checks appropriate to the phase.
- Validate the real requested surface: Electron window, Tray, notification, hook delivery, MCP call, packaged hook, or database migration.

## Security gate

- Run dependency audit at the lockfile level and record unavailable network checks honestly.
- Run a repository secret scan that excludes generated/dependency directories and distinguishes public OAuth client IDs from credentials.
- Review every new IPC channel for sender validation, runtime payload validation, bounded values, and least privilege.
- Review local servers for loopback-only binding, authentication, body/rate limits, method allowlists, and safe shutdown.
- Review filesystem operations for canonical paths, traversal, symlinks/reparse points, size limits, atomic writes, and permissions.
- Review notifications and UI text for prompt, path, token, tool-argument, and secret disclosure.
- For Permission Broker work, test spoofing, replay, expiry, concurrent decisions, restart, external resolution, and renderer compromise assumptions.
- For MCP work, prove the tools cannot execute commands, access files, decide permissions, or mutate progression truth.

## Visual and accessibility gate

- Follow `liquid-glass.md` and compare light/dark/high-detail backdrops.
- Check glass hierarchy, no nested glass, focus visibility, contrast, reduced motion, and opaque fallback.
- Verify transparent-region click-through and interactive-region hit testing when affected.
- Verify multi-monitor and DPI behavior when window geometry changes.

## Common gaps that trigger extra review rounds

These are recurring, concrete defect classes found in past phases (most recently Phase 8). Check each one explicitly before calling a phase done; they are cheap to check and expensive to find in review.

- **New dimension on a shared aggregate.** When a change adds a new scoping column (e.g. `project_id`) to an existing table, grep every query and every writer that touches that table — including legacy/global buckets (e.g. a shared `local-usage` pet-id row) — not just the new code path. A dimension that is written in one place and filtered in another silently drops data instead of erroring.
- **A toggle needs a real off switch, not just new UI.** If a feature changes main-process side effects (routing, XP splitting, history isolation), it needs a persisted enable/disable flag that the main process itself checks before doing the work — a renderer-only or UI-only toggle does not stop the underlying side effect.
- **Hot-path synchronous I/O.** Any function reachable from the live event/hook pipeline (per tool-call, per state change) must not add a new synchronous filesystem stat or database write without caching or throttling. Trace the call frequency before adding fs/DB calls to `main.ts`'s event handler chain.
- **Overflow in dynamic list rows.** A row that pairs a user- or agent-controlled text label with a fixed-width control (dropdown, button) will overlap or break once the label is long. Give the label `min-width: 0`, let it shrink, and truncate with `text-overflow: ellipsis` — do not assume short sample text is representative.
- **Reuse existing component props before hand-rolling markup beside them.** Grep other usages of a shared component (e.g. `ToggleRow`'s `help` prop) before adding a new instance; duplicating a prop's job with an adjacent `<p>` produces a visibly different layout from every other instance of that component.
- **One binding style per prop.** Never mix `v-model` and an explicit `@update:x` listener for the same event on one component instance — pick `v-model` when no side effect is needed, or `:model-value` + `@update:model-value` when one is.
- **No unreachable methods.** Grep for callers before finishing; a store/service method with no IPC handler or UI entry point is dead code, not a "for later" feature.

## Diff and regression gate

- For any new or changed list row, card, or dynamic label, check it against the checklist in "Common gaps that trigger extra review rounds" above, especially overflow with realistic (not just short sample) text.
- Run `git diff --check`.
- Review `git diff --stat`, `git diff --name-only`, and the complete relevant diff.
- Confirm no formatter-induced unrelated edits, generated artifacts, credentials, or user-owned files were added.
- Update both READMEs and architecture/skill references when contracts or user behavior change.
- Write `docs/phase-reports/phase-N-<slug>.md` with scope, evidence, security result, residual risk, and version recommendation.

## Confirmation and version gate

1. Finish all gates and present the phase report without changing the version.
2. Wait for explicit user confirmation.
3. After approval, select the increment:
   - Patch: contained additive feature, UI refinement, adapter fix, or documentation/process phase without a breaking public contract.
   - Minor: substantial new subsystem, persistent schema/migration, public adapter/MCP contract, control-plane/security-boundary change, or broad behavior-engine refactor.
4. Update `package.json` and `pnpm-lock.yaml` together; do not create `package-lock.json`.
5. Re-run type-check, build, diff, and relevant security checks after the version update.
6. Do not tag, publish, or create a release unless explicitly requested.

Suggested roadmap classification, subject to the actual diff and user confirmation:

| Stage | Default recommendation |
|---|---|
| Phase 0 skill/docs/process baseline | Patch |
| Phase 1 Tray/Notification/DND | Patch |
| Phase 2 Permission Broker | Minor |
| Phase 3 XP/persistent progression | Minor |
| Phase 4 Mini/Edge | Patch |
| Phase 5 Agent Adapter SDK | Minor |
| Phase 6 Presentation MCP | Minor |
| Phase 7 History/HUD | Patch or Minor if it introduces the first durable event schema |
| Phase 8 Per-project Pet | Patch |
| Phase 9 Achievements | Patch |
| Phase 10 Shimeji engine | Minor |

## Design gates (DS-19)

- `pnpm check:contrast` must pass (token foreground/background pairs, light and dark themes).
- `pnpm check:design` reports undefined `var(--x)`, bare hex/rgba, sub-11px font sizes, literal `blur()`, margin/padding/gap px equal to a `--space-*` value (`literal-spacing`), literal `transition` durations (`literal-transition`), literal `cubic-bezier()` (`literal-easing`), text-glyph icons and untranslated template text. CI runs `pnpm check:design:strict` (`--strict --raw-colors=fail`), which fails on any finding.
- `raw-color` (`node scripts/check-design-tokens.mjs --raw-colors` lists them) is any literal colour in `src/**` outside the theme palette source `--builtin-organic-*` in `tokens.css`. The count is 0 and `check:design:strict` fails on a new one: add a palette entry or derive the value from the semantic layer (`--color-*`) instead.
- Report-only counts (never fail `--strict`; `--verbose` lists them): `unused` (tokens promised to plugin pages in `docs/plugins/ux-guidelines.md` count as used), `rawControls` (a raw `<button|select|input>` outside `ui/` without a `<!-- raw-control: reason -->` comment on the line above), `rawSpacing` (off-scale or negative spacing px) and `rawMotion` (one-off keyframe animation durations). Keep `unused` and `rawControls` at 0.
