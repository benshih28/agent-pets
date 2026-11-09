# 教學：做一個休息提醒

你將做出**休息提醒**：依排程發出寵物通知，在 Tray 與詳情頁提供「現在提醒我」指令，讓使用者設定間隔與提醒內容，並有一個顯示計數的小面板頁。完成版放在 [`examples/break-reminder`](examples/break-reminder/)。它的結構與用到的 API，和測試用的 fixture `tests/fixtures/plugins/ok-commands`、`ok-panel` 相同，所以這裡的內容都有被儲存庫測試涵蓋。

前置條件：先完成 [5 分鐘快速開始](getting-started.zh-TW.md)，知道如何在開發者模式載入資料夾。

```text
break-reminder/
├── plugin.json
├── dist/main.js
└── ui/
    ├── index.html
    ├── panel.css
    └── panel.js
```

## 1. 宣告 manifest

```json
{
  "id": "break-reminder",
  "name": { "zh-TW": "休息提醒", "en-US": "Break reminder" },
  "version": "1.0.0",
  "apiVersion": "1",
  "author": "Agent Pets example",
  "entry": "dist/main.js",
  "permissions": {
    "storage": true,
    "schedule": { "minIntervalSec": 60 }
  },
  "contributes": {
    "feed": true,
    "settings": { "type": "object", "properties": {
      "intervalMinutes": { "type": "number", "title": { "zh-TW": "提醒間隔（分鐘）", "en-US": "Reminder interval (minutes)" }, "minimum": 5, "maximum": 120, "default": 30 },
      "message": { "type": "string", "title": { "zh-TW": "提醒內容", "en-US": "Reminder text" }, "maxLength": 120, "default": "Stretch, drink some water, rest your eyes." }
    } },
    "commands": [ { "id": "remind-now", "title": { "zh-TW": "現在提醒我", "en-US": "Remind me now" } } ],
    "tray": { "commands": ["remind-now"] },
    "panelView": { "entry": "ui/index.html", "title": { "zh-TW": "休息提醒", "en-US": "Break reminder" }, "preferredSize": { "width": 420, "height": 320 } }
  }
}
```

各部分的用途：

- `storage` 讓計數在重新啟動後仍保留；`schedule` 允許使用 `api.schedule.every`（最小間隔不會低於 30 秒）。
- `feed` 允許 `api.feed.notify`。`settings` 會在詳情頁產生表單；每個欄位都需要雙語 `title`，否則會顯示欄位鍵名；預設值由 `api.settings.get()` 套用。
- `commands` 宣告使用者可觸發的指令；`tray` 列出最多五個要放進 Tray 子選單的指令 id。
- `panelView` 指向套件內的 HTML 檔。

儲存庫中的 manifest 會由 `tests/plugin-public-docs.test.mts` 以正式的驗證器檢查。

## 2. 撰寫 Worker

`dist/main.js`：

```js
export default {
  async activate(api) {
    const stored = await api.storage.get('count')
    let count = stored.found ? Number(stored.value) || 0 : 0
    let cancel = null

    const remind = async (reason) => {
      const { message } = await api.settings.get()
      count += 1
      await api.storage.set('count', count)
      await api.feed.notify({ title: 'Time for a break', body: String(message), dedupeKey: `break-${Date.now()}` })
      await api.ui.postMessage({ type: 'break:state', count, reason })
    }

    const start = async () => {
      if (cancel) cancel()
      const { intervalMinutes } = await api.settings.get()
      cancel = api.schedule.every(Number(intervalMinutes) * 60, () => remind('schedule'))
    }

    await start()
    api.settings.onChange(() => { void start() })
    api.commands.onInvoke(async (commandId) => {
      if (commandId === 'remind-now') await remind('command')
    })
    api.ui.onMessage(async (message) => {
      if (message?.type === 'break:get') await api.ui.postMessage({ type: 'break:state', count, reason: 'sync' })
      if (message?.type === 'break:remind') await remind('panel')
    })
  },
}
```

重點：

- `schedule.every` 會回傳取消函式；設定改變時要先取消再重建。上一次的非同步回呼尚未結束時，Host 會跳過這一次觸發；每個插件最多 16 個排程。
- `settings.onChange` 在使用者儲存表單時觸發，不會帶出密鑰值。
- 指令只會來自使用者（詳情頁或 Tray），插件無法自行觸發。
- 面板關閉時 `ui.postMessage` 會 resolve 成 `{ delivered: false }`，所以面板開啟時要主動索取狀態（`break:get`）。
- 通知預設每個插件每 10 分鐘最多 5 則。連續按「現在提醒我」會被 `rate_limited` 拒絕，錯誤會出現在**診斷**。

## 3. 撰寫面板頁

`ui/index.html` 先載入共用設計 token，再載入自己的 CSS 與模組腳本：

```html
<link rel="stylesheet" href="agent-pets://plugin/_shared/tokens.css">
<link rel="stylesheet" href="./panel.css">
<script type="module" src="./panel.js"></script>
```

`ui/panel.js` 使用 `window.agentPetsPlugin`，也就是 API 的面板子集：

```js
const api = window.agentPetsPlugin
api.ui.onMessage((message) => {
  if (message?.type === 'break:state') document.querySelector('#count').textContent = `Reminders sent: ${message.count}`
})
document.querySelector('#remind').addEventListener('click', () => api.ui.postMessage({ type: 'break:remind' }))
await api.ui.postMessage({ type: 'break:get' }).catch(() => {})
```

完整檔案（含錯誤處理）在範例資料夾。`ui/panel.css` 的顏色、圓角與字族全部取自宿主寫在 `<html>` 上的 `--ap-*` 主題 token（會即時跟著使用者的面板主題與淺色／深色模式），只有間距與字級取自共用的 `tokens.css`；`ui/panel.js` 依 `api.theme.get()`／`onDidChange` 設定 `color-scheme`。見[面板主題](panel-themes.zh-TW.md)與 [UX 指南](ux-guidelines.zh-TW.md)，不要依賴外部網址。

## 4. 載入並試用

1. 開啟開發者模式（**插件 → 進階**），用「從資料夾載入…」選擇 `break-reminder`。
2. 在安裝畫面確認權限清單與你宣告的一致（儲存、排程、通知、面板、指令、Tray），按「同意並安裝」，再按「立即啟用」。
3. 開啟插件詳情頁：**設定**可調整間隔與文字，**指令**可執行「現在提醒我」，**診斷**顯示你用 `api.log` 寫的紀錄與被拒絕的呼叫。
4. 使用 Tray：**休息提醒 → 現在提醒我**。寵物旁會出現氣泡，同一則通知也會出現在**通知**分頁。
5. 按「開啟插件面板」查看頁面；每次提醒後計數都會更新。

修改 `dist/main.js` 並存檔，資料夾會在 500 毫秒後重載。若修改新增了權限，重載會停止，直到你再次同意。

## 5. 測試

用正式的驗證器解析 manifest，與儲存庫測試呼叫的是同一個函式：

```ts
import { parsePluginManifest } from '../electron/plugin-manifest.ts'
const result = parsePluginManifest(JSON.parse(fs.readFileSync('plugin.json', 'utf8')))
assert.equal(result.ok, true)
```

要測試套件層級的行為，可參考 `tests/fixtures/plugins/` 下 fixture 的結構，並用 `node scripts/pack-test-plugin.mjs <fixture-id> <output.agentpet-plugin>` 從 fixture 產生套件。詳見[測試與除錯](debugging.zh-TW.md)。

## 6. 打包與發布

```sh
cd break-reminder
zip -r ../break-reminder.agentpet-plugin plugin.json dist/ ui/
```

接著依序閱讀[打包與版本](packaging-and-versioning.zh-TW.md)、[簽章](signing.zh-TW.md)與[發布](publishing.zh-TW.md)。
