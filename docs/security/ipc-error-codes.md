# Plugin and IPC error codes

The Host API and IPC result codes are declared in `src/types/plugin.ts` and `src/types/ipc.ts`. The unit test `plugin contribution and error registries match their public docs` checks both tables against those constants and checks the public plugin declaration.

## Plugin Host API error codes

| Code | Meaning |
|---|---|
| `not_permitted` | The method is not allowed by the plugin's grant or contribution. |
| `rate_limited` | A rate limit was reached. |
| `invalid_request` | The request did not match the method contract. |
| `too_large` | A configured payload or response size limit was exceeded. |
| `timeout` | The operation timed out. |
| `host_not_allowed` | The network host is outside the declared grant. |
| `disabled` | The plugin or capability is disabled. |
| `queue_full` | A bounded work queue is full. |
| `duplicate` | An equivalent feed item is already present. |
| `not_found` | The requested host resource was not found. |
| `too_many_enabled` | The enabled plugin limit was reached. |
| `host_unavailable` | The required host service is unavailable. |
| `too_many_redirects` | The redirect limit was exceeded. |
| `secret_unavailable` | Secure secret storage is unavailable. |
| `secret_not_found` | The requested secret is not configured. |
| `settings_invalid` | The settings value does not match its schema. |
| `schedule_invalid` | The requested schedule is invalid. |
| `agent_status_unavailable` | Agent status is not available to the plugin. |
| `denied` | The user denied a requested grant. |

## IPC result error codes

| Code | Meaning |
|---|---|
| `not_permitted` | The method is not allowed by the plugin's grant or contribution. |
| `rate_limited` | A rate limit was reached. |
| `invalid_request` | The request did not match the method contract. |
| `too_large` | A configured payload or response size limit was exceeded. |
| `timeout` | The operation timed out. |
| `host_not_allowed` | The network host is outside the declared grant. |
| `disabled` | The plugin or capability is disabled. |
| `queue_full` | A bounded work queue is full. |
| `duplicate` | An equivalent feed item is already present. |
| `not_found` | The requested host resource was not found. |
| `too_many_enabled` | The enabled plugin limit was reached. |
| `host_unavailable` | The required host service is unavailable. |
| `too_many_redirects` | The redirect limit was exceeded. |
| `secret_unavailable` | Secure secret storage is unavailable. |
| `secret_not_found` | The requested secret is not configured. |
| `settings_invalid` | The settings value does not match its schema. |
| `schedule_invalid` | The requested schedule is invalid. |
| `agent_status_unavailable` | Agent status is not available to the plugin. |
| `denied` | The user denied a requested grant. |
| `archive_too_large` | The plugin archive exceeded its limit. |
| `invalid_archive` | The plugin archive was malformed or unsafe. |
| `invalid_manifest` | The plugin manifest was invalid. |
| `incompatible` | The plugin is incompatible with this host. |
| `missing_entry` | The plugin entry file is missing. |
| `missing_icon` | The declared plugin icon is missing. |
| `missing_panel_entry` | The declared panel page is missing. |
| `invalid_html_location` | The panel page is outside the permitted package location. |
| `invalid_icon` | The declared icon is not a valid image. |
| `registry_unavailable` | The installed plugin registry is unavailable. |
| `plan_not_found` | The install plan expired or does not exist. |
| `permission_reconsent_required` | Updated permissions require renewed consent. |
| `signature_invalid` | The package signature is invalid. |
| `signature_confirmation_required` | A signature change requires confirmation. |
| `filesystem_unsafe` | A plugin file path failed a safety check. |
| `install_failed` | The plugin installation did not complete. |
| `plugin_not_found` | The requested installed plugin does not exist. |
| `catalog_disabled` | The online catalog is disabled. |
| `catalog_url_invalid` | The configured catalog URL is not allowed. |
| `catalog_unavailable` | The catalog could not be reached. |
| `catalog_not_found` | The requested catalog entry does not exist. |
| `catalog_invalid` | The catalog response did not match its schema. |
| `download_mismatch` | Downloaded size or digest did not match the catalog. |
| `signature_mismatch` | The catalog signing identity did not match the installed identity. |
| `plugin_not_in_catalog` | The requested plugin version is not in the catalog. |
| `panel_load_failed` | The isolated panel page failed to load. |
| `panel_unavailable` | The panel host is unavailable. |
| `plugin_service_unavailable` | The plugin service is unavailable. |
| `preferences_unsafe` | The preferences file failed a safety check. |
| `secret_consent_required` | Secret access has not been approved. |
| `plugin_action_failed` | The plugin action could not be completed. |
| `dialog_unavailable` | The required dialog cannot be opened. |
| `report_unavailable` | The issue report link is unavailable. |
| `cancelled` | The user cancelled the operation. |
| `unavailable` | The requested resource is unavailable. |
| `write_failed` | The requested write did not complete. |
| `invalid_decision` | The supplied decision is invalid. |
| `conflict` | The request conflicts with the current state. |
| `invalid_project` | The project identifier is invalid. |
| `invalid_pet` | The pet identifier is invalid. |
