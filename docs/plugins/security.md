# Security

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
