# 打包與版本

套件是 zip 檔，副檔名必須為 `.agentpet-plugin`；ZIP 根目錄須直接包含 `plugin.json` 與 `entry` 指定的檔案，例如：

```text
hello-feed.agentpet-plugin
├── plugin.json
└── dist/main.js
```

允許檔案副檔名：`.js`、`.json`、`.png`、`.webp`、`.html`、`.css`。總解壓大小最多 5 MB、最多 64 個檔案、每檔最多 5 MB；`plugin.json` 最多 256 KB。拒絕 traversal、重複路徑、符號連結、未知副檔名及不在允許位置的 HTML。資料夾載入也套用同一個嚴格驗證。

`version` 僅接受 `major.minor.patch` 整數格式。新版本顯示「更新」，較低版本顯示「降版」，相同版本顯示「重新安裝」。權限增加時會列出新增項目並要求重新同意；拒絕會保留舊版。插件新安裝預設停用。

目前只接受 `apiVersion: "1"`。其他 API 主版本會顯示不相容並拒絕安裝；目前尚未公告跨主版本過渡期。開發者模式資料夾修改 debounce 500ms 後重新驗證與載入；它不會自動簽章或打包，仍需自行建立 `.agentpet-plugin`。

線上目錄可列出相容的新版本。使用者按下「更新」前不會下載套件。下載後的安裝確認會檢查 manifest，顯示新增權限或簽章金鑰變更，再由使用者決定是否同意。選用的每日檢查只讀取目錄索引，不會下載或安裝套件。
