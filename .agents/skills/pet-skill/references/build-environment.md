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
2. `pnpm.cmd lint`（ESLint 9 flat config 加主程序 crash guard 檢查，見下方「Lint」）；
3. `pnpm.cmd test:unit`；
4. `pnpm.cmd build`；
5. `git diff --check`、`git status --short`，確認沒有 lockfile、生成物或 `.claude/` 的非預期變更；
6. 若涉及 packaged runtime，確認 `release\\win-unpacked\\Agent Pets.exe` 可啟動並在檢驗後關閉。

Phase report 必須記錄每個 gate 的實際結果、未測平台與殘餘風險。不得把「HTTP 204」、「靜態設定」或單純 type-check 當成實際桌面流程證據。

## Lint

`pnpm lint` = `eslint .`（快取在 `node_modules/.cache/eslint/`）接 `node scripts/lint-main-process.mjs`（只剩主程序 crash guard 契約檢查），最後是 `pnpm typecheck:tests`（`tsc -p tsconfig.tests.json`：`tsconfig.json` 只涵蓋 `src`、`electron`，`vue-tsc` 不檢查 `tests/`）。設定在 `eslint.config.mjs`，只開 correctness 規則，不含 stylistic／Prettier。

- `src/**` 禁止 `./`、`../` 的 import，一律 `@/`（`../../electron/*` 例外，沒有別名可用）。
- 會被 Node 測試直接載入的 src 檔案（閉包由 `scripts/node-test-closure.mjs` 在 lint 時從 `tests/*.test.mts` 即時計算）相反：值 import 只能用相對路徑，`@/` 只允許 `import type`。測試若 import `tests/support/src-alias.mts`，該測試的閉包不受限制。新增被測試載入的檔案時不用維護任何清單。
- `electron/**` 開 type-aware 的 `@typescript-eslint/no-floating-promises`（取代舊的 `loadURL` 字串比對）；其他目錄不跑 type-aware 規則以保持速度。
- `@typescript-eslint/no-explicit-any` 與其餘規則都是 error（1.14.1 清零存量）。
- `as never`（與 `<never>` 斷言）由 `no-restricted-syntax` 禁止，`src`、`electron`、`tests` 都適用，1.14.1 已清零。`const _exhaustive: never = value` 這類窮盡性檢查是型別註記，不受影響。
- 測試假物件：Electron 物件用 `tests/support/fake-electron.mts`，只呼叫少數方法的服務 class 用 `tests/support/fake-service.mts`，其他依賴照受測函式的依賴介面寫完整物件或 `Pick<…>`。刻意餵給嚴格型別參數、執行期驗證應拒絕的非法值用 `tests/support/invalid.mts` 的 `invalid<T>()`；參數本來就是 `unknown` 時直接傳值。`as unknown as` 只能出現在 support helper，或附上說明理由的註解。測試的暫存目錄用 `tests/support/temp-dir.mts` 的 `removeTempTree` 清理（Windows 檔案鎖會讓沒有重試的 `rmSync` 偶發 EPERM）。
- 不要讓測試 import `vite.config.mts`：vite 的宣告檔會帶進第二份 `@types/node`，讓 tests 的型別檢查出現大量假錯誤；要測的啟動邏輯放在 `electron/dev-runtime.ts`。

## 自動發版

- `.github/workflows/release.yml` 在 `main` 的 `package.json` 版本號變更、且 `v<version>` tag 尚不存在時觸發：Ubuntu 跑 `vue-tsc` 與單元測試，`macos-latest`（arm64）與 `macos-15-intel`（x64）各自打包同架構的 dmg（`AgentPets-${version}-${arch}.dmg`），`windows-latest` 打包 portable exe（`AgentPets-${version}.exe`）與 NSIS 安裝版（`AgentPets-Setup-${version}.exe`），`ubuntu-latest` 打包 Linux x64 的 AppImage 與 deb，最後產生涵蓋所有產出物的 `SHA256SUMS.txt` 並以 `gh release create` 建立 `v<version>` tag 與 Release。所有 action 固定到 commit SHA（行尾註明版本），checkout 不保留憑證。
- 所以升版 commit 合併進 `main` 就等於發版；版本號仍須依 phase gate 在使用者確認後才改。
- CI 直接呼叫 `vite build` 與 `electron-builder --publish never`，不經過 `pnpm build` 的程序清理 preflight。
- 簽章有兩條路，由 repository secrets 決定（設定方式、secret 名稱與驗證見 `docs/dev/release-signing.md`）：
  - **沒有 secret（預設）**：`CSC_IDENTITY_AUTO_DISCOVERY=false`，`package.json` 的 `mac.identity` 是 `"-"`：electron-builder 26 在寫入 fuses 之後才簽章，整個 bundle 會被 ad-hoc 簽章並密封（不公證）。Windows 不簽章。不要改成 `afterPack` 自行簽章，那時 fuses 還沒寫入。
  - **有 secret**：`MACOS_CERTIFICATE_P12`／`MACOS_CERTIFICATE_PASSWORD` 都在時，Package 步驟設 `CSC_LINK`／`CSC_KEY_PASSWORD`，並以 CLI 覆寫 `--config.mac.identity=`（空字串，讓 electron-builder 從暫時鑰匙圈自動挑 Developer ID Application；`null` 是「不簽章」，不能用）、`--config.forceCodeSigning=true` 與 `build/entitlements.mac.developer-id.plist`（只有 `allow-jit`，不叫 `entitlements.mac.plist` 是為了不影響 ad-hoc 路徑）。再加上 `APPLE_API_KEY_P8`／`APPLE_API_KEY_ID`／`APPLE_API_ISSUER` 才公證（electron-builder 簽章後對 `.app` 公證並 staple，再封裝 dmg）。Windows 有 `WINDOWS_CERTIFICATE_P12`／`WINDOWS_CERTIFICATE_PASSWORD` 時以 `WIN_CSC_LINK`／`WIN_CSC_KEY_PASSWORD` 簽 portable 與 NSIS，並以 `Get-AuthenticodeSignature` 驗證兩個 exe 都是 `Valid`。
  - 本機與測試不要設 `CSC_LINK`，打包一律帶 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免觸發 macOS 鑰匙圈。
- Windows NSIS 是 per-user 安裝（`perMachine: false`、不需要系統管理員，可選安裝目錄），解除安裝不刪 userData。NSIS 沒有 `PORTABLE_EXECUTABLE_FILE`，所以登入項目與重新啟動直接用 `process.execPath`（安裝目錄內的真實 exe）；portable 仍用原始 launcher。`resources/integrations` 與 `node.exe` 解析都不依賴打包形式。
- Linux 的登入項目（Electron 在 Linux 無作用）回報 `unsupported`；系統匣建立失敗不會讓 app 結束；點擊穿透在 Linux 不啟用；`safeStorage` 的 backend 是 `basic_text` 或 `unknown` 時視為無法加密（plugin secrets 拒絕儲存）；全螢幕偵測只在 Windows 實作。Linux 產出尚未在實機驗證。
- x64 不能在 arm64 runner 上打包：pnpm 只裝 host 架構的原生模組（`@koromix/koffi-darwin-*`），會把 arm64 的 `.node` 放進 x64 dmg。Linux 同理，在 x64 runner 上只會裝 `linux-x64`。
- 每個 mac job 打包後執行 `scripts/check-mac-bundle.mjs`（掛載 dmg）：`codesign --verify --deep --strict`、fuses 對照 `build.electronFuses`、每個 Mach-O 與 `*.node` 的 `lipo -archs`，不符就讓發版失敗。選用旗標：`--expect-signed developer-id` 另外檢查 Authority 是 Developer ID Application、有 TeamIdentifier、codesign flags 含 `runtime`（`0x10000`）且 `spctl -a -t exec -vv` 接受；再加 `--expect-notarized` 要求 spctl source 為 `Notarized Developer ID` 且 `xcrun stapler validate` 通過。release.yml 在簽章與公證路徑自動帶這些旗標。本機可對 `electron-builder --mac --<arch> --dir` 產出的 `.app` 執行同一支腳本；在 Intel Mac 上打 arm64 包會因為 koffi 是 x64 而失敗，這是預期結果。
- 舊版 release 使用 `Windows_x.y.z`／`MacOS_x.y.z` 分開的 tag；自動化之後統一為 `v<version>` 單一 release。

## UI 語言要求

繁體中文是後續使用者介面的必要語言，不是只寫在文件裡的偏好。新增或修改設定、Tray、通知、HUD、錯誤與 onboarding 文案時，必須同步提供繁體中文；跨平台 fallback、字串 key 與未來 i18n 抽離要維持同一語意。若當前 Phase 不包含完整 i18n，至少要在 phase report 標註尚未涵蓋的畫面，不得新增只存在英文的使用者可見功能。
