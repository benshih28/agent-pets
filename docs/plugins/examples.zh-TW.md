# 範例

這些原始碼只供參考，放在文件資料夾，不會打包或隨 App 發佈。每個範例的 `plugin.json` 都由測試呼叫正式 `parsePluginManifest` 驗證。

- [hello-feed](examples/hello-feed/)：入門教學的完成版；載入後顯示一則泡泡。
- [github-pr-watch](examples/github-pr-watch/)：示範 manifest host allowlist、`network.userGranted`、`secrets`、`settings`、`schedule` 與 `dedupeKey`。設定面板需存入 `githubToken` secret；若無 token，GitHub API 可能有較低的匿名速率上限。範例不記錄 token。
- [event-source-status](examples/event-source-status/)：送出短暫的 observe-only 狀態，並以插件來源標籤獨立顯示，不進入內建 Agent 狀態。
- [panel-demo](examples/panel-demo/)：在設定面板讀取插件儲存資料，並與背景 Worker 互傳訊息。
- [pomodoro](examples/pomodoro/)：25 分鐘專注提醒，只使用 Agent 狀態、排程、通知與徽章 API。
- [skin-pack](examples/skin-pack/)：只有寵物外觀的插件套件，不含 `entry` 或 Worker。

先照[入門教學](getting-started.zh-TW.md)建立 `hello-feed`，再閱讀[API 參考](api-reference.zh-TW.md)與[安全須知](security.zh-TW.md)。
