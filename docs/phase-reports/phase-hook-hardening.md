# Hook 強化：冷啟動事件與權限回覆時限（1.12.5）

處理 1.12.4（[phase-hook-delivery.md](phase-hook-delivery.md)）留下的兩個未結項。完整數字與做法比較見 [docs/dev/hook-delivery.md](../dev/hook-delivery.md)。

## 1. app 冷啟動前送出的事件

### 根因

app 啟動後要先建好寵物視窗、插件、權限等服務，最後才綁定事件埠。這段時間送出的狀態事件連線被拒，hook 直接放棄。冷啟動 e2e 分層計數：主程序收到幾個，寵物畫面就收到幾個；遺失的全是連線早於監聽的事件。

### 做法

app 一啟動就寫 `~/.desktop-pet/event-port-<埠>.starting`，事件埠監聽 2 秒後移除。hook 只有在連線被拒時才看這個標記：標記存在且不到 20 秒，就每 100 ms 重試，最多 5 秒。寵物沒開時只多一次 `lstat`；app 開著時完全不多讀檔。同一個 hook 依序重試，同一個 session 的事件順序不變。另外比較過「app 從檔案或 transcript 補讀狀態」與「提早綁定埠」，理由見開發文件。

### 證據

- 回歸測試：埠在 hook 啟動 0.7 秒後才開，修正前事件遺失，修正後送達。
- 冷啟動 e2e（真實 hook，隔離埠 27373，150 個、每 40 ms 一個，同一台機器接著跑）：修正前遺失 23／23／36 個，修正後 13／12／12 個。修正後遺失的都是 main.js 寫入標記（約 0.6 秒）之前就連線的事件；標記寫入到埠開始監聽（約 1.1 秒）之間的事件全部送達。
- 寵物沒開時的 hook 耗時：PreToolUse p50 128.7 → 129.2 ms、117.7 → 117.9 ms，差異在量測誤差內。

## 2. `permissionPost` 仍用 `fetch`

### 證據

12 核 CPU 佔滿（load average 約 90）時，同時跑 120 個 `PermissionRequest` hook：修正前 480 個裡 19 個退回終端機。用探針量到的 `fetch` 最長 1082 ms，伺服器都收到了請求，但 hook 在讀到回應前就放棄。

### 做法

狀態事件與權限呼叫改用同一個 `node:http` helper（`postLocal`），時限分兩段：1500 ms 內送出，之後狀態事件等 250 ms，權限呼叫等 1000 ms 讀回應（上限 16 KiB）。回覆格式、`DENY_MESSAGE`、失敗時退回終端機的行為都不變。同一組條件下，修正後 0／480 退回終端機，p50 從 4.5 秒降到 3.0 秒。

權限回覆模式開啟時，每次 tool 呼叫的 hook 耗時從 p50 138.5 ms 降到 124.0 ms（PreToolUse）、138.7 降到 123.0 ms（PostToolUse）。

## 範圍

- 改動：`integrations/agent-hook.mjs`（送事件的部分）、`electron/main.ts`（寫入與移除啟動標記）、新檔 `electron/main/hook-startup-marker.ts`。
- 沒動：`integrations/install.mjs`、`electron/hook-config.ts`、`electron/setup.ts`、hook 指令的產生方式、1.12.1（`d45ca8d`）的 Codex Windows 指令規則，以及狀態字串與事件格式。
- 同範圍內順手修正：hook 讀 event token 改用與 permission token 相同的 `readSmallFile`（只讀一般檔案、256 bytes 上限），不再跟著 symlink 讀任意大小的檔案。
- 測試與工具：`tests/agent-hook-delivery.test.mts` 新增 4 個測試、新檔 `tests/hook-startup-marker.test.mts`、`tests/claude-permission-hook.test.mts` 的時限 patch 改成對應新常數；`scripts/e2e-real-hook.mts` 加 `--cold-start`，`scripts/e2e-isolated-electron.mjs` 加 `--reuse-root`。

## 資安與效能審查

- 標記只代表「app 正在啟動」，不含 token 或路徑。建立時先刪再用 `wx`，不跟著 symlink 寫；移除前核對 pid。hook 用 `lstat`，只接受一般檔案。
- 能寫 `~/.desktop-pet` 的本機程式可以放一個新標記，讓寵物沒開時的 hook 每次最多多等 5 秒。這需要與使用者相同的權限，而同樣的權限已經能改寫 token 與 hook 本身，所以不算新的攻擊面。
- 權限回應有 16 KiB 上限，避免異常回應把 hook 的記憶體撐大。請求仍只送到寫死的 loopback 網址，不帶 Origin，也不使用 keep-alive。
- 熱路徑：app 開著時，狀態事件的 I/O 次數不變；寵物沒開時多一次 `lstat`；權限回覆模式開啟時，省下 `fetch` 的初始化。

## 殘餘風險

- Electron 程序建立到 main.js 開始執行之間（實測約 0.4–0.5 秒），app 沒有任何程式能寫標記，這段送出的事件仍會遺失，要等下一個事件。
- 權限呼叫在 app 啟動期間被拒時不重試，照舊退回終端機。
- Windows 與 Linux 未實測。Windows 上連線被拒本身可能比 macOS 慢，啟動期間的每次重試也會跟著變慢，但總時間仍以 5 秒為上限。

## 版本

不在本線升版，由整合線統一升 1.12.5（patch）。
