# Security checklist

Treat every plugin as untrusted code. Request only the hosts, secrets, and API permissions you need, and process the minimum user data necessary.

- Never put credentials in source, `plugin.json`, logs, notifications, error messages, or sample packages. Ask the user to save credentials in the plugin panel, then read them with `api.secrets.get`. Secrets are encrypted with the operating system's secure storage; ordinary settings never include secret values.
- Do not log Authorization headers, API tokens, or private user data. Logs remain in the local diagnostics panel.
- Network access must use `api.net.fetch`. Direct Web API connections are unavailable. Every redirect (up to three) rechecks HTTPS, the granted host, and public DNS. `requestHost` requires user consent; dynamic grants can be revoked in the panel.
- A panel may open only exact HTTPS hosts declared in `permissions.links`, through `links.openExternal`, after a current trusted user activation. It never receives `shell`, navigation, or arbitrary IPC access.
- Plugin network requests do not send or store cookies. Use an `authorization` header and a declared secret for APIs that require authentication. Secret values are never included in `settings.onChange` events; call `api.secrets.get` from the callback when needed.
- DNS is checked before each request. HTTPS-only, port 443, and TLS certificate validation mitigate a DNS rebinding race between the check and connection, but do not eliminate it; this remains a known residual risk.
- A plugin cannot read another plugin's storage, secrets, or runtime state. Users can disable plugins, revoke dynamic hosts, or remove a plugin; removal deletes its secrets.
- Manifest permission changes require renewed consent. Developer mode is off by default. While it is on, only folders explicitly selected by the user are loaded, and changes are revalidated. Do not load an untrusted development folder.

The sandbox does not make plugin code trustworthy. Report error codes without exposing local paths or credentials.

## Before you publish

- [ ] Every permission and contribution in `plugin.json` is used by the code; remove the rest.
- [ ] Hosts are exact names (no wildcard unless every subdomain is needed); `links.hosts` is used instead of `network.hosts` when you only open pages.
- [ ] No credentials, tokens or personal paths in source, manifest, logs, notifications or error messages.
- [ ] Secrets are read with `api.secrets.get` at the moment of use and never copied into storage, settings, logs or panel messages.
- [ ] Data from the network is treated as untrusted: it is escaped before going into panel HTML (use `textContent`, not `innerHTML`) and never evaluated.
- [ ] Notification text and `link` values come from known sources; links point to hosts you declared.
- [ ] Polling respects the limits (network per minute, feed per 10 minutes, 16 schedules) and backs off on `rate_limited` and `Retry-After`.
- [ ] The package contains only files you intend to ship, and the final archive is the one you signed and hashed.
- [ ] The release notes list added permissions. Updates that add network, link or secret permissions, or change the signing key, need extra user acknowledgement.
- [ ] The private signing key is not in the repository, the package or the registry.

## Panel themes

Themes are data only. The host parses every colour with a closed grammar and re-emits `rgb(R G B / A)`, family names and sizes itself, and the renderer re-checks names against an allowlist before `style.setProperty`; no plugin string, `url()`, `var()` or remote URL reaches CSS. Fonts (`.woff2`, magic-checked) are parsed only by Chromium's sanitiser in the panel renderer. Images are header-checked (dimensions, pixels, animation, orientation) before anything decodes them and are served only through `agent-pets://panel-theme/<token>` with per-session tokens, which plugin pages and Workers cannot reach. User-imported backgrounds are picked in a native dialog, read once and validated in memory, stored as `userData/panel-theme-images/<plugin>/<sha256>` (0o700/0o600), never shown to the plugin, and deleted on clear or plugin removal. There are no protected regions: permission and risk prompts, the install sheet, plugin content frames, confirmation dialogs and the pet window follow the theme, and the host instead proves before accepting it that every text colour is readable on every surface it can appear on (including the pet bubbles and pill over black and white desktops), that the focus ring stays visible and that danger/success/warn/info keep their hue and stay apart from each other and from the accent. Layout, labels, risk-badge text and hold-to-allow are host code. A ≥ 0.50 image overlay keeps pictures of buttons recognisable as wallpaper.

**Reading the theme.** `theme.get()`, `theme.onDidChange()` and the `--ap-*` properties on panel pages need no permission: they carry only the display colours, radii, font-family names and scale the user already sees, identical for every plugin, with no plugin or theme id, font alias, image, path or user background. Values are host-built and re-validated (fixed names, `rgb()`/`px`/family/number grammars) before the preload writes them with `style.setProperty`. The panel reports its light/dark mode to main over a one-way, panel-main-frame-only channel; changes reach Workers and the open panel page at most once per 100 ms burst. A plugin could infer which theme is active by comparing colours; this is accepted as display information.
