# Agent Pets 插件開發者手冊

插件在隔離的背景 Worker 執行，也可選擇在設定的插件區加入沙箱頁面。插件能顯示寵物通知、要求寵物反應、加入由使用者觸發的面板／Tray 指令、顯示狀態徽章、提供寵物外觀與面板主題、讀取已授權的 Agent 狀態，並發布清楚標示來源的唯讀狀態。插件也能使用受控網路、密鑰、設定、排程與私有儲存。插件不能使用 Node.js、檔案系統、shell、任意網路或其他插件的資料。Host API 主版本為 `apiVersion: "1"`。

使用者在**設定 → 整合與進階 → 插件**安裝 `.agentpet-plugin` 套件；開發時開啟開發者模式即可直接載入資料夾。插件是不受信任的程式碼，安裝前一定會列出它要求的權限。

## 學習路線

1. [5 分鐘快速開始](getting-started.zh-TW.md)：做出一個會顯示通知的插件。
2. [核心概念](concepts.zh-TW.md)：Worker 沙箱、Host RPC、manifest、貢獻點、權限與同意。
3. [逐步教學](tutorial.zh-TW.md)：做出含通知、指令、設定與面板頁的插件。
4. [UX 指南](ux-guidelines.zh-TW.md)：插件在 App 中如何呈現，以及標題、說明與權限理由的寫法。
5. [測試與除錯](debugging.zh-TW.md)：開發者模式、診斷、紀錄。
6. 上線：[打包與版本](packaging-and-versioning.zh-TW.md)、[簽章與線上目錄](signing.zh-TW.md)、[發布至線上目錄](publishing.zh-TW.md)。
7. [安全檢查清單](security.zh-TW.md)。
8. [常見問題與疑難排解](faq.zh-TW.md)。

## 參考

- [Manifest 欄位](manifest.zh-TW.md)與 [JSON Schema](plugin.schema.json)
- [Host API 參考](api-reference.zh-TW.md)與 [TypeScript 宣告](agent-pets-plugin.d.ts)
- [畫面貢獻點](contribution-points.zh-TW.md)
- [面板主題](panel-themes.zh-TW.md)
- [1.12 新功能](whats-new-1.12.zh-TW.md)
- [權限與同意畫面](permissions.zh-TW.md)
- [沙箱](sandbox.zh-TW.md)
- [資源與速率限制](limits.zh-TW.md)
- [通知行為](notifications.zh-TW.md)
- [自訂面板頁](panel-view.zh-TW.md)
- [插件問題回報](reporting.zh-TW.md)
- [範例](examples.zh-TW.md)

文件中的範例放在 `examples/`，只供作者參考，不會打包或隨 App 發佈。
