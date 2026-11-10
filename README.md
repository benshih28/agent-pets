# Agent Pets

A desktop pet that shows what your AI coding agents are doing: thinking, running a tool, waiting for you, done or failed.

**English** | [繁體中文](README.zh-TW.md)

---

## Install

Download the latest build from the [Releases](https://github.com/Ponpon55837/agent-pets/releases) page.

- **macOS** — `AgentPets-<version>-arm64.dmg` (Apple Silicon) or `AgentPets-<version>-x64.dmg` (Intel). Open it and drag the app to Applications.
- **Windows** — `AgentPets-<version>.exe`, a portable app that needs no installer.

Each release also has `SHA256SUMS.txt`; run `shasum -a 256 -c SHA256SUMS.txt --ignore-missing` in the download folder to check the files.

Builds have no developer certificate and are not notarized (the macOS app is only ad-hoc signed so its bundle is sealed), so the OS warns the first time:

- **macOS (Gatekeeper)** — right-click the app in Applications, choose **Open**, then confirm. Or use **System Settings → Privacy & Security → Open Anyway**. As a last resort: `xattr -dr com.apple.quarantine "/Applications/Agent Pets.app"`.
- **Windows (SmartScreen)** — choose **More info → Run anyway**.

## First run

On the very first launch a pet appears and the panel opens with a short intro (what the pet shows, when it asks for you, how it grows), followed by the **Setup Wizard**:

1. Click **Install** next to a tool, or **Install all**, to wire up its hooks. Nothing is installed without your click, existing config files are backed up first (`*.agent-pets-bak-*`, latest 5 kept), and only Agent Pets' own entries are added. A file it cannot parse is never overwritten.
2. Restart the tool. Use **Wait for real event** (run any prompt; it waits 30 seconds for an event the tool itself sends) to confirm the connection end to end. **Test receiver** only proves the app can receive a local event, and **Diagnose** lists the individual checks with a fix hint.
3. The wizard reappears on later launches only until you finish it or choose **Not now**. Reopen it any time from **Settings → Advanced → Setup Wizard**.

To remove integrations, use **Remove** on a tool's card in the wizard (only that tool's entries are taken out), or **Full cleanup…** before deleting the app (removes every hook, the connection tokens and the files under `~/.desktop-pet`, `%USERPROFILE%\.desktop-pet` on Windows).

## Supported agents

| Agent | CLI | Desktop | Permission | Quota | Token usage |
|-------|-----|---------|------------|-------|-------------|
| OpenCode | yes | yes | respond | — | estimated |
| Codex | yes | partial | observe | provider | exact |
| Claude Code | yes | yes | observe (respond when enabled) | provider | exact |

- **respond** — the permission request can be allowed once or denied from the pet bubble. OpenCode always; Claude Code after you turn on **Answer Claude Code permissions from the pet** (see [Permission bubble](#permission-bubble)).
- **observe** — the pet shows Waiting Permission, but you approve inside the tool itself (Codex only reports that it is waiting; there is no way to send a decision back).
- Codex does not report a "waiting for input" state. Codex Desktop shares `~/.codex` with the CLI and has no separate install API, so it works only if that build runs the same hooks; verify with **Wait for real event**.
- **Token usage: exact** means per-message counts read from the agent's own local session logs (`~/.codex/sessions`, `~/.claude/projects`). **estimated** means the number comes from the event the agent sent, as OpenCode and Generic HTTP integrations do; Codex and Claude Code usage on live events is not counted, so local logs stay the single source.
- A **Generic HTTP** adapter is available to local integrations through the authenticated `/v1/events` endpoint (see [Event server](#event-server)). It is observe-only.

## The pet

| Action | Effect |
|--------|--------|
| Click (or focus and press Enter / Space) | Open the control panel next to the pet |
| Double-click | Pat the pet: a small reaction and +1 mood (up to 5 per day) |
| Drag | Move the pet; its position is remembered across restarts |
| Right-click | Menu: open panel, open settings, Do Not Disturb, Mini mode, hide, quit (or hide immediately if **Right-click hide** is on) |

- **Status line** — below the pet, up to 3 lines, one per active tool family (Codex / Claude / OpenCode); CLI and Desktop variants share a line. Each line is one thin row: the tool name and a short English state word in every UI language, plus the quota percentage and meter and any plugin badges, e.g. `Claude · Working 71%`. The state word is always shown in full: when a line is too narrow (small multi-pet sizes, several badges) the `+N` badge count goes first, then badges (from the end), then the name shortens and is dropped, then the percentage (the meter stays). Dropped badges stay in the tooltip and screen-reader label. With several sessions in a family the line follows the one that needs you first (highest-priority state, then most recent). The full name, CLI/Desktop variant, project and state (in the UI language) are in the hover tooltip (the quota tooltip when a quota meter is shown) and in the line's screen-reader label. With no active session the single line shows `Idle` or `Offline`, which is also its tooltip and label.
- **Completion markers** — results that arrive while you have not touched the pet for 45 seconds add up in a `✓ N` marker beside it (`⚠ N` when one failed); Mini mode and Edge peek show the count too. Clicking the pet or the marker clears it. Turn them off under **Settings → Desktop → Completion markers**; while off nothing is counted.
- **Bubbles** — success, failure and waiting toasts appear above the pet (**Status bubble**, on by default; closes after a few seconds, click to open the panel). A **Working hint** that names the tool in use is optional (off by default). Permission prompts never auto-dismiss. Bubbles are prioritized: permission first, then agent toasts, Presentation MCP speech, activity hints and plugin notifications.
- **Reactions** — bounce on state changes and a shake while waiting for permission (**Bounce & shake**, on by default) plus optional decorative **Ambient motion** (off by default). Agents with Presentation MCP and plugins can also trigger `happy`, `curious`, `thinking`, `surprised` and `encouraging` reactions.
- **Mood and growth** — see [Growth](#growth).
- **Mini mode** — a compact 96 px pet with a status icon. **Edge peek** (separate, off by default): drag the pet to the left, right or top screen edge and hold about 650 ms to tuck it into a Liquid Glass handle; click or hover to expand. Pending permission requests always bring the full pet back. Bounds survive display and DPI changes.
- **Shimeji behavior** (off by default) — low-frequency idle walking, sleeping and cursor reactions, clamped to the current display. It pauses for active work, permission prompts, Do Not Disturb, reduced motion, background and power saving.
- **Multiple pets** (off by default) — when 2 or more tool families are active, show one small pet per family, each with its own pet choice.
- **Project pets** — bind a project folder to its own pet under **Settings → Pets**. Project identity is a salted local hash; full paths are not stored.
- **Custom pets** — see below.

### Custom pets

Under **Settings → Pets**, use **+ Import asset** (`.webp`, `.png` or `.jpg` spritesheet) or **+ Import .zip** (a `.codex-pet.zip` kit, e.g. from [codex-pets.net](https://codex-pets.net), read directly with no manual unzip). A zip import first shows a preview (idle animation, first frame of each row, atlas version, frame size and warnings) before anything is installed. The atlas version is detected from the image: 9 rows is v1, 11 rows is v2; v2 kits walk on row 1 (running-right) without a `behaviorManifest`, and rows 9–10 are look-direction rows, so sleep still falls back to idle unless the kit declares one. If the pet ID already exists you choose **Replace** or **Keep both** (saved as `<id>-2`); nothing is overwritten silently, and an interrupted install never leaves a half-written folder. Pets can be renamed (pencil icon) and removed (built-in pets are only hidden; the default `aang-airbender` cannot be removed). Imported pets live in `~/.desktop-pet/custom/`.

Sprite requirements (checked on import):

- Frame cell **192 × 208 px**; the image width and height must be multiples of that, and the sheet needs **at least 9 rows** (rows 0–8). The grid, rows and default timings live in one place, [`src/types/pet-atlas.ts`](src/types/pet-atlas.ts), shared by import validation and the renderer.
- Default rows: 0 idle (Idle / Offline), 3 waving, 4 jumping (Success), 5 failed (Error), 6 waiting (Waiting Permission / Input), 7 running and 8 review (Thinking / Tool Running).
- A `pet.json` (or a plugin skin) may declare a `behaviorManifest` that overrides any motion — `idle`, `waving`, `jumping`, `failed`, `waiting`, `running`, `review` — and adds the Shimeji motions `walk` and `sleep`, for example `{"behaviorManifest":{"idle":{"row":9,"frames":4},"walk":{"row":1},"sleep":{"row":5}}}`. Each entry is `row` (0–63), optional `frames` (1–16) and optional `frameDurations` (1–16 values, clamped to 60–3000 ms). An entry that is malformed, points past the sheet's rows, or has more frames than columns is dropped and that motion uses the built-in one; undeclared `walk`/`sleep` fall back to idle.

## Control panel

Open it with a click on the pet or the Tray. The header shows the pet, its level and the number of running / attention sessions, plus, left to right, a **⋮ menu** (Do Not Disturb, Keep open, and a quick Appearance toggle that cycles system / light / dark; a dot on the button shows Do Not Disturb is on), Settings (`Cmd/Ctrl+,`) and Close. **Esc** steps back one level, then hides the panel. Drag any edge to resize the panel (from 360×420 up to full screen); every view shares that one size and it is remembered, and **Settings → General → Reset panel size** restores the default.

- **Sessions** — grouped into **Needs attention**, **Running** and **Idle & finished**. Filter by All / Needs attention / Running and by tool, and sort by urgency or most recent. Live states show elapsed time; a row expands to show path, tool, last seen and session ID, plus jump-back actions: **Show project folder** (selects it in Finder or File Explorer; it never opens it), **Copy project path** and, on macOS, **Switch to** the session's terminal or IDE (it brings the app forward, not a specific window or tab). **Clear offline items** removes ended sessions from view; sessions silent for 15 minutes go stale. A banner appears if a local server port is busy, with **Retry now**.
- **Quota** — the remaining Codex and Claude Code subscription quota (session and weekly windows, reset times in your local time). Agent Pets has no account system and never asks for agent credentials: it reuses the CLI's local sign-in, queries the provider from the main process and passes only percentages to the UI. If the CLI session is missing or expired, sign in again in that CLI. Results refresh every 2 minutes while the panel is open (**Refresh now** is rate limited); the last good reading stays visible if a refresh fails. A thin quota meter also appears in the pet's status pill while that tool is active. Below the provider quota, **Current 5-hour block** shows the block computed from local logs (it starts at the first usage after a 5-hour break, rounded down to the hour, and lasts 5 hours): tokens so far, elapsed and remaining time and tokens per minute. It is a local estimate of the window, not the provider's own limit.
- **History** — completed / failed sessions, active time, token usage (fresh input plus output; cache is listed separately), agent distribution and a per-model breakdown for **7, 30 or 90 days**, optionally filtered by project. **Export JSON** or **Export CSV** writes the sanitized daily summary to a file you choose. **Clear history** removes history and quota snapshots only, never XP, level or achievements. History is built from hook events plus a read-only scan of local Codex / Claude Code session logs; prompts, tool arguments and full paths are not stored. Long logs are read in parts over several scans; a scan never skips a large file. Raw events are retained for 90 days; daily aggregates remain.
- **History → Sessions** — past sessions, newest activity first (**Load more** for older ones): outcome (completed, failed, cancelled, active, incomplete), agent, project, duration, tool runs, permission waits, tokens and top model. It uses the range and project filter above and adds agent, outcome, custom dates and a search over project and agent names. Select a session to see its timeline: each state change with its time and tool name (latest 500 entries). Only metadata is kept — no prompts, transcript text or tool arguments, and only the project folder's name. Sessions recorded before this view existed show no tool counts or timeline. The JSON export includes this list without project names.

- **Plugin tabs** — each enabled plugin that has something to show adds a tab after History (only while plugins are on and the plugin is installed, enabled and not crashed; a skins-only plugin gets none). A tab shows the plugin's name, icon and an unread badge; with many plugins the tab bar scrolls (wheel, trackpad, ‹ › buttons, arrow keys). A plugin with a panel page shows it inside the tab. Otherwise the tab shows only what the plugin provides: its panel themes (choose them for light, dark or both modes, with previews and your own background image, followed by your **My themes** and the theme editor), its commands, its recent notifications (only for plugins that can post them), and links to its settings and details. The last tab you used is remembered.

### Growth

Under **Settings → Pets → Growth**: XP, level, evolution stage and streak, recent XP, and achievements.

- XP is awarded only in the main process, idempotently: +20 per completed session, +10 for the first completion of a local day, +2 per 30 minutes of active work (up to +10 per session) and +5 for each consecutive day. Failed or cancelled work earns no XP.
- **Mood** starts each day at 10: +4 for a success, −6 for an error, plus capped bonuses for tools and long work. **Reset today's mood** returns it to 10, and **Mood visuals** can turn the aura off without stopping tracking.
- 14 achievements (one hidden), filterable by All / In progress / Unlocked. Unlocks are saved once per pet and announced with a native notification. Token achievements count exact local-log usage of Codex and Claude Code once per message (shared by every pet, like History), plus event-reported usage of other agents. **Enable achievements** stops new unlocks only.

## Settings

Open from the panel header or the pet menu. Settings are in five groups, with **search** at the top that jumps to the matching setting:

| Group | Contents |
|-------|----------|
| General | Language (Traditional Chinese / English), **Theme** (Panel: match system / light / dark; Pet: dark by default, light, or follow the panel — set separately, e.g. a dark system with a light pet), **Panel theme** (the theme each mode uses, **Customize…**, **Restore built-in**), **My themes**, pet size, reset panel size, bounce & shake, status bubble, ambient motion, working hint |
| Pets | Pet library and imports, multiple pets, project pets, Growth (mood, XP, achievements) |
| Desktop | Notifications, Do Not Disturb, sound; Mini mode, Edge peek, Shimeji, capture exclusion, fullscreen auto-hide, completion markers, right-click hide, jump back to a session, permission bubble, answering Claude Code permissions, Presentation MCP, launch at startup (packaged builds), permission log |
| Advanced | Setup Wizard, project MCP, diagnostics, restart, quit |
| Plugins | Install, enable, permissions, updates and plugin notifications (day-to-day use is in the dashboard plugin tabs) |

- **Do Not Disturb** silences native notifications, sounds, extra motion and non-essential bubbles without stopping event ingestion. Timed presets are in the Tray menu: 30 minutes, 1 hour, until 9:00 tomorrow, or until turned off (a timed DND lasts at most 7 days). A summary notification reports how many alerts were silenced when it ends.
- **Notifications** (on by default) cover waiting-permission, waiting-input, completion and errors, with a per-session cooldown and batching of terminal events. On macOS, clicking a waiting-permission or waiting-input notification about one session switches to that session's app; any other notification opens Sessions. **Sound** (off by default) plays short synthesized cues with per-event toggles and a volume slider.
- **Jump back to a session** (on by default) controls the jump-back actions; **Switch to app** (macOS, on by default) has its own toggle. Switching uses `open -b` (LaunchServices), so it needs no Automation or Accessibility permission. Only apps on a fixed list of known terminals, IDEs and the Claude app can be activated, and only after you click; Windows does not offer it yet.
- **Capture exclusion** hides only the pet window from supported screenshots (Windows system API; macOS is best effort). **Fullscreen auto-hide** keeps the pet out of another app's macOS fullscreen Space or a Windows borderless fullscreen window; it fails closed if the native runtime is unavailable.

## Permission bubble

When an agent asks for permission, a Liquid Glass bubble appears on the pet and the same card shows in the panel. It shows the requesting tool and project, what will run (redacted, expandable, copyable) and a countdown. Requests time out after a short TTL (at most 5 minutes) and the agent is told it was cancelled.

- **Risk** — only read-only tools (`read`, `glob`, `grep`, `list`) are low risk; every other OpenCode tool, including unknown and MCP-wrapped ones, is high risk. For Claude Code, `Write` / `Edit` / `MultiEdit` / `NotebookEdit` are medium only when the file is inside the project folder (also after resolving symlinks) and not under `.git`, `.claude`, `.husky`, `.vscode`, `.idea`, `.devcontainer` or `node_modules/.bin` and not a shell start-up or tool config file such as `.zshrc`, `.envrc` or `.npmrc`; such edits show the project-relative path. Every other edit, `Bash`, `WebFetch` and `WebSearch` are high, and MCP or other tools are unknown. Network tools are flagged "connects to the network". A high or unknown request whose text had to be cut off can only be denied here; allow it in the agent itself.
- **Redaction** — API keys and tokens, `Authorization` values, `password=` style arguments, URL credentials and private keys become `[redacted]`, and your home directory becomes `~`.
- **Hotkeys** — global shortcuts exist only while the top request is eligible (low or medium risk): **Cmd+Shift+Y** allow once / **Cmd+Shift+N** deny on macOS, **Ctrl+Shift+Y** / **Ctrl+Shift+N** on Windows. If another app owns the key, the bubble says so and the buttons still work. In the bubble itself: **N** or **Esc** denies; **Y** allows once for low risk, and must be held for 0.6 s for other risk levels.
- **Queue** — several pending requests show as a list you can expand; **Deny all** needs a second press to confirm.
- For agents that cannot be answered here (Codex, and Claude Code while the option below is off) the bubble is a reminder that tells you to go back to the tool. Only `allow once` and `deny` exist; permanent approval is intentionally unavailable.
- **Claude Code** (off by default) — turn on **Settings → Desktop → Permission requests → Answer Claude Code permissions from the pet**. Claude Code's `PermissionRequest` hook then waits for your answer for up to the **Wait time** (default 90 s, 15–120 s) while Claude Code's own prompt stays open in the terminal; whichever answers first wins, and the pet card says you can also answer there. One click answers exactly one tool call: if the same request is already waiting from another tool call (for example two subagents running the same command), the second one is answered in the terminal only. The bubble is taken down when that tool finishes, when Claude starts its next tool call or permission prompt, when the turn ends or a new prompt is sent, or when the wait runs out. Because the terminal may have answered first, the permission log marks Claude Code decisions as possibly answered in the terminal. If the pet is not running, the option is off, the wait runs out or anything fails, the hook prints nothing and Claude Code continues as if Agent Pets were not installed (non-interactive `-p` runs then deny as usual). Your own deny rules still win over an allow from the pet. A deny tells Claude only the fixed text `Denied in Agent Pets. (已在 Agent Pets 拒絕)`. Other tools that also register a `PermissionRequest` hook run alongside ours; Claude Code decides whose answer counts.
- **Permission Bubble** can be switched off in Settings; pending requests then stay with the broker and the Tray badge. **Settings → Desktop** also shows a bounded log of recent decisions (time, tool, source, result only).

## Plugins

Plugins add pet notifications and reactions, a panel page, Tray commands, badges, pet skins, panel themes (colours, fonts, backgrounds for light and dark, plus the pet status pill) and status rows. They run in a sandbox with no Node.js, filesystem or shell access, and network use is limited to HTTPS hosts you approve.

**Settings → Plugins** has four sections: **Installed** (enable, update, settings, details), **Explore** (the opt-in online catalog with signature checks and updates), **Notifications** (an inbox of plugin messages with per-plugin mute) and **Advanced** (developer mode, resource limits, diagnostics). Installing shows a sheet that groups the requested permissions by risk; new high-risk permissions or a changed signing key must be acknowledged. Plugins install disabled and you turn each on yourself. A plugin's panel themes are chosen in its dashboard tab (also in its detail page, **Panel themes**); **Settings → General → Appearance** shows the theme in use for each mode, **Open plugin settings** jumps to that tab, and **Restore built-in** is always there. A theme colours the whole app, including dialogs, permission prompts and the pet's bubbles and status pill; every theme is checked so text stays readable on every surface (also over black and white desktops) and danger, success, warning and info colours keep their meaning. Plugin pages and Workers can follow the active theme and light/dark mode through the `--ap-*` tokens and `api.theme`, without a permission. Plugin authors: see [What's new in 1.12](docs/plugins/whats-new-1.12.md).

**My themes** (no plugin needed): **Settings → General → Appearance → Customize…**, **New theme…** in **My themes**, or the same list in a theme plugin's tab open the theme editor. Start from the built-in look, a neutral blank, any installed plugin theme or another of your themes, then edit light and dark separately: every colour (text, surfaces, accent, borders, danger/success/warning/info, scrim/shadow/highlight and the pet status pill) has a colour picker, a text field for `#hex`, `rgb()`, `hsl()` or `oklch()`, an OKLCH fine-tune and a hint naming where it is used. **Generate from colour** builds full light and dark palettes from one seed; **Generate from background image** uses the image's main colours. The background can be a solid colour, a linear or radial gradient, or your own image (dim, fit, position, blur); fonts are chosen from system font stacks, plus text size and corner radii. A live preview shows both modes (card, buttons, menu, toast, dialog, permission card with the risk badge, pet pill). The same checks as plugin themes run while you edit: a problem is shown on the colour with the failing pair, the measured and required contrast and a **Use suggested** fix, and Save and Use stay off until everything passes. Undo, Reset, an unsaved-changes prompt, and JSON export/import (colours and settings only, never the image) are included. Up to 50 themes are kept in `userData/panel-themes-user/`; deleting the theme a mode uses returns that mode to the built-in look.

To build a plugin, read the [plugin developer handbook](docs/plugins/README.md).

## Project MCP and Presentation MCP

**Presentation MCP** is a local stdio bridge, `~/.desktop-pet/presentation-mcp.mjs`, that lets an MCP-capable agent make the pet speak or react. It exposes three tools: `pet_status` (read-only), `pet_react` (five bounded reactions) and `pet_say` (up to 240 characters for 1–15 seconds). Each client is limited to 3 requests per 10 seconds. It cannot run commands, touch files, answer permissions or change XP, and Do Not Disturb and permission/error states take precedence. It can be switched off under Settings → Desktop.

**Setup MCP for a project** (Settings → Advanced) registers the bridge in a project in two steps, so nothing is written before you review it:

1. Choose the project folder. A review lists each tool, the exact file it would create or modify, whether Git already tracks it, and a preview of the entry. Only ticked tools are written: Codex `.codex/config.toml`, Claude Code `.mcp.json`, OpenCode `opencode.json`.
2. **Local only** (on by default in a Git repository) adds the new files to `.git/info/exclude`, because the entry contains absolute Node.js and bridge paths from your machine that mean nothing to teammates. Files with comments (JSONC), invalid JSON or an existing different `agent-pets` entry are never rewritten; the result shows a copyable snippet instead.

The panel keeps a list of configured projects with status Connected, Partially connected, Conflict, Outdated paths or Folder not found; **Update paths** repairs entries after the app moves or Node upgrades, and **Remove MCP** removes only matching entries. After setup, approve `agent-pets` in `/mcp` for Claude Code, trust the project for Codex, or restart OpenCode. The bridge needs a real Node.js executable and Agent Pets running; to register it globally use `codex mcp add agent-pets -- node ~/.desktop-pet/presentation-mcp.mjs` or `claude mcp add --scope user agent-pets -- node ~/.desktop-pet/presentation-mcp.mjs`.

## Event server

Hooks post status updates to `http://127.0.0.1:17373/v1/events` with the per-install `X-Agent-Pets-Token` header (read from `~/.desktop-pet/event-token`). A hook spends at most 1.5 s getting the event out and 0.25 s waiting for the reply, and stops at once when the pet is not running, so an agent is never held up. While the pet is still starting (it leaves `~/.desktop-pet/event-port-17373.starting` until it is listening), a refused event is retried for up to 5 s instead of being lost ([docs/dev/hook-delivery.md](docs/dev/hook-delivery.md)).

```json
{ "source": "codex", "sessionId": "sess_abc123", "state": "thinking", "timestamp": 1735689600000 }
```

`source`, `sessionId`, `state` and `timestamp` are required (missing fields give `400`, a bad token `401`). Optional: `project`, `originalEvent`, `toolName`.

- `source`: `opencode-cli`, `opencode-desktop`, `codex`, `codex-desktop`, `claude`, `claude-desktop` (`opencode` is normalized to `opencode-cli`)
- `state`: `idle`, `thinking`, `tool-running`, `waiting-permission`, `waiting-input`, `success`, `error`, `offline` (`waiting` is normalized to `waiting-permission`)

## Diagnostics and logs

**Settings → Advanced → Export diagnostics** saves a JSON report to a place you choose: versions, system info, local server and plugin host state, counters and the recent log. Tokens, prompts and personal paths are removed and nothing is uploaded. If the previous run ended abnormally, the app suggests exporting it.

The main-process log is `logs/main.log` inside the app's userData folder (`~/Library/Application Support/Agent Pets/` on macOS, `%APPDATA%\Agent Pets\` on Windows), rotated at 1 MB with 3 files kept and redacted when written. Plugin diagnostics are under each plugin's **Diagnostics** tab.

## Privacy and security

- Everything stays on your computer: history, XP, achievements, logs and tokens are never uploaded.
- Renderers run sandboxed with context isolation, no Node.js, a strict CSP and validated IPC senders. Electron fuses disable RunAsNode and enforce ASAR-only loading.
- The event, permission and Presentation MCP servers listen on `127.0.0.1` only (ports 17373–17375), use separate per-install tokens, reject browser-originated requests and rate-limit input. If a port is busy they retry with backoff.
- Permission responses use their own port and token, with TTL, one-shot decisions, anti-replay and a redacted audit.
- Notification text contains only the agent name and project folder name, never prompts, tool arguments or session IDs.
- Hooks report the host app from a few environment values only (`TERM_PROGRAM`, the macOS bundle id, Claude Code's entrypoint and Windows Terminal / VS Code / Cursor markers). Full project paths and bundle ids stay in the main process. **Show project folder** only reveals an existing folder (never a file, and never opens it, so no app or document package is launched); **Copy project path** refuses paths with shell metacharacters.
- Quota requests go only to the exact Codex and Anthropic HTTPS endpoints from the main process; OAuth credentials never reach the renderer.
- The log reader is read-only, bounded and limited to the known Codex / Claude session roots. Pet zip imports pre-scan the archive (entry count, total size, compression ratio, overlapping entries, symlinks, unsafe or non-UTF-8 names, duplicates), cap image dimensions from the header before decoding, strip prototype keys from `pet.json`, and install through a private staging folder with atomic renames.
- Plugins are sandboxed and permission-gated; secrets are stored encrypted with the system secure store and never returned to the UI.

## Troubleshooting

| Symptom | What to check |
|---------|---------------|
| Pet stays Offline | Press **Wait for real event** and run a prompt. No event: restart the tool (hooks load at start), then **Diagnose**. |
| Diagnose: Node.js executable missing | Install Node.js 18+, then press **Repair**; it writes the absolute path (a bare `node` fails in apps launched from Finder or the Dock). Switching nvm versions also needs a **Repair**. |
| Codex hooks not enabled | **Repair** adds `hooks = true` under `[features]` in `~/.codex/config.toml`. |
| Install refused: not valid JSON | `settings.json` / `hooks.json` has comments or a syntax error. Agent Pets leaves it untouched; fix or move the file, then install again. |
| Banner: event receiver offline | A local port (17373–17375) is held by another program or an older Agent Pets. Close it; the app retries automatically, or press **Retry now**. |
| Hook script out of date | **Repair** redeploys it. |
| Claude Code does not show the project MCP | Approve `agent-pets` in `/mcp`. Codex needs the project to be trusted. |
| Pet frozen or blank | Use **Reload pet** in the Tray (Advanced) or **Restart Pet** in Settings → Advanced. |
| macOS: **Launch at login** stays pending | Approve Agent Pets in System Settings → General → Login Items (the toggle has a button). Move the app to the Applications folder first; a login item cannot be registered from a disk image or Downloads. |
| Windows: **Restart** closes the app without reopening | Fixed for the portable build: it now relaunches the original `.exe`, not its temporary extraction folder. If it still fails, start the `.exe` again by hand. |
| Bug report | Export diagnostics and attach the file. |

## Development

Requires Node.js 22.12+ and pnpm 12 (pinned by `packageManager`).

```bash
git clone https://github.com/Ponpon55837/agent-pets.git
cd agent-pets
pnpm install
pnpm dev
```

| Script | Purpose |
|--------|---------|
| `pnpm dev` / `pnpm dev:safe` | Vite + Electron dev run; `dev:safe` uses software rendering on Windows when the GPU process crashes |
| `pnpm test:unit` / `pnpm test:unit:watch` | Node built-in tests in `tests/` (no Electron launched) |
| `pnpm test:coverage` | Unit tests with an 85% line floor on main-process modules |
| `pnpm lint` | Main-process guard (unhandled `loadURL`, global error handlers) |
| `pnpm exec vue-tsc --noEmit` | Type check |
| `pnpm check:bundle-size` | Fails if a renderer chunk exceeds 250 KB (run after `vite build`) |
| `pnpm check:bundle` | Verifies the plugin panel tokens bundle |
| `pnpm check:contrast` | Design token contrast check (fails on violation) |
| `pnpm check:design` / `check:design:strict` | Reports hard-coded colors, sizes, spacing, transition durations and easings; `--strict` fails on them ([docs/dev/design-tokens.md](docs/dev/design-tokens.md)) |
| `pnpm build` / `pnpm build:fast` | Type check, Vite build, then electron-builder into `release/` (`build:fast` skips compression) |
| `pnpm bench`, `pnpm bench:lag` | Performance benchmarks |

Both build commands first close project-owned Agent Pets processes. To check a change in a real Electron app without touching your data, run `pnpm exec vite build` then `node scripts/e2e-isolated-electron.mjs` (temporary home and userData, fake `safeStorage`, so macOS Keychain is never touched; its local ports default to 27373–27375 so an installed copy keeps 17373–17375 — `--hook-port-base` picks another range, `--real-hook-ports` uses the defaults, `--reuse-root` restarts with an earlier run's home for cold-start tests; see [docs/dev/e2e-without-keychain.md](docs/dev/e2e-without-keychain.md)).

**Dev port overrides** — unpackaged runs may set `AGENT_PETS_EVENT_PORT`, `AGENT_PETS_PERMISSION_PORT` and `AGENT_PETS_PRESENTATION_PORT` (1024–65535; defaults 17373, 17374, 17375) so they do not fight an installed copy. Packaged builds ignore them.

**Agent states** — everything keyed by an agent state lives in two tables checked with `satisfies Record<AgentState, …>`: `AGENT_STATE_POLICY` in `src/types/agent.ts` (priority, desktop notification, history outcome; shared with the main process) and `AGENT_STATE_PRESENTATION` in `src/utils/agent-state-presentation.ts` (labels, colour, screen-reader text, status-line word, mini badge, sound cue). Adding a state fails the type check until both are filled in. The one exception is the sprite motion for each state: it depends on the previous state and on timing, so it stays as logic in `src/utils/pet-motion-plan.ts`.

**Agent sources** — the six event sources (`claude`, `codex-desktop`, …) and the three tool families (Codex, Claude, OpenCode) are listed once, in `AGENT_SOURCE_REGISTRY` (label, family, CLI or Desktop) and `AGENT_FAMILY_REGISTRY` (name, adapter id, subscription quota, local token log) in `src/types/agent.ts`. Source labels, the status-line family order, the per-family pet, quota meters, notification names, the adapter source lists and the main-process allowlists (event sources, permission sources, names plugins may not use) are derived from them. The hook scripts and installers (`integrations/`, `electron/setup.ts`, `electron/hook-config.ts`) still spell out their own source strings. See [docs/dev/agent-sources.md](docs/dev/agent-sources.md) before adding a source.

**Sound** — which state plays which cue is the `cue` column of `AGENT_STATE_PRESENTATION`. Everything else about sound lives in `src/types/sound.ts`, checked with `satisfies Record<SoundCue, …>` and deep-frozen. It holds each cue's tones (frequency, timing, gain and waveform), its per-cue switch and its preview button. It also holds the shared envelope, the 3-second per-cue throttle, the 15-second minimum before a finished task plays a sound, the 0–100 volume range and the persisted defaults that the main process uses too. `src/utils/sound.ts` only schedules Web Audio nodes, and `src/utils/sound-policy.ts` only decides whether a cue may play (sound on, DND off, pet visible, the cue's own switch). `tests/sound-registry.test.mts` checks that every state still produces the same scheduled output as before the registry; see [docs/dev/sound-registry.md](docs/dev/sound-registry.md).

`node integrations/install.mjs` installs the hooks from a checkout with the same safeguards as the wizard (`--claude-code` limits it to Claude Code, `--uninstall` removes them).

**CI** — `ci.yml` runs on pull requests and `main` pushes that change more than docs: type check, `pnpm lint`, `pnpm test:coverage`, `vite build`, bundle-size, plugin-panel-bundle and contrast checks, a design-token report and a non-blocking dependency audit. `ci-platforms.yml` runs the type check and unit tests on macOS and Windows weekly and on demand.

## Versioning and release

Bump `version` in `package.json` (patch by default; minor for a persistent-schema, public-contract or security-boundary change). When that commit lands on `main` and no `v<version>` tag exists, `.github/workflows/release.yml` runs the type check and unit tests, builds the macOS arm64 and x64 `.dmg` files and the Windows portable `.exe`, then creates the tag and a GitHub Release with generated notes. It can also be re-run from the Actions tab and skips versions that are already tagged. Each macOS job builds on a runner of its own architecture (Intel for x64) so native modules match, and electron-builder ad-hoc signs the whole bundle after it writes the fuses (`mac.identity: "-"`; no certificate, no notarization). `scripts/check-mac-bundle.mjs` then mounts the dmg and fails the release unless `codesign --verify --deep --strict` passes, the fuses equal `build.electronFuses`, and every Mach-O and `*.node` file is the target architecture. The release job uploads `SHA256SUMS.txt` with the installers. If electron-builder fails to download Electron or its tools from GitHub releases, the job retries twice through `scripts/release-asset-mirror.mjs`, a 127.0.0.1-only proxy that fetches the same release assets through the GitHub API; checksums are still verified by electron-builder.

## License

MIT, see [LICENSE](LICENSE). The quota integration is based on the MIT-licensed [TokenBar](https://github.com/Nanako0129/TokenBar); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
