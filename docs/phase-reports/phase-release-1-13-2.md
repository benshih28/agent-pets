# 1.13.2 整合輪報告

## 範圍

五條工作線各自在 worktree 完成、經獨立複審後合併成單一 PR，版本由 1.13.1 升到 1.13.2（patch）。各線細節見各自的階段報告：

| 線 | 內容 | 報告 |
|---|---|---|
| 1 | hook 事件補齊（壓縮、結構化通知）、啟動期權限請求重試、App 內安裝改非同步、啟動標記 | `phase-hooks-reliability.md` |
| 2 | `runtime.ts` 拆出 plugin runtime、plugin catalog、growth、面板幾何；本機用量寫入批次；`bench:lag:check` | `phase-main-runtime-split.md` |
| 3 | renderer 結構拆分（agentStore、DesktopPet 等）、設計 token 收尾 | `phase-renderer-cleanup.md` |
| 4 | 選用式簽章與公證、NSIS 與 Linux 套件、三平台 CI 冒煙測試、ESLint 9、依賴升級 | `phase-packaging-ci.md` |
| 5 | App 更新檢查（只通知）、額度預測、成長重設與資料庫整理、Windows 切換到 App | `phase-1-13-2-line5-features.md` |

## 整合複審後修正的問題

- 線 1：設定檔 read-modify-write 改為寫回前比對、不一致時重新合併；啟動標記不覆蓋仍存活實例的標記；權限 token 改原子寫入；安裝佇列不再把前一個結果當參數；健康檢查改非同步。
- 線 2：隔離啟動腳本在埠被佔用而中止時移除暫存根目錄。
- 線 3：`pet-ghost-fade` 的 `animation` 簡寫誤用自帶 easing 的 `--transition-fast`（整條宣告失效），改回字面時長。
- 線 4：簽章 secret 與發版限定 `main`；冒煙測試加連線逾時與總看門狗；打包重試只針對下載或網路錯誤；`XAUTHORITY` 加進隔離啟動的環境白名單；文件與實際行為對齊。
- 線 5：HWND 正規化、Win32 `BOOL` 改 `int`；檢查失敗不再蓋掉已知的新版；成長重設改用主程序發的一次性 token；資料庫整理在各資料庫之間讓出事件迴圈並先檢查可用空間。
- 整合：`agent-hook-delivery` 的計時測試改為相對於同機量到的 node 啟動基準；補上埠佔用探測與成長獎勵廣播的測試，主程序行覆蓋率維持在 85% 門檻以上。

## 驗證（整合分支，macOS）

- `pnpm exec vue-tsc --noEmit`、`pnpm lint` 通過。
- `pnpm test:unit` 1,781 項無失敗；`pnpm test:coverage` 行覆蓋率 85.49%（門檻 85%）。
- `pnpm check:design:strict`、`pnpm check:contrast`、`pnpm exec vite build`、`pnpm check:bundle`、`pnpm check:bundle-size`、`pnpm bench:lag:check` 通過。
- `pnpm test:smoke`（隔離 HOME、假的 safeStorage）：事件 204、renderer 顯示工作階段、正常退出。

## 殘餘風險

- Windows 與 Linux 未實機驗證：切換到 App、NSIS 安裝版、AppImage／deb、更新檢查與資料庫整理的介面；清單在 `docs/ux-overhaul/windows-todo.md`。AppImage 在 Ubuntu 24.04 可能因 sandbox 限制無法啟動。
- 簽章、公證與 Authenticode 未實跑（未設定 secret）；沒有 secret 時的發版路徑與 1.13.1 相同，但 workflow 的變更要到 GitHub Actions 上才會第一次執行。啟用簽章時建議一併建立有分支限制的 `release` environment，見 `docs/dev/release-signing.md`。
- 更新檢查沒有連過真正的 GitHub API，只用假回應驗證。
- 主程序行覆蓋率只高出門檻 0.49 個百分點；`plugin-runtime.ts` 的組裝段落（約 25%）是主要缺口。
- 各線的新介面各自在隔離 Electron 走過，整合後只跑了冒煙測試，沒有再逐一走一遍。

## 版本

Patch：沒有破壞既有公開契約或持久化 schema 的不相容變更；新增的 IPC、設定與 hook 事件皆為加法。
