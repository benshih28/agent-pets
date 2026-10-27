# `plugin.json` Manifest

Manifest 根物件只接受下列欄位；未知欄位會拒絕安裝。JSON Schema 在 [`plugin.schema.json`](plugin.schema.json)，但執行時 validator 才是最終判準。

| 欄位 | 必填 | 規則 |
|---|---|---|
| `id` | 是 | 3–48 字元，小寫英數與 `-`；不可為 `_host`／`_shared`。 |
| `name` | 是 | 必須含 `zh-TW`、`en-US`，各 1–48 字元。 |
| `version` | 是 | `major.minor.patch`，非負整數且不含前置零，例如 `1.2.0`。 |
| `apiVersion` | 是 | 目前只支援字串 `"1"`；其他值顯示不相容並拒絕安裝。 |
| `author` | 是 | 1–64 字元。 |
| `entry` | 條件式 | 一般插件必填，為安全相對 `.js` 路徑；只提供 `contributes.skins` 時可省略，且不能要求權限或其他貢獻。 |
| `icon` | 否 | 相對 `.png`／`.webp` 路徑；PNG／WebP 簽章必須有效。 |
| `permissions` | 是 | 物件；可含 `network`、`secrets`、`schedule`、`storage`、`agentStatus`。 |
| `contributes` | 是 | 物件；可含 `feed`、`reaction`、`settings`、`panelView`、`commands`、`tray`、`badge`、`skins`、`eventSource`。 |

`network.hosts` 需 1–20 個唯一 DNS 名稱，可用 `*.example.com` 子網域萬用字元；不可填 IP、localhost 或內部網域。`userGranted` 是可選布林值。`secrets` 最多 10 個唯一 key，格式為英文字母開頭，後接英數或底線，最多 32 字元。`schedule.minIntervalSec` 為整數 30–3600。

`settings` 每個 key 符合 `[A-Za-z][A-Za-z0-9_-]{0,63}`，最多 20 欄位；型別為 `string`、`number` 或 `boolean`。字串上限 4096，`enum` 1–50 個唯一值、字串 enum 項目最多 256 字元。`format: "secret"` 只可用於同名且已宣告的 secret，且不可有 default。`panelView` 的 `entry` 是 `.html` 相對路徑，標題雙語；`preferredSize` 超出寬 320–960、高 240–800 時會被夾到範圍內。`commands` 最多 10 個，id 符合 `[a-z][a-z0-9-]{0,31}`、每個標題雙語且各不超過 32 字；`tray.commands` 最多 5 個且必須引用已宣告 id。`badge` 為布林值。`skins` 最多 5 個，id 符合 `[a-z0-9-]{1,32}`，圖檔為套件內 PNG／WebP，行為 manifest 會經既有安全清理。skin 套件總上限 25 MiB、單圖 20 MiB；無 skins 時仍為 5 MiB。省略 `entry` 時只能提供 skins，且 permissions 必須為空物件。

`eventSource` 含 `family`（最多 80 個 ASCII 字元）與雙語 `displayName`（各語系最多 80 字）。比較前會轉小寫，並把 `_`、空白與 `.` 換成 `-`；內建 family 及 `generic-http`、`agent-pets`、`plugin`、`system` 為保留名稱。更新新增此貢獻時需重新同意。狀態種類與限制見 [API 參考](api-reference.zh-TW.md)。

完整範例見 [`hello-feed`](examples/hello-feed/plugin.json) 與 [`github-pr-watch`](examples/github-pr-watch/plugin.json)。
