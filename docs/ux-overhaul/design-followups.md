# Design follow-ups

核對日期：2026-11-10（逐項對照現在的原始碼）。先前的清單中，焦點、對話框、分頁、命中區域、z-index、transition、模糊、字級下限、圖示、ARIA、`Deny`/`Allow once` 字面值、`<kbd>`、`toLocale*String` 都已完成並已移除；這裡只留還沒做完或刻意不做的項目。

## Type scale (DS-04)
- 行高刻度 `--leading-tight/normal/relaxed`（1.2/1.4/1.55）只套用在剛好相符的地方；其餘寫死的 `1.1`、`1.15`、`1.3`、`1.32`、`1.35`、`1.45` 還在 `StatusPanel.css`、`ProjectMcpPanel.css`、`setup-wizard/`、`DesktopPetBubbles.css`、`desktop-pet/` 與少數元件。改成最近的刻度會讓行距位移，需要決定是新增 `--leading-*` 刻度還是接受視覺微調；在決定前維持原值。

## i18n 複數 (DS-18)
`tPlural` 已用在工具家族、插件通知、徽章溢出、未讀結果、工作階段工具／權限等待、掃描略過／延後、權限佇列與全部拒絕、設定搜尋結果數、插件摘要／通知清除／全域停止／托盤／造型／面板主題數，以及權限清單的造型／面板主題數。新 key 的做法：`<key>.one` / `<key>.other` 放在英文；zh-TW 只需 `.other`（`tests/locale-domains.test.mts` 已允許 zh-TW 沒有 `.one`）。

仍是單一 `{count}` 字串的地方：
- `electron/`：`notificationAggregate`（`notification-policy.ts`）、`pluginCatalogAutoCheckFound`（`main/runtime.ts`）。屬於主程序工作線。
- `themeEditor.issueSummary`：走 `te()`，它的 key 型別要求中英兩份完全相同，要先讓 `te()` 支援複數才能改。

刻意保留、不需要改：
- `growth.failedCount`、`growth.agentSuccess/Failure`：英文是「N failed／N succeeded」，沒有名詞複數。
- `growth.achievementMany`：只在兩個以上時使用。
- `plugins.summaryUnread`、`plugins.updateAll`、`plugins.showAllEntries`、`plugins.sheetExistingHeading`、`plugins.cap.panelThemesCount`：數字在括號內或是「N more」，沒有名詞複數。

## 已確認不需要處理
- `electron/main/runtime.ts` 的 `'Presentation MCP'`、`'Permission adapter'`：只是 `listenOnLocalPort` 寫進診斷日誌的標籤，面板的伺服器健康橫幅用的是服務 id 與 locale key，使用者看不到這兩個字串。
