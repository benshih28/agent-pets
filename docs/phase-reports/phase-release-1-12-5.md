# 1.12.5 整合：4 條實作線、打包修正與整體 review

1.12.4 之後的未結項（Windows／Linux 實測除外）拆成 4 條線各自驗收，這一輪合成一個分支，加上 1.12.4 安裝檔驗證找到的打包問題，升版 1.12.5。

## 1. 合併的 4 條線

4 條分支都從 main `f8965ae`（1.12.4）切出，依序以 merge commit 合併。衝突只出現在文件，兩邊段落都保留；程式碼沒有衝突。

| 線 | 分支 tip | 內容 | 詳細報告 |
|---|---|---|---|
| hook 強化 | `b45e0a2` | 冷啟動標記與狀態事件重試；`permissionPost` 改用 `node:http` 的兩段時限 | [phase-hook-hardening.md](phase-hook-hardening.md)、[docs/dev/hook-delivery.md](../dev/hook-delivery.md) |
| Agent 來源 registry | `b73a9aa` | `AGENT_SOURCE_REGISTRY`／`AGENT_FAMILY_REGISTRY`，其餘來源清單與白名單改為推導 | [phase-agent-source-registry.md](phase-agent-source-registry.md)、[docs/dev/agent-sources.md](../dev/agent-sources.md) |
| 音效 registry | `fdbec75` | `src/types/sound.ts` 收音形、開關、節流、音量、預設值 | [sound-registry.md](sound-registry.md)、[docs/dev/sound-registry.md](../dev/sound-registry.md) |
| CSS 時長／間距 token | `293358e` | `--space-*`、`--transition-*`、`--duration-*`、`--ease-*`，`check:design` 新增三條規則 | [phase-motion-spacing-tokens.md](phase-motion-spacing-tokens.md)、[docs/dev/design-tokens.md](../dev/design-tokens.md) |

手動整合的衝突：

- `README.md`、`README.zh-TW.md`：「Agent 來源」與「音效」兩段都保留，前後排列。
- `.agents/skills/pet-skill/references/project-map.md`：Per-source 與 Per-cue 兩行都保留。
- `.claude/skills/agent-pets-conventions/SKILL.md`：兩條線都新增了 §4 E；音效段改成 F。
- `.agents/skills/pet-skill/references/ui-design-system.md`：保留 CSS 線新增的 raw-control 說明與「Spacing and motion tokens」一節，以及 Agent 來源線改寫的 `SOURCE_LABELS` 說明（改成寫進 `AGENT_SOURCE_REGISTRY` 的 `label`）。

合併後檢查：`git diff main -- integrations/install.mjs electron/hook-config.ts electron/setup.ts` 為空；`integrations/agent-hook.mjs` 與 hook 強化分支相同，只多了第 2 節 (d) 的 import 改動。1.12.1 `d45ca8d` 的 Codex Windows 指令規則沒有改動。

## 2. 打包修正（1.12.4 安裝檔驗證找到的 4 個問題）

### (a) macOS bundle 沒有密封（中）

- 原因：electron-builder 26.15.3 的 `doAddElectronFuses` 在 `afterPack` 之後、簽章之前才執行。1.12.4 因為 `CSC_IDENTITY_AUTO_DISCOVERY=false` 而沒有簽章，arm64 的主程式只剩 linker 產生的 ad-hoc 簽章；寫入 fuses 之後，Electron Framework 的簽章也跟著失效。
- 做法：`package.json` 的 `mac.identity` 設成 `"-"`。這一版的 `MacTargetHelper.findSigningIdentity` 原生支援 `"-"`，會在寫入 fuses 之後以 `@electron/osx-sign` 由內而外簽整個 bundle。用 `afterPack` 自行簽章的話，簽章會比寫入 fuses 早，所以不採用；`afterSign` 在沒有簽章時會被跳過，也不能用。hardened runtime 維持 electron-builder 的預設值，套用預設的 entitlements（其中包含 `disable-library-validation`）。沒有改 `electronFuses`、asar integrity、正式簽章、公證與 secret。
- 在 `release.yml` 新增 **Verify macOS bundle** 步驟：掛載 dmg 後執行 `scripts/check-mac-bundle.mjs`，`codesign --verify --deep --strict` 沒過就讓發版失敗。

### (b) x64 dmg 帶 arm64 的 koffi（低）

- 原因：兩個 mac job 都在 arm64 的 `macos-latest` 上執行，pnpm 只會裝 host 架構的 `@koromix/koffi-darwin-*`。
- 做法：x64 job 改用 `macos-15-intel` runner。比較過 pnpm `supportedArchitectures`，但那樣兩個架構的 `.node` 會同時打進每個 dmg，所以不採用。
- `check-mac-bundle.mjs` 對主程式、Helper、Framework 主 binary、`Helpers/`、每個 `*.node` 與 `*.dylib` 執行 `lipo -archs`，缺少目標架構就失敗。

### (c) Release 沒有 checksum（低）

release job 在 `gh release create` 之前執行 `sha256sum -- * > SHA256SUMS.txt`，跟安裝檔一起上傳。README 兩版都寫了比對指令。

### (d) `agent-hook.mjs` 用 `'http'`（極低）

5 個內建模組的 import 都改成 `node:` 形式（crypto、fs、http、os、path），功能等價。`electron/setup.ts` 內嵌的舊版 hook 樣板屬於 hook 安裝邏輯，所以沒有改動。

### 本機證據（Intel Mac）

`CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --<arch> --dir --publish never`。打包過程沒有跳出鑰匙圈：簽章使用 `"-"`，不需要取用私鑰。

| 檢查 | x64（`release/mac`） | arm64（`release/mac-arm64`） |
|---|---|---|
| electron-builder 記錄 | `executing @electron/fuses` → `signing … identityName=-` | 同左 |
| `codesign --verify --deep --strict -vv` | valid on disk、satisfies its Designated Requirement | 同左 |
| `codesign -dv` | `flags=0x10002(adhoc,runtime)`、`Sealed Resources version=2` | 同左 |
| fuses 與 `build.electronFuses` | 7 項相同 | 7 項相同 |
| `lipo -archs`（15 個 Mach-O） | 全部 x86_64，koffi 是 `koffi-darwin-x64` | koffi 是 `koffi-darwin-x64`，腳本回報不符並以 exit 1 結束 |

在 Intel Mac 上打 arm64 包，跟 1.12.4 在 arm64 runner 上打 x64 包是同一個問題，只是方向相反。腳本能抓到這個問題，這也說明 x64 必須改在 Intel runner 上建置。CI 上兩個 job 都在同架構的 runner 上打包，預期都會通過；實際結果要等合併後的 release run 才能確認。

## 3. 整體 review

另外用一個沒有看過這些修改的 review agent，讀過 `main..HEAD` 在 electron、integrations、src、scripts、.github 底下的差異。高、中度問題都沒有。低度問題與我自己找到的重複項目都已經修正：

| 項目 | 處理 |
|---|---|
| 來源線的 `freezeRegistry`（兩層）與音效線的 `deepFreeze`（遞迴）做同一件事 | 收成 `src/types/freeze.ts` 的 `deepFreeze`，這個檔案沒有任何 import。`agent.ts`、`sound.ts`、`agent-state-presentation.ts` 都用相對路徑 import 它 |
| `setFamilyPet` 寫入時沒有檢查 key（讀取時有） | 加上 `isAgentFamilyKey` 檢查；`getPetForFamily` 改成只讀自己的屬性（`Object.hasOwn`） |
| `event-normalizer.ts` 的 `VALID_STATES` 是手寫清單 | 改由 `AGENT_STATES` 加上舊版的 `'waiting'` 推導 |
| hook 的 `validSources` 沒有同步測試 | 測試會讀出 `agent-hook.mjs` 裡的清單，確認每個來源都在 registry 裡；同時測試 normalizer 接受每個狀態，並拒絕 `constructor` |
| 寵物反應標記與設定區塊閃爍的 1400 ms 在 CSS 與 TS 各寫一份（CSS 線留下的未結項） | 改成由元件以行內樣式設定 `--pet-mark-duration`、`--settings-flash-duration`，`rawMotion` 從 31 降到 28 |
| `check-mac-bundle.mjs` 的 `lipo` 失敗時會直接丟出 stack trace | 改成列入問題清單 |
| 冷啟動時，不同 hook 程序的重試可能讓事件順序顛倒；權限呼叫在啟動期間不重試 | 記錄在 `docs/dev/hook-delivery.md` 的「限制」。event server 用收到的時間排序，因為事件來源也包含插件，不能用對方給的時間排先後，所以不改。`agent-hook.mjs` 依規定與 hook 線保持一致，所以註解沒有改 |

Review 確認沒有問題的部分：

- 熱路徑：`agentStore` 原本每個事件都要跑 `SOURCE_FAMILIES.find`／`includes`，現在改成 O(1) 查表（`familyOfSource`、`isDesktopSource`）。`playCue` 只建立 Web Audio 必要的節點。
- 白名單：推導之後成員與數量都和以前相同：權限來源 4、事件來源 7、插件保留名稱 12。
- 重試迴圈有上限，最多 5 秒、約 50 次，而且只在 `ECONNREFUSED` 時重試。標記檔用 `lstat` 加 `isFile()` 檢查，所以 symlink 會被拒絕。
- `release.yml` 的變數都經由 env 傳入並加上引號，沒有 shell injection。`check-mac-bundle.mjs` 用 `execFileSync` 加參數陣列，不經過 shell。

## 4. 驗證

| 項目 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile --offline` | 通過（node_modules 是實體目錄，不是 symlink） |
| `pnpm exec vue-tsc --noEmit` | 0 錯誤 |
| `pnpm run lint` | main-process lint passed |
| `pnpm run check:design:strict` | `byRule` 空、unused 0、rawControls 0、rawControlsAccepted 12、rawSpacing 74、rawMotion 28、rawColors 0 |
| `pnpm exec vite build`、`check:bundle-size`、`check:bundle`、`check:contrast` | 通過 |
| `pnpm run test:unit` | 1277 個：1276 通過、1 略過、0 失敗（總控試合併是 1271；新增 bundle 檢查 4 個、registry 同步 2 個） |
| hook 相關測試連跑 3 次（agent-hook-delivery、claude-permission-hook、hook-config、hook-startup-marker、setup-install、install-outcome） | 3 次都是 65 個：64 通過、1 略過、0 失敗 |
| 真實 hook e2e，`--rounds 10`，隔離埠 27373–27375、CDP 9348／9349 | `all 80 hook events rendered as expected`，`fakeSafeStorage: true` |
| 冷啟動 e2e，`--cold-start 150 --interval 40` | 150 個裡遺失 13 個，主程序收到的和畫面上顯示的都是 137 個。遺失的事件都是在 479 ms 以前送出的，早於寫入標記的 618 ms；標記寫入到開始監聽（1199 ms）之間送出的事件全部送達。結果和 hook 線記錄的殘餘風險一致（13／12／12），腳本因為有遺失而以 exit 1 結束 |

使用者的 `~/.claude/settings.json` 沒有被寫入，最後修改時間還是 11/08。17373–17375 沒有被佔用。

## 5. 殘餘風險

- Windows／Linux 沒有實測。
- 打包修正只在本機以 `--dir` 驗證，以下項目要等合併後的 release run 才能確認：Intel runner 打出來的 x64 koffi、dmg 掛載後的檢查，以及 `SHA256SUMS.txt` 上傳。
- 還沒在 Apple Silicon 實機下載、開啟過。ad-hoc 密封之後應該會從「已損毀」變成一般的「無法驗證開發者」提示，但還沒實測。
- Electron 載入 main.js 之前（約 0.5 秒內）送出的狀態事件仍會遺失。冷啟動時不同 hook 程序的事件順序可能顛倒。

## 6. 版本

升到 1.12.5（patch）。持久化格式、插件與主題的公開契約，以及安全邊界都沒有改變。macOS 改成 ad-hoc 簽章只影響 bundle 完整性，不涉及憑證或權限，所以不升 minor。
