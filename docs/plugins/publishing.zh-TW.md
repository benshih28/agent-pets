# 發布插件

線上目錄是靜態 JSON 索引。插件作者將套件與目錄資料送交目錄儲存庫。有效的作者簽章可供使用者驗證發布者金鑰；未簽章套件會明確標示為未驗證。桌面 App 只會在使用者開啟目錄並選擇安裝或更新後下載。

## 準備套件

1. 依照 [Manifest 指南](manifest.zh-TW.md) 與 [JSON Schema](plugin.schema.json) 驗證 `plugin.json`。
2. 建立 `.agentpet-plugin` 壓縮檔，並依[簽章指南](signing.zh-TW.md)簽署最終封裝內容。不要把簽章私鑰放進套件或 commit。
3. 對最終壓縮檔位元組計算 SHA-256。只要套件有任何變更，就必須重新計算摘要並簽章。
4. 將套件放在穩定的 HTTPS 網址。App 只允許從固定公開 host 白名單讀取目錄與套件。

## 新增索引項目

根文件包含 `schemaVersion: 1` 與 `plugins` 陣列；每個插件 id 必須唯一。版本資料記錄確切套件大小、摘要、相容 API 版本、網址與發布時間：

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "id": "hello-feed",
    "name": { "zh-TW": "問候通知", "en-US": "Hello Feed" },
    "description": { "zh-TW": "顯示一則問候通知。", "en-US": "Shows a greeting notification." },
    "author": "Example Author",
    "publicKeyFingerprint": "0123456789abcdef",
    "versions": [{
      "version": "1.0.0",
      "apiVersion": "1",
      "url": "https://raw.githubusercontent.com/example/plugins/main/packages/hello-feed-1.0.0.agentpet-plugin",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "size": 1234,
      "publishedAt": "2026-10-26T00:00:00.000Z"
    }]
  }]
}
```

索引最多 1 MiB、500 個插件、每插件 20 個版本；套件最多 25 MiB。`sha256` 是 64 個小寫十六進位字元，`size` 是壓縮檔的 byte 數。指紋是 Ed25519 原始公鑰的 SHA-256 小寫十六進位前 16 碼。已發布版本不可原地替換套件、摘要、網址或簽章金鑰；請改以新版本發布。

## 提交審查

1. 在目錄儲存庫開啟 Pull Request，附上套件與索引項目。
2. 確認壓縮檔大小與 SHA-256 符合索引、簽章有效、Manifest 格式正確，套件網址皆使用白名單中的 HTTPS host。
3. 請審查者對照程式與版本說明，檢查宣告的權限與貢獻是否合理。
4. 審查通過後才合併。App 不會在背景安裝；使用者仍要選擇插件，並確認簽章或權限變更。

目錄不是安全認證。作者仍須對插件負責；使用者安裝前可以檢視其宣告權限與簽章指紋。
