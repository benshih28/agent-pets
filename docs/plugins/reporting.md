# Reporting plugin issues

Each installed plugin has a **Report issue** action. The main process builds an HTTPS GitHub issue URL from a configured `/issues/new` base and adds only the plugin ID, installed version, and a local-install label when the plugin is absent from the last loaded catalog. It does not include user details, filesystem paths, or plugin logs.

The host opens the fixed project issue form at `https://github.com/Ponpon55837/agent-pets-plugins/issues/new`. The URL contains only the plugin ID and installed version in its title. The isolated Electron test harness can override the base URL through `__agentPetsE2E.pluginIssueReportBaseUrl`; production builds ignore environment variables for this destination.

The isolated Electron launcher replaces `shell.openExternal` with a recorder. End-to-end checks can inspect `globalThis.__agentPetsE2E.shellOpenExternalCalls` without launching a real browser.
