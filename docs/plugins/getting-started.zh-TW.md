# 10 分鐘做出第一個插件

本教學使用開發者模式從資料夾載入，最後再打成 `.agentpet-plugin`。插件程式一律視為不受信任；只在自己的測試資料夾執行。

## 1. 建立檔案

在終端機建立 `hello-feed`：

```sh
mkdir -p hello-feed/dist
```

建立 `hello-feed/plugin.json`：

```json
{
  "id": "hello-feed",
  "name": { "zh-TW": "Hello Feed", "en-US": "Hello Feed" },
  "version": "1.0.0",
  "apiVersion": "1",
  "author": "Your name",
  "entry": "dist/main.js",
  "permissions": {},
  "contributes": { "feed": true }
}
```

建立 `hello-feed/dist/main.js`：

```js
export default {
  async activate(api) {
    await api.feed.notify({
      title: 'Hello, Agent Pets!',
      body: 'My first plugin is running.',
      ttlMs: 6000,
      dedupeKey: 'hello-first-run',
    })
  },
}
```

## 2. 從資料夾載入

1. 開啟 Agent Pets 設定的「插件」面板。
2. 在「進階」開啟「開發者模式」。
3. 按「從資料夾載入…」，選取 `hello-feed`（含 `plugin.json` 的目錄）。
4. 檢查安裝確認中的名稱、版本和權限，然後按「同意並安裝」。
5. 開啟插件和全域插件開關。預期主寵物旁出現 Hello 通知泡泡，插件列顯示「開發中」。

## 3. 修改並自動重載

將 `dist/main.js` 的 `body` 改成 `Edited and reloaded.` 並存檔。監看器會 debounce 500ms，再以與套件安裝相同的驗證重載。若新增權限，重載會停止並要求你重新從面板同意；無效檔案不會取代目前已安裝版本。每次啟動 App 後，需再次從資料夾載入才能恢復監看。

## 4. 打包安裝

從 `hello-feed` 目錄建立套件，輸出到上一層，避免監看器把套件檔當成插件內容：

```sh
cd hello-feed
zip -r ../hello-feed.agentpet-plugin plugin.json dist/
```

回到插件面板按「安裝插件…」選擇套件並確認。資料夾載入與套件安裝都使用同一個 manifest、檔案路徑、大小和檔案數驗證。詳見[打包規則](packaging-and-versioning.zh-TW.md)。
