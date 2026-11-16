# 1.14.3 工作階段時間軸排序與固定的對話框標題列

- **基準 commit**：`22d3f35`（`main`，版本 1.14.2）
- **分支**：`fix/session-timeline-order-sticky-close`
- **版號**：使用者已指示完成後升 patch，版本 1.14.3。

## 問題

- History → Sessions 的工作階段時間軸只能由舊到新排，最新進度在最下面，一打開就得往下捲。
- 對話框整個表面一起捲動，捲到底後右上角的關閉鈕已經捲出畫面，想關閉還要捲回頂端。

## 修正

- `src/utils/history-timeline.ts`（新）：`buildTimelineRows(entries, endAt, order)`。持續時間一律依時間順序單趟 O(n) 計算（每筆到下一筆，最後一筆到 `lastSeenAt`，結束狀態為 `null`），倒序只反轉一次新陣列，不做排序；`key` 取自時間順序索引，切換順序時保持穩定。抽成 util 是為了讓 Node 單元測試能直接載入。
- `src/components/growth/HistorySessionDetail.vue`：「時間軸」標題旁加既有的 `SegmentedControl`（radio，最新在前／最早在前），預設最新在前；切換不同工作階段時保留使用者的選擇，不寫入持久化儲存。沒有紀錄時不顯示切換鈕。
- `src/components/ui/Dialog.vue`：共用修正，所有對話框一起受惠。說明與預設 slot 包進 `.body` 捲動區，`.dialog` 改 `overflow: hidden`，標題列（含關閉鈕）與頁尾固定。`.body` 用等量負外距與內距避免裁掉焦點框；`size-full` 的 `.body` 不捲動，主題編輯器維持只有一層捲軸。
- i18n：`growth.sessionTimelineOrder`、`growth.sessionTimelineNewestFirst`、`growth.sessionTimelineOldestFirst`，zh-TW 與 en-US 同步。

## 對話框使用者稽核

`HistorySessionDetail`、`ConfirmDialog`、`MyPanelThemes`（改名表單＋頁尾）、`PetImportDialog`、`PanelThemeEditor`（`size="full"`，`.editor` 自己捲動）逐一核對；沒有任何使用者覆寫 `.dialog` 內部樣式或用 `:deep`。`overlay` slot 仍在對話框表面外、scope 內，巢狀對話框與 inert 行為不變；`useDialogA11y` 的焦點陷阱掛在同一個元素上。

## 驗證

| 項目 | 結果 |
|---|---|
| `pnpm exec vue-tsc --noEmit` | 0 error |
| `pnpm lint`（含 `typecheck:tests`） | 通過 |
| `git diff --check` | 通過 |
| `pnpm test:unit` | 1847 tests、1808 pass、0 fail、39 skip |
| `pnpm exec vite build` | 通過（升版後） |

新增測試：`tests/history-timeline.test.mts`（倒序／正序、持續時間與 key 不受順序影響、最後一筆與結束狀態、輸入不被改動、預設 `'desc'` 與切換鈕存在）；`tests/dialog-a11y.test.mts` 加結構測試（`<header>`、`<footer>` 在 `.body` 外，說明與 slot 在 `.body` 內，`overlay` 在表面外）。

## 安全審查

- 沒有新增 IPC、HTTP 端點、檔案寫入、權限路徑或持久化 schema。
- 新 UI 文字皆為靜態 i18n 字串，不顯示 prompt、路徑或憑證。
- 視覺變更只調整版面與捲動，沿用既有表面、模糊與降低透明度設定，符合 Liquid Glass 規則。

## 殘留風險

- 沒有啟動 Electron 實機目視確認各對話框，靠結構測試與 CSS 稽核。
- 只在 Windows 上驗證。

**建議版號：patch 1.14.3**。UI 行為修正，沒有改持久化 schema、公開契約或安全邊界。
