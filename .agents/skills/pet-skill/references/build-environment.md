# 建置與本機環境 runbook

這份 runbook 是 Agent Pets 後續每個 Phase、測試與發行工作的共同環境規則。

## 建置前程序清理

`pnpm build` 與 `pnpm electron:build` 會先執行 `scripts/stop-agent-pets.mjs`。Windows 上它只會關閉能以本專案路徑確認的程序：

- `release\\win-unpacked\\Agent Pets.exe`；
- 本專案 `release` 目錄下的 `AgentPets-*.exe`；
- 使用本專案 `node_modules\\electron\\dist\\electron.exe` 且 command line 指向本專案的開發程序。

它不會用程序名稱 `electron.exe` 做廣泛終止，也不會關閉其他專案、已安裝版本或 `pnpm dev`／Vite。若程序仍無法關閉，preflight 會停止建置並回報，避免半成品覆寫或檔案鎖定。

## pnpm 與依賴修復

### Windows 開發版 GPU 安全模式

- `vite-plugin-electron@1.1.1` 的預設 `startup()` 參數包含 `--no-sandbox`。`vite.config.mts` 必須為 main 與 preload 的 `onstart` 都明確傳入 `['.']`；simple plugin 的首次啟動可能由任一 build 完成後觸發，只改其中一個入口不足以固定啟動參數。
- 硬體加速預設開啟。受 Chromium GPU process crash 影響的 Windows 電腦直接執行 `pnpm dev:safe`；不可要求使用者建立 `.env.local`，也不可把 safe mode 擴大到一般 `pnpm dev`、正式打包版本、macOS 或 Linux。
- safe mode 由 Vite mode 選擇，只把內部偏好傳給 Electron child process，不使用 `VITE_` 前綴且不暴露給 renderer。Electron main process 必須同時確認 `win32`、未打包、存在 `VITE_DEV_SERVER_URL` 與明確 safe-mode 偏好，才可在 `ready` 前呼叫 `app.disableHardwareAcceleration()`。

- 專案固定使用 `pnpm@12.8.1` 與 `pnpm-lock.yaml`；不可新增 `package-lock.json`。
- 依賴安裝要保留 devDependencies、scripts 與 electron-builder 設定。不可用 production-only 安裝、prune 或其他會把 `package.json`／lockfile 縮成 runtime-only 的流程修復開發環境。
- Windows 若需要離線重建，優先使用使用者層級 store（目前環境為 `C:\\Users\\dgh\\AppData\\Local\\pnpm\\store\\v11`）：

  ```powershell
  $env:CI = 'true'
  $env:npm_config_confirmModulesPurge = 'false'
  pnpm.cmd install --offline --frozen-lockfile --reporter=append-only
  ```

- 不要在專案內建立或保留 `.pnpm-store`；不要為了顯示設定而修改全域 MCP 設定。
- 若 `node_modules/electron/dist/electron.exe` 不存在，先確認 Electron cache 的 zip checksum，再執行該版本的 Electron install script；不要拿 packaged Agent Pets exe 當 Node interpreter。

## 每次修復後的 gate

依序執行：

1. `pnpm.cmd exec vue-tsc --noEmit`（目前 package.json 沒有另設 `type-check` script）；
2. `pnpm.cmd test:unit`；
3. `pnpm.cmd build`；
4. `git diff --check`、`git status --short`，確認沒有 lockfile、生成物或 `.claude/` 的非預期變更；
5. 若涉及 packaged runtime，確認 `release\\win-unpacked\\Agent Pets.exe` 可啟動並在檢驗後關閉。

Phase report 必須記錄每個 gate 的實際結果、未測平台與殘餘風險。不得把「HTTP 204」、「靜態設定」或單純 type-check 當成實際桌面流程證據。

## 自動發版

- `.github/workflows/release.yml` 在 `main` 的 `package.json` 版本號變更、且 `v<version>` tag 尚不存在時觸發：Ubuntu 跑 `vue-tsc` 與單元測試，`macos-latest` 打包 arm64 + x64 dmg（`AgentPets-${version}-${arch}.dmg`），`windows-latest` 打包 portable exe，最後以 `gh release create` 建立 `v<version>` tag 與 Release。
- 所以升版 commit 合併進 `main` 就等於發版；版本號仍須依 phase gate 在使用者確認後才改。
- CI 直接呼叫 `vite build` 與 `electron-builder --publish never`，不經過 `pnpm build` 的程序清理 preflight。
- 目前沒有簽章憑證，`CSC_IDENTITY_AUTO_DISCOVERY=false`，產出未簽章版本。
- 舊版 release 使用 `Windows_x.y.z`／`MacOS_x.y.z` 分開的 tag；自動化之後統一為 `v<version>` 單一 release。

## UI 語言要求

繁體中文是後續使用者介面的必要語言，不是只寫在文件裡的偏好。新增或修改設定、Tray、通知、HUD、錯誤與 onboarding 文案時，必須同步提供繁體中文；跨平台 fallback、字串 key 與未來 i18n 抽離要維持同一語意。若當前 Phase 不包含完整 i18n，至少要在 phase report 標註尚未涵蓋的畫面，不得新增只存在英文的使用者可見功能。
