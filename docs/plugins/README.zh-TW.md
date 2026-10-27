# Agent Pets 插件開發

插件在隔離的背景 Worker 執行，也可選擇在設定面板加入沙箱頁面。插件能顯示通知、要求寵物反應、加入由使用者觸發的面板／Tray 指令、顯示狀態徽章、提供寵物外觀、讀取已授權的 Agent 狀態，並發布清楚標示來源的唯讀狀態。插件也能使用受控網路、密鑰、設定、排程與私有儲存。插件不能使用 Node.js、檔案系統、shell、任意網路或其他插件的資料。Host API 主版本為 `apiVersion: "1"`。

在 **Settings → Plugins** 安裝 `.agentpet-plugin` 套件；開發時可開啟 Developer mode 載入資料夾。安裝前請檢查它宣告的貢獻與權限。插件是不受信任的程式碼，網路存取僅限已宣告／核准的 HTTPS 網域。線上目錄安裝與作者簽章都會要求使用者明確確認。請先閱讀[安全須知](security.zh-TW.md)與[10 分鐘入門](getting-started.zh-TW.md)。

## 文件

- [10 分鐘入門](getting-started.zh-TW.md)
- [Manifest 欄位](manifest.zh-TW.md)
- [權限與同意畫面](permissions.zh-TW.md)
- [Host API 參考](api-reference.zh-TW.md)
- [畫面貢獻點](contribution-points.zh-TW.md)
- [沙箱](sandbox.zh-TW.md)
- [資源與速率限制](limits.zh-TW.md)
- [通知行為](notifications.zh-TW.md)
- [除錯](debugging.zh-TW.md)
- [打包與版本](packaging-and-versioning.zh-TW.md)
- [簽章與線上目錄](signing.zh-TW.md)
- [發布至線上目錄](publishing.zh-TW.md)
- [插件問題回報](reporting.zh-TW.md)
- [安全須知](security.zh-TW.md)
- [自訂面板頁](panel-view.zh-TW.md)
- [範例](examples.zh-TW.md)
- [Manifest JSON Schema](plugin.schema.json)
- [TypeScript Host API](agent-pets-plugin.d.ts)

文件中的範例放在 `examples/`，只供作者參考，不會打包或隨 App 發佈。
