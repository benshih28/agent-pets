# Agent Pets project map

## Runtime and tooling

- Stack: Electron 43, Vue 3, Pinia, TypeScript, Vite, electron-builder.
- Package manager: `pnpm@12.8.1`; authoritative lockfile: `pnpm-lock.yaml`.
- Current baseline when this reference was written: `0.5.7`. Always re-read `package.json` because this value will change.
- Renderer entry: `src/main.ts` and `src/App.vue`.
- Electron composition root: `electron/main.ts`.
- Main-process runtime: `electron/main/runtime.ts` owns window, plugin-host, desktop, event, and store lifecycle helpers; `electron/main/state.ts` owns the shared main-process service/window state. Keep `main.ts` as the composition root that creates services/windows, wires events, and invokes IPC registrars.
- IPC composition: `electron/ipc/channels.ts` is the channel source of truth; `electron/ipc/trusted.ts` provides the shared sender guard wrapper. Focused registrars currently live in `electron/ipc/{adapters,desktop,history,integrations,permission,pet-assets,pet-motion,pets,plugin-catalog,plugin-feed,plugin-install,plugin-panel-ui,plugin-preferences,plugin-settings,progression,project-mcp,project-pets,quota,window-controls}.ts`; each receives its stores, windows, dialogs, and side effects through a dependency object.
- Preload boundary: `electron/preload.ts`; matching global types: `src/env.d.ts`.
- Event ingress: `electron/event-server.ts`, loopback port `17373`, token header `x-agent-pets-token`.
- Generic event allowlist projection: `electron/event-normalizer.ts`; capability contract: `src/types/capabilities.ts`.
- Permission Control: `electron/permission-broker.ts` owns state/TTL/anti-replay; `electron/permission-adapter-server.ts` is the token-authenticated OpenCode relay on loopback port `17374`; `electron/permission-audit.ts` persists bounded redacted terminal records; shared view/decision types are in `src/types/permission.ts`.
- Progression: `electron/progression.ts` owns the main-process SQLite migration, XP ledger, idempotency, observed active-time and streak projection; pure level/evolution policy and sanitized snapshots live in `src/types/progression.ts`.
- Phase 2 threat model: `docs/security/phase-2-permission-broker-threat-model.md`.
- Hook installation and repair: `electron/setup.ts` and `integrations/`.
- Quota adapters: `electron/quota.ts`.
- Desktop preferences: `electron/desktop-preferences.ts`; canonical shared types: `src/types/desktop.ts`.
- Tray and native notification runtime: `electron/desktop-tray.ts`, `electron/desktop-notifications.ts`, and `electron/notification-policy.ts`.
- Realtime state and current local persistence: `src/stores/agentStore.ts`.
- Pet surface: `src/components/DesktopPet.vue` and `src/components/PetAnimation.vue`.
- Panel/settings surface: `src/components/StatusPanel.vue`, `src/components/SetupWizard.vue`, and the independent `src/components/ProjectMcpPanel.vue`.
- Shared UI primitives (Button, Card, ToggleRow, Select, ProgressTrack, ConfirmDialog, Icon): `src/components/ui/`; design tokens (colour/spacing/radius/font/motion, no bare hex or rgba() elsewhere): `src/styles/tokens.css`. See [ui-design-system.md](ui-design-system.md) before adding or editing any panel UI.
- Shared Traditional Chinese copy: `src/i18n.ts`; renderer and Electron native surfaces should use this layer for user-visible text while preserving canonical technical terms.
- Window mode geometry: `electron/pet-window-mode.ts`; shared mode snapshot types: `src/types/pet-window.ts`.
- Agent Adapter SDK: `electron/agent-adapter.ts` owns the runtime registry and canonical ingress selection; `electron/agent-adapter-operations.ts` wraps existing platform installers/detection; shared capability/status contracts live in `src/types/agent-adapter.ts`.
- Canonical current event types: `src/types/agent.ts`.
- Plugin Host: `electron/plugin-manifest.ts` validates the public contract; `electron/plugin-registry.ts` safely plans and installs bounded archives; `electron/plugin-broker.ts` validates Worker RPC; focused controllers in `electron/plugin-{feed,command,badge,tray,skin,preferences,net,secrets,settings,schedule,panel-view}.ts` own individual capabilities. `electron/plugin-protocol.ts` and plugin preloads constrain resource access and renderer APIs; public contracts and examples live in `docs/plugins/`.

## Existing security controls to preserve

- Chromium sandbox and context isolation enabled; Node integration disabled.
- Plugins are untrusted. Worker Web APIs are reduced, RPC identity is host-owned, manifests and archive paths are validated, plugin storage is scoped, and permission/contribution changes require user review.
- Plugin network requests require declared or user-approved HTTPS hosts; DNS/IP and each redirect are rechecked. Plugin requests do not send or retain cookies.
- Custom panel pages use a separate sandboxed WebContentsView and non-persistent partition, with same-plugin resources only and no secrets or host-request capability in the page bridge.
- Plugin secrets use Electron safeStorage; secret settings are never echoed in snapshots, and no secret value is written to logs or diagnostics.
- Custom secure `agent-pets://` protocol used instead of privileged renderer file access.
- External navigation, popups, permission requests, and untrusted IPC senders are rejected.
- Event server limits body size, text length, rate, sources, and states, and requires a local token.
- Imported pet archives and raster files have size, count, path, and signature constraints.
- electron-builder fuses disable run-as-node, Node options, CLI inspection, and extra file privileges.

## Current product behavior

- Mood is renderer-local and resets by local date/version.
- XP progression is main-owned and durable in `progression.sqlite`; the current selected pet is synchronized through typed IPC, while mood remains short-term and renderer-local. Generic events and MCP presentation intents never award XP.
- Pet selection, scale, multi-pet, reactions, bubbles, hidden pets, and family mappings use `localStorage`.
- DND, notifications, permission-bubble visibility, sound, launch-at-startup, and the `zh-TW`／`en-US` locale are main-owned desktop preferences persisted under Electron `userData`; legacy sound is migrated once from renderer storage. Hiding the permission bubble never changes Broker state or the Tray attention badge.
- Tray is a main-process singleton. Closing the pet hides it, while a destroyed renderer can be rebuilt through the existing main process.
- Presentation MCP is a local, main-owned presentation channel: `electron/presentation-controller.ts` owns validation, TTL, rate and queue policy; `electron/presentation-mcp.ts` is the authenticated loopback endpoint; `integrations/presentation-mcp.mjs` is the stdio client bridge. It can only emit `pet_status`, `pet_react`, and `pet_say` intents and never mutates permission, XP, quota, history, or achievement truth.
- Project-local MCP setup is main-owned in `electron/project-mcp-setup.ts`; the panel opens a native folder picker and writes only Codex `.codex/config.toml`, Claude Code `.mcp.json`, and OpenCode `opencode.json`. Matching entries are idempotent, conflicting entries are left untouched, and no shell command or global MCP config is used.
- Connected project tracking is main-owned in `electron/project-mcp-registry.ts`; it stores bounded project-local paths under Electron `userData`, re-checks all three client entries when Settings opens, marks missing folders, and removes only exact Agent Pets entries. Renderer IPC exposes list, safe remove, and missing-record forget operations.
- History/HUD is main-owned in `electron/history.ts` with a separate SQLite schema for sanitized events, sessions, daily aggregates, and bounded quota snapshots. The renderer reads only a seven-day aggregate projection; export and clear are panel-only IPC operations and never reset progression.
- Local token history is main-owned in `electron/local-usage.ts`: it read-only scans bounded Codex/Claude JSONL session-log roots, parses allowlisted usage records, deduplicates streaming entries, and writes only hashed identities plus token totals into History. `HistoryStore` keeps a persisted cutoff so Clear History does not immediately repopulate older external logs.
- Main process persists window position/size through helpers in `electron/setup.ts`.
- Mini／Edge window mode is main-owned in `electron/main/runtime.ts` with pure geometry rules in `electron/pet-window-mode.ts`; the renderer receives a sanitized mode snapshot and never chooses native bounds directly. Edge Peek is a persisted, off-by-default desktop preference; when enabled it uses a 650ms dwell and a 42px-thick × 96px-long opaque handle only after the full-size window is attached to a work-area edge, restores the exact pre-edge native bounds on hover/click, and pending permission requests force Normal mode.
- Status events feed the Pinia store through the typed preload listener.
- Click-through combines renderer hit testing and Electron mouse passthrough.
- Three Agent families are supported through hooks: Codex, Claude Code, and OpenCode.
- OpenCode is currently the only respond-capable permission Adapter. Generic `/v1/events` remains observe-only; Codex and Claude show external-only waiting state until a verified response channel exists.
- All `/v1/events` payloads pass through the Agent Adapter registry before Event Core normalization. Built-in source families receive `adapterId` metadata; an explicit `adapterId: generic-http` remains observe-only and cannot elevate permission capabilities. Setup Wizard health/capability cards are runtime-driven rather than a hardcoded agent list.

## Extension guides

### Add an IPC channel

1. Add the unique key and channel string in `electron/ipc/channels.ts`.
2. Add the handler to its domain registrar in `electron/ipc/<domain>.ts`, inject its dependencies, and use `handleTrusted` for a panel or pet window sender guard.
3. Expose the operation in `electron/preload.ts` and mirror its signature in `src/env.d.ts`.
4. Add a direct registrar test under `tests/`; the generated `docs/security/ipc-inventory.md` check verifies registrations, preload APIs, sender guards, and type parity.

### Add a plugin contribution

1. Add the manifest field and validation in `electron/plugin-manifest.ts`.
2. Implement bounded behavior in the corresponding `electron/plugin-*.ts` controller, then wire the controller into the plugin host runtime.
3. Add a focused controller test and update the matching bilingual plugin API page if the public contract changes.
4. Keep renderer access behind the existing preload API and add the IPC contract test if a new channel is required.

### Add an Agent adapter

1. Implement the adapter contract in `electron/agent-adapter.ts` and provide any platform install or diagnostic operation through `electron/agent-adapter-operations.ts`.
2. Register the adapter in the central adapter registry; the Setup Wizard and ingress resolver consume that registry.
3. Add adapter contract and capability tests in `tests/agent-adapter.test.mts` and `tests/agent-adapter-operations.test.mts`.

## Working rules

- Keep unrelated `.claude/`, local MCP configs, build output, and user settings untouched.
- Before packaging, `pnpm build` and `pnpm electron:build` run `scripts/stop-agent-pets.mjs`. It identifies processes by executable path and only closes this project's unpacked/portable Agent Pets or workspace Electron process; do not terminate other Agent Pets installations or unrelated Electron processes.
- Prefer narrow feature modules over adding more policy directly to `electron/main.ts`.
- Keep `electron/preload.ts` and `src/env.d.ts` synchronized when IPC changes.
- Update both English and Traditional Chinese README sections when user-visible behavior changes.
- Traditional Chinese UI copy is required for new user-visible settings, Tray items, notifications, HUD, errors, and onboarding. Record any remaining localization gap in the phase report.
- Inspect the final diff and distinguish pre-existing warnings or failures from phase regressions.
