# Agent Pets

Desktop pet that shows real-time status of your AI coding agents.

**English** | [繁體中文](README.zh-TW.md)

---

## Features

- **Real-time status** — See at a glance which agent is running, thinking, or idle.
- **Draggable pet** — Drag the pet anywhere on your screen (position is remembered across restarts).
- **Multi-agent support** — OpenCode, Codex, Claude Code (CLI & Desktop).
- **Custom pets** — Import your own spritesheet, or a `.codex-pet.zip` sprite kit from sites like [codex-pets.net](https://codex-pets.net).
- **Desktop controls** — Tray menu, native waiting/completion notifications, Do Not Disturb, sound control, and optional launch at startup.
- **Mini / Edge mode** — Mini is always opt-in; Edge Peek is a separate Settings/Tray toggle (off by default) that shows a dedicated Liquid Glass handle at the display edge instead of clipping the pet. Bounds are restored across display and DPI changes.
- **Optional Shimeji behavior** — A separate Settings toggle enables low-cadence idle walking, sleep, and cursor reactions. It is off by default and pauses for active work, Permission, DND, reduced motion, background, or power saving; walking is clamped to the current display work area.
- **Desktop visibility controls** — Optionally exclude the pet window from supported capture APIs, hide it while another app owns a macOS fullscreen Space or a supported Windows borderless fullscreen display, or enable right-click hide. Capture protection covers the pet only; macOS capture exclusion is best effort, and Windows detection is conservative and disabled if its native runtime is unavailable.
- **Permission Control** — OpenCode permission requests can be allowed once or denied from a Liquid Glass pet bubble; scoped hotkeys are available only while an eligible request is visible.
- **Pet progression** — Completed sessions, bounded observed active-time, first completions of the day, and consecutive-day streaks earn durable XP. Level and evolution are restored after restart from a main-process SQLite ledger.
- **Achievement gallery** — The Growth chip shows ten pet-scoped long-term milestones. Unlocks are evaluated and persisted once in the main process, with a one-shot native notification and visual reward; token milestones show exact versus estimated quality. The Growth toggle can stop new unlocks without affecting XP, permissions, or event ingestion.
- **Presentation MCP** — A local, presentation-only MCP bridge exposes `pet_status`, `pet_react`, and `pet_say`. It never runs commands, opens files, approves permissions, or changes XP.

---

## Supported Agents

| Agent | CLI | Desktop |
|-------|-----|---------|
| OpenCode | ✅ | ✅ |
| Codex | ✅ | ✅ |
| Claude Code | ✅ | ✅ |

The **Generic HTTP** adapter is available to local integrations through the authenticated `/v1/events` endpoint. It is observe-only and has no permission-response capability.

---

## Quick Start

### Install (Windows)

Download and run `Agent Pets.exe` from the [Releases](https://github.com/Ponpon55837/agent-pets/releases) page. No installation needed — it's a portable app.

### Install (macOS)

Download `AgentPets-<version>-arm64.dmg` (Apple Silicon) or `AgentPets-<version>-x64.dmg` (Intel) from the [Releases](https://github.com/Ponpon55837/agent-pets/releases) page, open it, and drag the app to your Applications folder.

### First Run

1. Launch Agent Pets. A small pet will appear on your screen.
2. Click the pet, then **⚙ → Setup Wizard**. It will detect which AI tools are installed on your machine.
3. Click **Install** next to a tool (or **Install All**) to wire up its hooks — the wizard does not do this automatically, you need to click.
4. Once hooks are installed, restart your coding tools; the pet's appearance will then change to reflect your agents' status.

---

## Usage

### Interacting with the Pet

| Action | Effect |
|--------|--------|
| **Left-click** the pet | Open the control panel (opens as its own window, next to the pet — the pet itself never moves) |
| **Drag** the pet | Move it to a new position (remembered across restarts) |
| **Right-click** | Hide the pet when enabled in Settings (permission controls remain interactive) |

The system Tray menu can show or hide the pets, open the panel or Settings, toggle Mini / Edge Peek mode, Do Not Disturb, sound and notifications, configure launch at startup in packaged builds, run commands from enabled plugins under **Plugins**, mark pending attention on the Tray icon, and quit the app. Closing or hiding the pet window keeps hooks and background status running until **Quit** is selected.

Below the pet, a floating status bar shows up to **3 lines**, one per active tool family (Codex / Claude / OpenCode). CLI and Desktop variants of the same tool are grouped onto a single line (e.g. `Claude (CLI+Desktop) · Thinking`). When nothing is active, a single line shows the pet's overall idle/offline state.

### Control Panel

Click the pet to open the control panel — a separate always-on-top window. It has two views. The main view contains **Sessions** and **Usage** tabs:

#### Sessions View (default)

Shows all sessions (including recently gone-offline ones) with their current status:

- **Idle** — Agent is waiting for input
- **Thinking** — Agent is processing
- **Tool Running** — Agent is executing a tool
- **Waiting Permission** — Agent is waiting for approval
- **Success** — Task completed successfully
- **Error** — An error occurred
- **Offline** — Session ended or went stale

Live states (Thinking / Tool Running / Waiting) show an elapsed-time readout next to the status. If any sessions are offline, a **Clear offline** button appears below the list to remove them from view.

#### Usage Tab

Shows the remaining subscription quota reported by Codex and Claude Code, including session/weekly windows, countdowns, and reset dates in the user's local time. While either family is active, a 3px quota meter is embedded inside its existing pet status pill without changing the window height; it prefers the short session window and falls back to weekly when that is the only quota returned. Hover the pill for the percentage and full reset time. **Agent Pets has no account system and never asks for an agent username, password, or token.** It reuses the local subscription session already created by Codex CLI or Claude Code, requests the provider's quota endpoint from the Electron main process, and only sends normalized percentages to the UI. If that CLI session is missing or expired, re-authentication happens in the original CLI—not in Agent Pets. Results are cached for one minute; the compact meter refreshes every five minutes while relevant agents are active, and **Refresh** requests a fresh reading for both windows. API-key-only Codex sessions do not expose subscription quota.

Click the **⚙** icon in the header to switch to Settings.

#### Settings View

#### Language and copy

The desktop UI and native prompts support Traditional Chinese and English across Settings, notifications, Tray, Setup Wizard, permission prompts, and errors. Choose **Language** in Settings; the selection is saved locally and synchronized across the pet, panel, Tray, and native notifications. Canonical technical terms such as `Running`, `Thinking`, `Permission`, `Idle`, `Allow once`, `Deny`, agent names, MCP tool names, and token terminology remain unchanged for API and status consistency.

The panel uses an extensible section navigator: **Language**, **Appearance**, **Desktop**, **Pets**, **Growth**, and **Advanced**.

**Appearance section**

- **Size** — S / M / L / XL / XXL to scale the pet.
- **Bounce & shake** — Click/state-change bounce, idle fidget sway, and waiting-permission shake. **Off by default.**
- **Status bubble** — Ordinary success/error toasts close after about 3 seconds and show the remaining time; permission prompts never auto-dismiss. **Off by default.**

**Desktop section**

- **Mini mode** — Shrinks the pet to a compact 96px surface and can be turned off at any time.
- **Edge peek** — A separate, **off-by-default** preference. When enabled, dragging to a display edge and holding for about 650ms shows a dedicated 42px-thick × 96px-long Liquid Glass handle; click or hover expands back to Normal without leaving a clipped pet fragment. Pending permission requests always restore the normal interactive surface.
- **Shimeji behavior** — Enable it under **Settings → Desktop → Desktop behavior** when you want autonomous idle movement. The scheduler uses one low-frequency timer for the whole pet window, falls back to Idle when a sprite manifest lacks Walk/Sleep rows, and never moves Mini/Edge or crosses a monitor boundary.
- **Capture exclusion** — Excludes the pet window from supported screenshots and recordings when enabled. Windows uses the system capture-exclusion API; macOS uses a limited native sharing policy that newer capture tools may ignore. The control panel is not excluded.
- **Fullscreen auto-hide** — On macOS, the pet and panel use native Spaces policy to stay out of another app's fullscreen Space. On Windows, a native Win32 event detector hides each Agent Pets window only when a different process owns a visible, top-level, borderless window covering its complete monitor; ordinary maximized windows are ignored. The capability fails closed when the native runtime is unavailable, and this is not video-content recognition.
- **Right-click hide** — Enable this to hide the pet by right-clicking its sprite or the Edge Peek handle. Permission cards, status lines, toasts, and other interactive controls are exempt; the app and its hooks continue running.
- **Do Not Disturb** — Suppresses native notifications, pet sounds, extra motion, and nonessential bubbles without stopping event ingestion. **Off by default.**
- **Notifications** — Native alerts for waiting-permission, waiting-input, completion, and errors. Repeats use a per-session cooldown and terminal events are batched. **On by default.**
- **Sound** — Short synthesized cues (Web Audio, no audio files) for success/error/waiting-permission. **Off by default.**
- **Launch at startup** — Start Agent Pets when you sign in. This toggle is available in packaged builds.
- **Permission Bubble** — An independent switch for the Liquid Glass Allow once / Deny card. Turning it off hides only the card; pending requests remain with the Broker, stay on the Tray badge, and can still be resolved by the Agent or terminal. **On by default.**
- **Presentation MCP** — Allow or disable the local MCP presentation channel. When enabled, clients can send bounded reactions or plain-text speech; Do Not Disturb and waiting/error/permission states take precedence. **On by default.**

**Advanced section**
- **Setup Wizard** — Re-run tool detection, or install/reinstall hooks.
- **Restart Pet** — Fully relaunch Agent Pets if the pet or its animation gets stuck.
- **Quit** — Exit Agent Pets.

**Growth tab**

- **Mood** — Starts each day at a low baseline of 10. A successful task gives +4 and an error gives -6. Long tasks also earn +1 for every 2 completed tools (up to +8 per task) and +1 for every 5 minutes of work (up to +4 per task), so progress rewards are capped at +12 before the completion bonus. As mood grows, an animated energy layer built from the current pet frame intensifies around the pet's own silhouette, reaching overdrive at 90+. Click **Reset** to return to 10; it never grants extra mood.
- **Mood visuals** — Turn off mood's aura, color, and energy-layer presentation without stopping mood tracking; re-enable it at any time.
- **XP / Level** — The Growth chip shows the selected pet's durable XP, level, evolution stage, and current streak. XP uses a versioned, idempotent ledger: a canonical session completion is +20 XP, the first completion of a local day is +10, each observed 30 minutes of active coding is +2 (capped at +10 per session), and continuing yesterday's streak is +5. Failed or cancelled work grants no permanent XP; token milestones wait for an exact token event contract.
- **Achievements** — The same Growth chip includes ten milestones (first completion, session/active-day thresholds, Night Owl, adapter breadth, streak, levels, and token usage). Unlocks live in a separate `achievements.sqlite`, are scoped per pet and registry version, and are idempotent across event replay and restart. While achievements are enabled, verified unique completed sessions retained by History are reconciled into the achievement ledger at startup and when tracking is re-enabled; replaying the reconciliation never duplicates an unlock or notification. Turning off **Enable achievements** stops new unlocks and reconciliation only; it does not erase existing achievements or XP.

**Pets tab**

- **Pet** — Choose which pet to display. Click a pet name to select it.
- **+ Import Sprite** — Import a custom spritesheet (`.webp`/`.png`/`.jpg`, 8 columns × 11 rows).
- **+ Import .zip** — Import a `.codex-pet.zip` sprite kit (e.g. downloaded from codex-pets.net) in one click — no manual unzip needed.
- **Multi-pet** — Show one small pet per active tool family instead of collapsing to the single highest-priority one, when 2+ are running at once. **Off by default.** Per-agent pet choices appear here when enabled.

Click **‹** to return to the Sessions view.

### Presentation MCP

Presentation MCP is a local stdio bridge for agents that support MCP. The app creates the bridge script and a separate local token after startup:

```text
Windows: %USERPROFILE%\\.desktop-pet\\presentation-mcp.mjs
macOS/Linux: ~/.desktop-pet/presentation-mcp.mjs
```

Configure an MCP client to launch that script with the real Node.js executable. The bridge exposes only `pet_status` (read-only sanitized status), `pet_react` (five bounded reactions), and `pet_say` (up to 240 characters of plain text for 1–15 seconds). Each client is limited to 3 requests per 10 seconds; the queue is bounded, intents expire automatically, and disconnecting the client removes its pending intents. Permission, error, waiting, and Do Not Disturb state always take precedence. This channel cannot control tools, files, permissions, XP, quota, or achievements.

#### One-click project setup

In **Settings → Advanced**, click **Setup MCP for a project**. Choose the local project folder in the native folder picker; Agent Pets then installs the same presentation bridge for all three supported project clients:

- Codex: `.codex/config.toml` (`mcp_servers.agent-pets`)
- Claude Code: `.mcp.json` (`mcpServers.agent-pets`)
- OpenCode: `opencode.json` (`mcp.servers.agent-pets`)

The operation is idempotent. Existing matching entries are reported as already configured; a different entry with the same server name is reported as a conflict and is never overwritten. The setup writes only project-local configuration and does not run a shell command or reinstall hooks. Restart the affected agent client after setup so it reloads its MCP catalog.

The button opens a dedicated MCP panel, separate from the Setup Wizard and the growing Settings page. The panel keeps every project configured through this button, re-checks all three client entries, and shows `Connected`, `Partial`, `Conflict`, or `Folder missing`, together with the project path and last check. **Refresh** re-checks the list. **Remove MCP** removes only matching Agent Pets entries; if a user changed an entry, it is preserved and marked as a conflict. A missing project folder can be removed from the local list without touching any files. **Done** returns to Settings.

### History HUD

The **History** tab in the main panel reads a local, main-process-owned aggregate projection: seven daily buckets, unique completed/failed sessions, observed active time, Agent distribution, the latest quota snapshot, and exact-versus-estimated token quality. Repeated success events for the same pet/source/session/project identity count as one completed session, matching the achievement ledger. The History reader also scans only the fixed local session-log roots `%USERPROFILE%\.codex\sessions`, `%USERPROFILE%\.claude\projects`, and `%USERPROFILE%\.claude\transcripts` from the main process. Codex `token_count` records use the cumulative `total_token_usage` counter and import only the monotonic delta; repeated context/rate-limit snapshots and records without a cumulative counter are ignored. Claude assistant `usage` records are parsed as exact usage; cache fields are folded into input and reasoning is used only when output is absent. The reader is read-only, bounded by file/line limits, skips links outside those roots, deduplicates streaming records, and stores only hashed session/file identities. Prompts, tool arguments, credentials, and full project paths are not persisted in the HUD data. **Export summary** writes the sanitized projection to a user-selected JSON file. **Clear history** clears history and quota snapshots only, establishes a new local-log cutoff, and never resets pet XP, level, evolution, mood, or achievements. Raw events use a bounded retention window while daily aggregates remain available for long-term progression views.

The **Project filter** above History limits the seven-day view to one project, and token usage now attributes correctly to the detected project (via the working directory in local Claude Code/Codex logs) instead of only showing the global total. Project bindings are managed under **Settings → Pets → Project pets**: a toggle at the top of the card disables project routing entirely (every session falls back to the selected pet, without deleting recorded projects or bindings); choose **Add project** to select a local folder, then choose its pet; selecting **Use selected pet** removes the binding; each project row has a remove button to drop it from the list (it is re-added automatically the next time an event arrives from that project). Unbound projects preserve the previous behavior. If a bound custom pet is removed, Agent Pets falls back to the always-available default and marks the binding as missing so it can be repaired. Project identity is stored as a salted local hash; full paths are not persisted in the routing database or notifications.

#### Connect an agent project that is already in use

1. Start Agent Pets and keep **Settings → Attention → Presentation MCP** enabled (on by default). The app must remain running because the stdio bridge connects to its local loopback control server.
2. Use a real Node.js executable; never use the packaged `Agent Pets.exe` as the interpreter. In Windows PowerShell:

   ```powershell
   $bridge = Join-Path $env:USERPROFILE '.desktop-pet\presentation-mcp.mjs'
   node --version
   Test-Path $bridge
   ```

3. Register the bridge once in each agent client, then restart that client. This does not reinstall hooks.

   **Codex CLI / Codex desktop / IDE extension (shared configuration):**

   ```powershell
   codex mcp add agent-pets -- node $bridge
   codex mcp list
   ```

   **Claude Code:**

   ```powershell
   claude mcp add --scope user agent-pets -- node $bridge
   claude mcp list
   ```

   **OpenCode:** add this server under `mcp.servers` in `opencode.json` (or the project-scoped OpenCode config):

   ```json
   {
     "mcp": {
       "servers": {
         "agent-pets": {
           "type": "local",
           "command": ["node", "C:/Users/<your-user>/.desktop-pet/presentation-mcp.mjs"]
         }
       }
     }
   }
   ```

4. Fully restart the agent client and confirm that `pet_status`, `pet_react`, and `pet_say` appear in its MCP view. If hooks work but these tools do not appear, check the bridge path, Node executable, Presentation MCP toggle, and that Agent Pets is still running.

Turning Presentation MCP off rejects new presentation intents only; it does not remove hooks or affect the Permission Broker, XP, or ordinary `/v1/events`.

---

## Setup Wizard

The Setup Wizard reads the runtime Agent Adapter registry and installs hooks when you click a button — it does not install anything on its own. Each adapter reports its supported sources, capabilities, health, and diagnosis checks:

- **OpenCode CLI / Desktop** — Writes a plugin to `~/.config/opencode/plugin/` (note: singular `plugin`, matching where OpenCode itself scans) and the platform's OpenCode Desktop plugin dir
- **Codex CLI** — Creates `~/.codex/hooks.json` and enables hooks in `~/.codex/config.toml`
- **Claude Code CLI & Desktop** — Adds a `hooks` block to `~/.claude/settings.json` (CLI and Desktop share this config, so one install covers both; which one actually fired an event is resolved at runtime via Claude Code's `CLAUDE_CODE_ENTRYPOINT` env var, not by the installer)

Each adapter shows a status dot and capability chips:

- 🟢 **Green** — Installed and configured
- 🟡 **Yellow** — Detected but not (fully) configured
- 🔴 **Red** — Error or unavailable

Click **Diagnose** to inspect bounded health checks. Click **Install** next to an installable adapter to (re)install just that integration, or **Install All** to run every adapter installer idempotently. Click **Refresh** if a status seems stale.

For a configured adapter, click **Test** to send a short-lived event through the running app's authenticated local HTTP receiver. A passing result confirms HTTP 204, adapter selection, canonical mapping, and renderer receipt in this Agent Pets instance; it does not launch the coding tool or prove that tool's hook has fired on its own. Generic HTTP is always observe-only and cannot respond to permissions.

> Note: there is no separate "Codex Desktop" hook install — only Codex CLI hooks are wired up today.

## Plugins

Plugins can add pet feed notifications, reactions, panel and Tray commands, status badges, optional sandboxed panel pages, selectable pet skins, and clearly labeled observe-only status rows. Install a `.agentpet-plugin` package from **Settings → Plugins**, or open the opt-in online catalog to review signed packages and check for updates; issue reports open a prefilled link containing only the plugin ID and version. Developers can enable Developer mode to load a local folder. Review the requested permissions and contributions before installing. Plugin pages and background code are treated as untrusted: they have no Node.js, filesystem, or shell access, and network requests are limited to approved HTTPS hosts. Plugin network requests do not send or store cookies. Since 1.4.0 a plugin panel can open a declared HTTPS link in the system browser, but only right after a real click or Enter/Space and at most five times a minute. Secrets are encrypted by the app's protected storage and never returned in settings snapshots.

Background plugins share one hidden Plugin Host process, which starts only while at least one plugin is enabled. Its memory is measured against its own footprint right after loading, before any plugin runs, so Chromium's fixed overhead never counts against a plugin. The host is restarted only when that growth stays above the combined per-plugin budget (64 MB per plugin by default) on two consecutive 30-second checks. On Windows the check uses the process's private memory, because the working set also includes Chromium code pages shared with other Agent Pets processes (about 65 MB measured).

See the [plugin development index](docs/plugins/README.md) for the [10-minute guide](docs/plugins/getting-started.md), [security model](docs/plugins/security.md), [API reference](docs/plugins/api-reference.md), and [examples](docs/plugins/examples.md).

---

## Custom Pets

### Spritesheet Format

Custom pets use the same spritesheet format as built-in pets. A `pet.json` may optionally declare a bounded `behaviorManifest` with `walk` and/or `sleep` row definitions; missing definitions safely fall back to Idle:

```json
{"behaviorManifest":{"walk":{"row":1},"sleep":{"row":5}}}
```

- **Format**: `.webp`, `.png`, or `.jpg` (built-in pets ship as `.webp`; imports of any of the three are copied in as-is and rendered by content, not by file extension)
- **Grid**: 8 columns × 11 rows (only rows 0–8 are currently used; 9 and 10 are reserved for future states)
- **Cell size**: 192 × 208 pixels

Each row represents a different state:

| Row | State |
|-----|-------|
| 0 | Idle / Offline |
| 5 | Error |
| 6 | Waiting Permission / Waiting Input |
| 7 | Thinking / Tool Running |
| 8 | Success |

### How to Import

**From a single spritesheet:**

1. Open the control panel (click the pet).
2. Click **⚙** to go to Settings.
3. Click **+ Import Sprite**.
4. Select a `.webp`/`.png`/`.jpg` spritesheet file.
5. The pet is added to your collection and automatically selected.

**From a `.codex-pet.zip` sprite kit** (e.g. downloaded from [codex-pets.net](https://codex-pets.net)):

1. Open the control panel → **⚙** → Settings.
2. Click **+ Import .zip** and select the downloaded `.zip`.
3. The app reads `pet.json` + the spritesheet inside automatically — no manual unzip required.

Custom pets are stored in `~/.desktop-pet/custom/`.

### How to Rename

1. Open the control panel (click the pet).
2. Click **⚙** to go to Settings.
3. Find the custom pet in the list.
4. Click the **✎** pencil icon next to the pet name.
5. Type the new name and press **Enter** (or click elsewhere to confirm).
6. Press **Esc** to cancel.

Built-in pets cannot be renamed.

### How to Remove / Hide

Click the **×** next to any pet in the list to remove it (you'll get a confirmation prompt first) — for custom pets this deletes the imported files; for built-in pets it just hides that pet from your own list (the bundled asset itself isn't touched). The default fallback pet (`aang-airbender`) has no **×** and can't be removed or hidden, so there's always at least one pet available.

---

## Event Server

Agent Pets runs a local HTTP server on `http://127.0.0.1:17373/v1/events` that receives status updates from hooks. Requests must include the per-install `X-Agent-Pets-Token` header; the managed hooks read it from the current user's permission-restricted `~/.desktop-pet/event-token` file automatically.

### POST /v1/events

```json
{
  "source": "codex",
  "sessionId": "sess_abc123",
  "state": "thinking",
  "timestamp": 1735689600000,
  "originalEvent": "UserPromptSubmit",
  "project": "/Users/you/my-project",
  "toolName": "Edit"
}
```

`source`, `sessionId`, `state`, and `timestamp` are required — a request missing any of them gets rejected with `400`. Missing or incorrect hook authentication is rejected with `401`.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | yes | `opencode-cli`, `opencode-desktop`, `codex`, `codex-desktop`, `claude`, `claude-desktop` (`opencode` is also accepted and normalized to `opencode-cli`) |
| `sessionId` | string | yes | Unique session identifier (max 256 chars) |
| `state` | string | yes | `idle`, `thinking`, `tool-running`, `waiting-permission`, `waiting-input`, `success`, `error`, `offline` (`waiting` is also accepted and normalized to `waiting-permission`) |
| `timestamp` | number | yes | Unix ms timestamp of the originating event |
| `project` | string | no | Project path (basename shown in UI) |
| `originalEvent` | string | no | The raw hook/event name that produced this, for debugging |
| `toolName` | string | no | Tool name, shown in the activity bubble while `tool-running` |

---

## Security

- **Renderer isolation** — Renderer processes run with Chromium sandboxing, context isolation, no Node.js integration, a restrictive CSP, a secure custom `agent-pets://` protocol instead of privileged `file://` pages, blocked popups/navigation, denied permissions, and validated main-frame IPC senders.
- **Local event server** — The event server listens on `127.0.0.1` only, authenticates every hook request with a per-install secret, rejects browser-originated and non-JSON requests, rate-limits events, and accepts only bounded, whitelisted fields.
- **Quota requests** — The quota feature connects only to the exact HTTPS Codex and Anthropic quota/auth endpoints. Redirects, oversized responses, excessive window counts, and malformed renderer IPC payloads are rejected. OAuth credentials stay in the Electron main process and are never exposed to the renderer or command-line arguments.
- **Local usage reader** — Token history is read-only and main-process-owned. It scans only the known Codex/Claude JSONL roots, caps files and line sizes, rejects symlinks/reparse paths that escape those roots, parses an allowlisted usage shape, hashes source identities, and never persists raw log lines or prompt content. Lines are pre-filtered by substring before `JSON.parse`, each line is parsed at most once, and every file is imported in a single SQLite transaction (roughly 10× faster on a 20k-record fixture).
- **Credential refresh** — Expired OAuth tokens are refreshed and merged back into the original Codex auth file or Claude credential store so the CLIs keep working. Writes use account/change guards, restrictive file permissions, and atomic replacement where applicable.
- **Pet imports** — ZIP entry count, compressed/uncompressed sizes, JSON size, and image size/type are validated before imported files are stored.
- **Memory bounds** — Agent sessions are capped and stale/offline entries are evicted (single-pass O(n) selection) to prevent unbounded renderer memory growth.
- **Local servers** — Event ingress skips destroyed windows so a closing panel cannot drop notification/XP/history processing, and uses short header/request timeouts to bound slow loopback connections. If a port (17373–17375) is still held by another process at startup, such as a previous instance that is still quitting, the event, Presentation MCP, and Permission adapter servers keep retrying with backoff (2 s up to 30 s) instead of staying offline until the next restart.
- **Windows file replacement** — Atomic writes and plugin installs retry a rename for about 1.3 seconds when Windows Defender or the search indexer briefly locks a freshly written file (`EPERM`/`EACCES`/`EBUSY`, measured on about 3% of fresh directory renames). Other platforms and other errors fail immediately as before.
- **SQLite performance** — History, progression, achievement, and project-routing stores reuse cached prepared statements instead of recompiling SQL on every hook event; the project path cache is a true LRU.
- **Path sanitization** — Project paths are reduced to their basename, and filesystem destinations are constrained to their expected root.
- **Desktop notifications** — Notification text is built only from the normalized Agent name and bounded project basename; prompt text, tool arguments, session identifiers, and credentials are never shown or logged. Diagnostic notification history is bounded and stores only event class/outcome metadata.
- **Desktop visibility and preference IPC** — The main process owns capture protection, fullscreen capability projection, the Windows Win32 event detector, right-click hide authorization, and desktop preferences. Renderer requests accept only an allowlist of boolean fields from validated first-party frames; right-click hide re-checks the trusted pet sender and persisted preference. Preference writes use bounded reads plus atomic replacement. The Windows detector uses foreground HWND, DWM frame bounds, monitor bounds, visibility/style checks, and event hooks only; it does not use focus/title heuristics, PowerShell, WMI, or an unbounded polling loop, and native failures fail closed.
- **Presentation MCP** — The MCP bridge is loopback-only, uses a separate per-install token, rejects browser origins, limits JSON body size and request rate, validates a fixed three-tool surface, strips control/markup characters, bounds message length/TTL/queue depth, and removes a disconnected client's pending intents. It has no command, file, permission, progression, quota, or achievement authority.
- **Permission Broker** — Permission responses use a separate loopback port and per-install token, never the generic event endpoint. The main process enforces TTL, one-shot state transitions, anti-replay, bounded records, Adapter-owned opaque handles, scoped hotkeys, external-resolution reconciliation, and a bounded redacted audit. Only `allow_once` and `deny` are exposed; permanent approval is intentionally unavailable.
- **Progression storage** — XP is awarded only in the Electron main process. SQLite migrations, transactionally coupled `pet_progress`/`xp_ledger` writes, unique idempotency keys, bounded session activity, and sanitized snapshots prevent renderer or duplicate-event writes from inflating progression. The database stays local and is never uploaded.
- **Packaged runtime** — Electron fuses disable RunAsNode, Node options/inspect arguments, and privileged `file://` behavior while enforcing ASAR-only loading and embedded ASAR integrity validation.
- **Release signing** — Production macOS and Windows artifacts should be built with the platform signing credentials configured; unsigned local builds are for development only.

---

## Development

### Prerequisites

- Node.js 22.12+
- pnpm 11+

### Setup

```bash
git clone https://github.com/Ponpon55837/agent-pets.git
cd agent-pets
pnpm install
```

### Run in Dev Mode

```bash
pnpm dev
```

On a Windows machine where Chromium's GPU process crashes during development, use the built-in safe mode instead of creating a local environment file:

```bash
pnpm dev:safe
```

Safe mode keeps Chromium sandboxing enabled and uses software rendering only for that Windows Vite development session. Normal development, packaged builds, macOS, and Linux retain hardware acceleration.

### Build

```bash
pnpm build
```

The output will be in `release/`.

### Release

Releases are automated by `.github/workflows/release.yml`. When a commit that changes the `version` in `package.json` lands on `main` and no `v<version>` tag exists yet, GitHub Actions runs type-check and unit tests, builds the macOS (arm64 + x64 `.dmg`) and Windows (portable `.exe`) packages, then creates the `v<version>` tag and a GitHub Release with generated notes and both packages attached. No manual tagging or local packaging is needed. The workflow can also be re-run from the Actions tab (**Run workflow**); it skips versions that are already tagged. Builds are currently unsigned.

### Unit Tests

```bash
pnpm test:unit
```

On Windows without Developer Mode, the tests that create file symlinks are skipped, because creating a symlink needs that privilege, and file-mode (`0600`) assertions run only on macOS/Linux. Everything else runs on every platform.

To check a change in a real Electron app without touching your data, build first and then start the isolated launcher. It uses a temporary home and userData and a fake `safeStorage`. It binds the same local ports as an installed Agent Pets, so quit your everyday instance first or let it reconnect once the test app exits:

```bash
pnpm exec vite build
```

```bash
node scripts/e2e-isolated-electron.mjs
```

### Install Hooks (for development)

```bash
node integrations/install.mjs
```

This installs hooks for all detected tools. Hooks are installed to:

- `~/.codex/hooks.json` (Codex)
- `~/.claude/settings.json` (Claude Code CLI & Desktop)
- `~/.desktop-pet/agent-hook.mjs` + `agent-hook.cmd` (shared hook script all of the above call into)
- `~/.desktop-pet/event-token` (per-install event authentication secret; mode `0600` on macOS/Linux)
- `~/.desktop-pet/presentation-token` (separate presentation MCP secret; mode `0600` on macOS/Linux)
- `~/.desktop-pet/presentation-mcp.mjs` (stdio bridge used by MCP clients)

After upgrading an existing installation, Agent Pets refreshes managed hooks automatically. Restart a currently running OpenCode process once so its already-loaded plugin picks up event authentication.

Use `--claude-code` to install/uninstall the Claude Code hook only:

```bash
node integrations/install.mjs --claude-code
node integrations/install.mjs --uninstall --claude-code
```

The desktop app also refreshes the presentation bridge on startup. For an MCP client, point its stdio server command at `~/.desktop-pet/presentation-mcp.mjs` (or `%USERPROFILE%\\.desktop-pet\\presentation-mcp.mjs` on Windows) and use a real Node.js executable; do not use the packaged Agent Pets executable as a Node interpreter.

> **Language and build note:** Settings, Tray, notifications, Setup Wizard, permission, error, and onboarding copy now use a shared Traditional Chinese layer; canonical technical statuses and tool names remain unchanged. `pnpm build` and `pnpm electron:build` run a preflight that closes only project-owned Agent Pets processes to avoid `win-unpacked` file locks; unrelated Electron applications are not terminated.

---

## Project Structure

```
agent-pets/
├── electron/
│   ├── main.ts              # Electron main process
│   ├── agent-adapter.ts     # AgentAdapter contract and runtime registry
│   ├── agent-adapter-operations.ts # Platform-aware adapter detection/install bridge
│   ├── preload.ts           # IPC bridge
│   ├── event-server.ts      # HTTP event server
│   ├── event-normalizer.ts  # Generic event allowlist and projection
│   ├── permission-broker.ts # Permission state machine and anti-replay
│   ├── permission-adapter-server.ts # Dedicated OpenCode response channel
│   ├── permission-audit.ts  # Bounded redacted local audit
│   ├── progression.ts       # SQLite XP ledger and level projection
│   ├── presentation-controller.ts # TTL/rate/queue presentation control plane
│   ├── presentation-mcp.ts  # Loopback MCP presentation endpoint
│   ├── project-mcp-setup.ts # Safe project-local MCP configuration installer
│   ├── project-mcp-registry.ts # Local connected-project registry and status checks
│   ├── pet-window-mode.ts   # Bounded Mini/Edge geometry and dwell constants
│   ├── desktop-visibility.ts # Platform capability projection
│   ├── windows-fullscreen-detector.ts # Windows native fullscreen event detector
│   ├── desktop-preferences.ts # Main-owned desktop preferences
│   ├── desktop-notifications.ts # Native notification delivery and bounded log
│   ├── desktop-tray.ts      # Tray lifecycle and menu
│   ├── notification-policy.ts # Pure notification classification/cooldown
│   ├── quota.ts             # Codex / Claude quota readers
│   ├── local-usage.ts       # Bounded Codex / Claude session-log token reader
│   ├── sqlite-statements.ts # Shared prepared-statement cache for SQLite stores
│   └── setup.ts             # Platform-aware paths & setup
├── integrations/
│   ├── install.mjs          # Standalone CLI hook installer
│   ├── agent-hook.mjs       # Shared hook script (bundled into the app via extraResources)
│   ├── agent-hook.cmd       # Windows wrapper for agent-hook.mjs
│   └── presentation-mcp.mjs # Standalone stdio MCP presentation bridge
├── scripts/
│   └── stop-agent-pets.mjs  # Build preflight for project-owned Agent Pets processes
├── src/
│   ├── components/
│   │   ├── DesktopPet.vue   # Pet window (drag + click)
│   │   ├── PetAnimation.vue # Canvas spritesheet renderer
│   │   ├── StatusPanel.vue  # Unified control panel
│   │   └── SetupWizard.vue  # Tool detection + install wizard
│   ├── stores/
│   │   └── agentStore.ts    # Pinia store (sessions, pets, UI state)
│   ├── types/
│   │   ├── agent.ts         # Agent event types
│   │   ├── agent-adapter.ts  # Adapter capabilities/status contracts
│   │   ├── desktop.ts       # Desktop preference IPC types
│   │   ├── desktop-visibility.ts # Visibility capability types
│   │   └── presentation.ts  # Presentation intent/status contract
│   └── utils/
│       ├── format.ts        # Shared formatting helpers
│       └── sound.ts         # Synthesized audio cues (Web Audio API)
├── public/
│   └── pets/
│       ├── pets.json        # Built-in pet manifest (id/displayName/folder)
│       └── <pet-id>/        # spritesheet.webp + pet.json per built-in pet
├── tests/                   # Node built-in unit tests
├── package.json
└── README.md
```

The app's own install/uninstall logic (used by the Setup Wizard's buttons) lives in `electron/setup.ts`, in-process — `integrations/install.mjs` is the standalone equivalent for running from a terminal (see [Install Hooks (for development)](#install-hooks-for-development) above); both generate the same hook scripts and plugin content, kept in sync by hand.

---

## License

MIT — see [LICENSE](LICENSE). The quota integration is based on the MIT-licensed [TokenBar](https://github.com/Nanako0129/TokenBar); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
