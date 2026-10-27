# 插件問題回報

每個已安裝插件都有「回報問題」操作。主程序使用設定好的 HTTPS GitHub `/issues/new` 網址組成回報連結，只附上插件 ID、已安裝版本；若插件不在最近載入的目錄中，標題會加上本機安裝標記。不會附加使用者資料、檔案路徑或插件 log。

宿主固定開啟專案的 issue 表單：`https://github.com/Ponpon55837/agent-pets-plugins/issues/new`。網址標題只包含插件 ID 與已安裝版本。隔離 Electron 測試啟動器可透過 `__agentPetsE2E.pluginIssueReportBaseUrl` 覆寫基礎網址；正式版不讀取環境變數。

隔離 Electron 啟動器會把 `shell.openExternal` 換成記錄器。端對端檢查可讀取 `globalThis.__agentPetsE2E.shellOpenExternalCalls`，不會啟動真實瀏覽器。
