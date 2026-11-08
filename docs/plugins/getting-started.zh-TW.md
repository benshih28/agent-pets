# 5 分鐘快速開始

做出一個會顯示通知的插件，在開發者模式從資料夾載入，再打包成套件。插件程式一律視為不受信任；只在自己的測試資料夾執行。下一步：[核心概念](concepts.zh-TW.md)與[逐步教學](tutorial.zh-TW.md)。

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

1. 開啟**設定 → 整合與進階 → 插件**（分頁依序為「已安裝／探索／通知／進階」）。
2. 切到「進階」分頁，開啟「開發者模式」；頁首的安裝按鈕會變成選單。
3. 開啟該選單，選「從資料夾載入…」，選取 `hello-feed`（含 `plugin.json` 的目錄）。
4. 在安裝確認畫面檢查名稱、版本、簽章狀態和依風險分組的權限，然後按「同意並安裝」。
5. 安裝完成的提示會附「立即啟用」；若插件目前全域停用，會一併開啟全域開關。預期主寵物旁出現 Hello 通知泡泡，插件卡片顯示「開發資料夾 · 簽章未驗證」。

## 3. 修改並自動重載

將 `dist/main.js` 的 `body` 改成 `Edited and reloaded.` 並存檔。監看器會 debounce 500ms，再以與套件安裝相同的驗證重載。若新增權限，重載會停止並要求你重新從面板同意；無效檔案不會取代目前已安裝版本。每次啟動 App 後，需再次從資料夾載入才能恢復監看。

## 4. 打包安裝

從 `hello-feed` 目錄建立套件，輸出到上一層，避免監看器把套件檔當成插件內容：

```sh
cd hello-feed
zip -r ../hello-feed.agentpet-plugin plugin.json dist/
```

回到插件面板按「安裝本機檔案…」選擇套件並確認。資料夾載入與套件安裝都使用同一個 manifest、檔案路徑、大小和檔案數驗證。詳見[打包規則](packaging-and-versioning.zh-TW.md)。
