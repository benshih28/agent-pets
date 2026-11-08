# UX guidelines

How a plugin shows up in Agent Pets, and how to write the text people see. All limits below come from the manifest validator and Host API.

## Where users meet your plugin

Everything lives under **Settings → Integrations → Plugins**, in four tabs.

| Tab | What it shows about your plugin |
|---|---|
| **Installed** | A card with name, version, author, status, chips for what it provides (Panel, Commands, Tray, Badge, Pet skins, Work status, Schedule, Notifications, Pet reactions), an enable switch, and **Open plugin panel**, **Settings**, **Details** buttons. Searchable and filterable (enabled, updates, needs attention). |
| **Explore** | The opt-in online catalog. A card shows the catalog name, version, size and the catalog **description**, a pinned-signature chip, and ID, author and key fingerprint under **More details**. |
| **Notifications** | An inbox of everything your plugin sent with `api.feed.notify`, whether or not a bubble was shown. Users filter by plugin, mark all as read, clear a plugin's items (with Undo) and mute a plugin from its details page. |
| **Advanced** | Developer mode, resource limits and the global switches. Not plugin-specific. |

The **detail page** has four sections: **Overview** (notification routing: target pet, mute and notification rate; the network hosts table, declared versus allowed, with revoke; and "Where it shows up in the app": Tray items, current badge text, skins, status row), **Settings** (your `settings` form), **Commands** (your `commands`) and **Diagnostics** (your logs and rejected calls). The page header shows version and signature state. Users can also report an issue or remove the plugin (optionally deleting its settings and data).

### The dashboard tab

An enabled plugin also gets its own tab in the control panel, after Sessions, Quota and History. It appears only while plugins are globally on and your plugin is installed, enabled and not crashed, and it disappears the moment any of that stops being true. The tab shows your manifest `name` (truncated when long), your `icon` (or a generic plugin icon) and a badge with your unread notification count or `badge` text. If you contribute a `panelView`, it is embedded in the tab under the same frame, sandbox and size rules as the Settings plugin page, and it is closed whenever the user switches tabs or hides the panel, so keep your page responsive and stateless between opens. Without a `panelView`, the tab shows your recent notifications and your `commands` as buttons, with links to your settings and details.

### The install sheet

Before anything is installed, a sheet shows the source (catalog, local file or developer folder), the version change, the author signature state and every requested permission **grouped by risk**: *Network and external links* and *Data and secrets* groups carry high-risk items, storage, schedule and Agent status are medium, and display contributions are low. For an update, **new permissions** are listed separately from the existing ones. Adding network, link or secret permissions, or a changed or removed signing key, requires the user to tick **I understand these changes**, and focus starts on Cancel. Plan for this: an update that adds a high-risk permission is a speed bump, so make it rare and explain it in your release notes.

### Toasts and the panel frame

Toasts are drawn by the app to confirm the user's own actions (for example command sent, access to a host revoked, notifications cleared). A plugin cannot create one. Your notifications use the pet bubble and the inbox.

A panel page is shown inside a frame the host draws: a back button (Esc), your icon, your `panelView.title` with "plugin name · version" below it, the signature state, **Reload panel**, a link to the plugin's permissions and settings, and **Maximize** (double-click the header; Esc restores). While loading it shows "Loading …" and offers Cancel after 5 seconds; a failed load shows reload, back and report buttons. The frame position and the "Plugin content" marker are not yours to change. The control panel has one user-resizable size shared by every view, so opening your panel never resizes the window and `preferredSize` no longer changes it: make the layout responsive from 360 px wide up to full screen.

## Writing for people

| Where | Rule |
|---|---|
| `name` | Both `zh-TW` and `en-US`, 1–48 characters each. A noun, not a sentence. No version or "plugin" in the name. |
| Catalog `description` | Required in both locales in the catalog index. One sentence that says what changes for the user ("Shows a break reminder every 30 minutes"). It is the only free text a user sees before installing. |
| `panelView.title` | Up to 48 characters. Shown as the heading of the frame, so name the page's job. |
| Command `title` | Up to 32 characters, a verb phrase ("Remind me now"). Tray labels are plain text, truncated at 32. |
| Setting `title` | Up to 48 characters, or the raw key is shown. Put units in the title ("Interval (minutes)"). Use `minimum`, `maximum`, `maxLength` and `enum` so the form validates for the user. |
| `feed.notify` | Title up to 60, body up to 240. Lead with the event ("Build failed"), not your plugin's name (the source is shown automatically). Use a stable `dedupeKey` for polled events and `priority: "low"` for background chatter. |
| `badge` | At most 6 characters; update at most once per second. Clear it when there is nothing to show. |
| `eventSource.displayName` | Up to 80 characters per language; it names the tool the status row belongs to. |

**Permission reasons.** The manifest has no free-text justification field. Users see a fixed plain-language sentence for each permission, so the way to justify a permission is to request less: pick exact hosts instead of wildcards, declare `links.hosts` instead of network access when you only open pages, and avoid `userGranted` unless hosts depend on the user. The one reason you write is `api.net.requestHost(host, reason)`: a 1–120 character sentence shown in the confirmation, so name the user-visible purpose ("Read release notes from the repository you selected"). Denials silence further prompts for that host for 24 hours.

Write the zh-TW text natively rather than translating word for word, and keep both in sync.

## Liquid Glass and design tokens for panel pages

The host draws the glass: the frame is the functional layer. Your page is the **content layer**, so:

- Do not add `backdrop-filter` or your own blur; glass inside glass is rejected by the design contract. Use flat fills.
- Load `agent-pets://plugin/_shared/tokens.css` (the app's own token file, read-only) and style with tokens only, with fallbacks for standalone preview. The page does not receive the app's light/dark switch, so it gets the default dark palette; set `color-scheme: dark`.
- The page view starts transparent. Give `body` `background: var(--surface-panel)` (translucent dark) for a self-contained look, or leave it unpainted to show the host surface.

| Need | Tokens |
|---|---|
| Surfaces | `--surface-panel`, `--surface-raised`, `--surface-raised-hover`, `--surface-sunken`, `--surface-overlay` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-danger`, `--text-success`, `--text-warning` |
| Borders | `--border-subtle`, `--border-strong`, `--border-accent` |
| State colors | `--state-success`, `--state-warn`, `--state-error`, `--state-info` |
| Type | `--font-xs` (11px floor) to `--font-2xl`, `--weight-normal`, `--weight-medium`, `--weight-bold`, `--font-ui` |
| Space and shape | `--space-1` to `--space-5` (4px base), `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill` |
| Interaction | `--hit-min`, `--focus-ring-color`, `--focus-ring-width`, `--focus-ring-offset`, `--transition-fast`, `--transition-base` |

Accessibility is your page's job: keep text at 11px or larger, show a visible `:focus-visible` ring, keep touch targets at `--hit-min` or larger, honor `prefers-reduced-motion` (animate sparingly), and do not convey state by color alone. Keep content readable at the minimum width of 320 px.
