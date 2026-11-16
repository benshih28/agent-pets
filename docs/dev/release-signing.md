# 發版簽章與公證

`.github/workflows/release.yml` 的簽章是選用的，由 repository secrets 決定：

- **沒有設定任何 secret**：行為與過去相同。macOS 是 ad-hoc 簽章（`package.json` 的 `mac.identity: "-"`），Windows 不簽章，也不公證。
- **設定了 secret**：下一次發版自動啟用正式簽章，不需要修改 workflow。

不要把憑證、密碼、API key 或它們的 base64 內容寫進 repo、issue、PR 或 log。workflow 只輸出 `true`／`false`，不會印出任何 secret 值。

## Secrets 一覽

| Secret | 用途 | 必要條件 |
|---|---|---|
| `MACOS_CERTIFICATE_P12` | Developer ID Application 憑證與私鑰（`.p12`）的 base64 | 與下一項一起設定才會啟用 macOS 正式簽章 |
| `MACOS_CERTIFICATE_PASSWORD` | 匯出 `.p12` 時設定的密碼 | 同上 |
| `APPLE_API_KEY_P8` | App Store Connect API key（`AuthKey_XXXX.p8`）的 base64 | 三項公證 secret 都有，而且 macOS 正式簽章已啟用，才會公證 |
| `APPLE_API_KEY_ID` | API key 的 Key ID | 同上 |
| `APPLE_API_ISSUER` | API key 的 Issuer ID（UUID） | 同上 |
| `WINDOWS_CERTIFICATE_P12` | 程式碼簽章憑證與私鑰（`.pfx`）的 base64 | 與下一項一起設定才會啟用 Windows 簽章 |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` 的密碼 | 同上 |

只設定一部分會被視為「沒有設定」，該平台維持不簽章（macOS 為 ad-hoc）。公證只在正式簽章成功時才有意義，所以沒有 macOS 憑證時，即使有 API key 也不公證。

Linux 沒有簽章步驟。

## 設定位置

GitHub repo 的 Settings → Secrets and variables → Actions → New repository secret，逐一新增上表的名稱與值。

目前 workflow 沒有使用 `environment`，所以放在 repository secrets。若想再加一層保護（審核者、分支限制），可放進 `release` environment：除了建立該 environment 與 secrets，也要在 `release.yml` 的 `build` job 加上 `environment: release`，secrets 才會傳進來。

`release.yml` 只在 push 到 `main` 與手動觸發（`workflow_dispatch`）時執行，fork 的 pull request 拿不到這些 secrets。手動觸發可以選任何分支，但 workflow 本身已限制：

- **只有 `main`（`github.ref == 'refs/heads/main'`）會讀取簽章 secrets。** **Detect signing credentials** 步驟的 env 以 `github.ref == 'refs/heads/main' && secrets.X || ''` 傳入，其他分支拿到的全是空字串，`mac`／`notarize`／`windows` 三個輸出都是 `false`；**Prepare signing files** 與 Package、驗證步驟都依這些輸出決定，所以不會執行簽章路徑，secret 也不會進入任何步驟的環境。
- **只有 `main` 會發版。** `release` job 有 `if: github.ref == 'refs/heads/main'`。其他分支手動觸發時仍會建置並上傳 artifact（沒簽章，macOS 為 ad-hoc），可用來試打包，但不會建立 tag 與 GitHub Release。

這樣有寫入權的人推一個分支再手動觸發，也無法用 secrets 簽未經審查的 commit；要簽章與發版的內容必須先進 `main`。environment 仍可作為額外保護（例如要求核准才進入簽章），但不再是防止其他分支簽章的唯一手段。

## 取得方式

### macOS：Developer ID Application 憑證

需要付費的 Apple Developer Program 帳號。

1. 在 Mac 的「鑰匙圈存取」選「憑證輔助程式 → 從憑證授權要求憑證」，建立 CSR 並存檔（不要選 e-mail 傳送）。
2. 到 developer.apple.com 的 Certificates, IDs & Profiles 新增憑證，類型選 **Developer ID Application**，上傳 CSR，下載 `.cer` 並雙擊匯入鑰匙圈。
3. 在鑰匙圈存取的「我的憑證」找到 `Developer ID Application: …`，連同私鑰一起右鍵匯出成 `.p12`，設定一組密碼（就是 `MACOS_CERTIFICATE_PASSWORD`）。
4. 轉成 base64 並複製到剪貼簿，貼到 secret：

   ```sh
   base64 -i cert.p12 | pbcopy
   ```

5. 刪除本機的 `cert.p12`。

只有 Account Holder 或 Admin 能建立 Developer ID 憑證。憑證用到的是 Developer ID Application，不是 Apple Development 或 Apple Distribution；後兩者無法通過 Gatekeeper。

### macOS：公證用 App Store Connect API key

1. App Store Connect → 使用者與存取權限 → 整合 → App Store Connect API → 團隊金鑰，產生金鑰，角色選 **Developer**（公證夠用）。
2. 頁面上方的 **Issuer ID**（UUID）就是 `APPLE_API_ISSUER`。
3. 金鑰列表中的 **Key ID**（10 碼）就是 `APPLE_API_KEY_ID`。
4. 下載 `AuthKey_<KeyID>.p8`（只能下載一次，請妥善保存），轉成 base64 貼到 `APPLE_API_KEY_P8`：

   ```sh
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

workflow 會把它解碼成 runner 暫存目錄下的檔案，並以 `APPLE_API_KEY`（檔案路徑）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER` 傳給 electron-builder，由它在簽章後對 `.app` 執行公證並 staple，之後才封裝成 dmg。dmg 本身不另外簽章或公證；staple 在 `.app` 上，使用者拖出 `.app` 後離線也能通過 Gatekeeper。

### Windows：程式碼簽章憑證

需要向憑證授權機構購買一般（OV）程式碼簽章憑證，並取得含私鑰的 `.pfx`（或 `.p12`）檔案與密碼。

```sh
# macOS
base64 -i certificate.pfx | pbcopy
# Linux
base64 -w0 certificate.pfx
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('certificate.pfx')) | Set-Clipboard
```

把輸出貼到 `WINDOWS_CERTIFICATE_P12`，密碼貼到 `WINDOWS_CERTIFICATE_PASSWORD`。

**目前不支援 EV 憑證與雲端簽章。** 近年多數 CA 發的 EV（以及新的 OV）憑證，私鑰放在硬體 token 或 HSM，無法匯出成 `.pfx`，也就無法放進 CI。這種情況需要雲端簽章服務（例如 Azure Artifact Signing、DigiCert KeyLocker、SSL.com eSigner），workflow 與 electron-builder 設定都要另外調整，這一版沒有做。

## 發版時 workflow 怎麼做

macOS（簽章路徑）：

1. **Detect signing credentials** 步驟輸出 `mac`、`notarize`、`windows`。
2. **Prepare signing files** 把憑證與 API key 解碼到 `$RUNNER_TEMP/signing/`。
3. **Package** 步驟以 `CSC_LINK`／`CSC_KEY_PASSWORD` 簽章，並以 CLI 覆寫 `--config.mac.identity=`（空字串）讓 electron-builder 從匯入的暫時鑰匙圈自動挑選 Developer ID Application；`package.json` 的 `"-"` 只用於 ad-hoc，`null` 則代表不簽章，所以不使用。同時開啟 `forceCodeSigning`（找不到身分就失敗）並指定 `build/entitlements.mac.developer-id.plist`。簽章在寫入 fuses 之後進行，不要改成 `afterPack` 自行簽章。
4. **Verify macOS bundle** 掛載 dmg 後執行 `scripts/check-mac-bundle.mjs`，簽章路徑多帶 `--expect-signed developer-id`，公證路徑再多帶 `--expect-notarized`。
5. **Clean up signing files** 不論成功失敗都刪除解碼出的檔案。

Windows（簽章路徑）：以 `WIN_CSC_LINK`／`WIN_CSC_KEY_PASSWORD` 簽章，portable 與 NSIS 安裝檔（含安裝程式內的解除安裝程式）都會簽；接著 **Verify Windows signatures** 對兩個 exe 執行 `Get-AuthenticodeSignature`，狀態不是 `Valid` 就讓發版失敗。自簽或鏈結不受信任的憑證會得到 `UnknownError`／`NotTrusted`，同樣失敗。

hardened runtime 與 entitlements：正式簽章啟用 hardened runtime，entitlements 只有 `com.apple.security.cs.allow-jit`。沒有 `disable-library-validation`，因為正式簽章時整個 bundle（包含 `app.asar.unpacked` 內的 koffi `*.node`）由同一個 Developer ID 簽，載入時 Team ID 相同；ad-hoc 沒有 Team ID，所以 ad-hoc 仍沿用 electron-builder 預設的 entitlements（包含 `disable-library-validation`），不受影響。若第一次正式簽章的版本在啟動時被系統終止，先看 Console 的 crash log，再決定是否補 `allow-unsigned-executable-memory`。

## 如何確認簽章生效

**Release log**

- macOS job：Package 步驟的 `signing file=… identityName=Developer ID Application: …`（ad-hoc 路徑則是 `identityName=-`）；公證路徑會有 `notarization successful`。Verify macOS bundle 步驟輸出 `Developer ID signature, notarization and staple: ok`。
- Windows job：Verify Windows signatures 輸出兩個檔案都是 `Valid`。

**使用者端（macOS）**

```sh
codesign -dvv "/Applications/Agent Pets.app"        # Authority 第一行是 Developer ID Application、flags 含 runtime
codesign --verify --deep --strict -vv "/Applications/Agent Pets.app"
spctl -a -t exec -vv "/Applications/Agent Pets.app" # accepted, source=Notarized Developer ID
xcrun stapler validate "/Applications/Agent Pets.app"
```

**使用者端（Windows）**：在 exe 上按右鍵 → 內容 → 數位簽章，或 PowerShell 執行 `Get-AuthenticodeSignature .\AgentPets-<版本>.exe`。

## 本機驗證（不需要憑證）

ad-hoc 路徑：

```sh
pnpm exec vite build
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --<本機架構> --dir --publish never
node scripts/check-mac-bundle.mjs --app "release/mac/Agent Pets.app" --arch <本機架構>
```

（Apple Silicon 的輸出資料夾是 `release/mac-arm64`。）本機驗證一定要帶 `CSC_IDENTITY_AUTO_DISCOVERY=false`，也不要設定 `CSC_LINK`，避免觸發鑰匙圈。正式簽章與公證路徑只能在擁有憑證的環境驗證。
