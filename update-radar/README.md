# AI Update Radar

獨立的 OpenAI／Anthropic 官方更新追蹤器，也會追蹤 Tibo（[@thsottiaux](https://x.com/thsottiaux)）今天的公開原始貼文與 self-reply。它不依賴 Agent Pets、Electron、Vue 或第三方套件，可以先單獨運作，之後再透過 versioned JSON feed 接入 Agent Pets。

## 使用方式

需要 Node.js 22.12 以上版本。

```bash
cd update-radar
pnpm start
```

接著開啟 `http://127.0.0.1:4317`。`pnpm start` 會啟動介面並自動收集資料：OpenAI／Anthropic 約每小時檢查一次（正負五分鐘隨機延遲），Tibo 約每十分鐘檢查一次（正負一分鐘）。失敗時兩組來源各自退避重試，也不會同時寫入兩輪資料。瀏覽頁每分鐘重新讀取本機 feed。

### Tibo 今日貼文與通知

Tibo 來源直接讀取固定的公開頁 `https://x.com/thsottiaux`，不需要登入 X、Developer App、API token，也不會消耗 X API 額度。程式先找出裝置目前時區中「今天」的原始貼文，再讀取最多五個最新貼文的公開對話頁；只有作者與被回覆者都是 `thsottiaux` 的 self-reply 會加入 feed。其他人的回覆、Tibo 回覆其他帳號與轉發都會排除。畫面會將同一串的原始貼文與 self-reply 依時間合併成一張對話串卡片，並以文字標籤、節點造型、連接線與回覆底色凸顯差異。跨日後，前一天的 Tibo 快取會移除。公開頁若被重新導向登入頁、版面格式改變或無法讀取，程式會失敗關閉該解析路徑，不會猜測關係。

在頁面按「開啟 Tibo 通知」並允許後，若今天已經有貼文，會立即通知一次；之後僅通知尚未看過的貼文 ID。通知狀態保存在瀏覽器本機，最多保留 100 筆 ID。一次超過三則時會合併成一則通知。這仍不是作業系統背景服務：關閉頁面或停止 `pnpm start` 後就不會檢查或通知。

這個方法刻意避免集中式服務與每位使用者共用 API 額度，但它不是 X 官方穩定 API；公開頁 HTML、匿名存取政策或可見貼文數量變動時，解析可能暫時失效。每輪最多會向 X 發出一個個人頁請求與五個對話頁請求；十分鐘檢查是目前的低負載折衷，不保證即時。

`pnpm collect` 可手動強制收集一次；`pnpm serve` 是不執行背景收集的純顯示模式。可用 `pnpm serve -- --port 4318` 指定其他 loopback port。

產生的 `data/feed.json` 是可移植的 `schemaVersion: 1` 契約，不會提交到 Git。單一來源失敗時，collector 會保留該來源同一天上次成功的 Tibo 資料，或保留其他官方來源的最近成功資料，並將來源標為 stale。

OpenAI／Anthropic 更新卡會先顯示「變更、影響範圍、注意事項」三格快速判讀，再顯示官方標題。注意事項只根據已正規化欄位與明確關鍵字標示遷移、相容性、成本、限制或安全／合規訊號；沒有明確訊號時會顯示「未標示必要動作」，不會推測成「沒有影響」。較長的官方內容預設收合，可按「展開完整更新內容」核對。這不是 AI 翻譯或語意摘要，因此不增加模型費用，內容仍保留來源語言。

目前來源：

- OpenAI API changelog；
- OpenAI API deprecations；
- Anthropic Claude Platform release notes；
- Anthropic model deprecations；
- Anthropic Claude Code GitHub releases；
- Tibo `@thsottiaux` 今天的原始貼文，以及 Tibo 回覆自己貼文的內容。

安全限制：只連線到固定的官方 HTTPS host/path；Tibo 頁不接受 redirect；所有來源都有回應大小與 timeout 限制。遠端文字經過長度限制與純文字正規化，瀏覽頁使用 `textContent` 顯示；本機 server 只綁定 `127.0.0.1`，僅允許 `GET`／`HEAD`。

### Agent Pets 完整插件

`plugin/` 已將獨立版的六個來源接入 Agent Pets：OpenAI changelog／deprecations、Claude Platform release notes／model deprecations、Claude Code releases，以及 Tibo 的當日公開貼文與自我回文。啟動時會為每個來源分別建立安靜基準，之後只把新 ID 送進寵物通知中心；官方來源每小時檢查，Tibo 每 10 分鐘檢查，背景每 5 分鐘判斷哪些來源到期。失敗來源會以 5、15、30、60 分鐘退避重試，保留最近成功資料並顯示下一次重試時間。

試用方式：

1. 啟動 Agent Pets，前往 **Settings → Plugins → 進階**。
2. 開啟**開發者模式**，按**從資料夾載入…**。
3. 選擇本儲存庫的 `update-radar/plugin` 資料夾。
4. 確認它只要求固定的 OpenAI、Anthropic、Claude Code GitHub 與 `x.com` 網路／外開網域、五分鐘最低排程、本機插件 storage 與寵物通知權限。
5. 安裝後開啟插件與全域插件開關，再開啟「AI 更新雷達」面板。

需要 Agent Pets `1.4.0` 以上（使用 `permissions.links`）。背景同步在 `1.4.1` 的 Plugin Host 記憶體檢查下實測增長約 7 MB，低於預設每插件 64 MB 預算。

#### 發布新版到插件商店

1. 修改 `plugin/` 後，把 `plugin/plugin.json` 的 `version` 調高；已發布的版本不能用同一個版本號重新打包。
2. 在 repo 根目錄執行：

   ```bash
   node --experimental-strip-types update-radar/scripts/pack-plugin.mts
   ```

   腳本會用 `~/.config/agent-pets/plugin-signing/update-radar-ed25519-private.pem` 簽章（可用 `--key` 指定其他位置），以 Agent Pets 的簽章驗證與安裝檢查確認成品，輸出到 `update-radar/release/`（已被 git 忽略），並印出可直接貼進商店 `index.json` 的版本項目。同樣的內容在任何時區都會產生相同的 SHA-256。
3. 在 fork 的 `agent-pets-plugins` 把套件放進 `packages/`，並把印出的項目加到 `update-radar` 的 `versions`（保留舊版本），再發 PR。

私鑰只放在本機，不可加入套件或任何 git 倉庫；遺失或更換金鑰時，已安裝的使用者必須重新確認信任新指紋。

面板沿用開啟前的 Agent Pets 一般面板大小，內容較長時在面板內捲動，不會為插件另行撐大視窗。來源健康度會顯示正常、快取、失敗、下一次重試與立即重試；更新可依文字、供應商、類型與變更篩選。官方卡片會顯示變更／影響／注意事項、明確版本前後差異與可展開原文；Claude Code 一個版本合併成一張版本卡（各類數量、重點預覽、展開依類型列出全部變更），Claude Platform 同一天的多項更新合併成一張日期卡，OpenAI／Claude 的停用公告則顯示停用倒數與「舊型號 → 建議替代」清單。寵物通知也依版本與日期合併；Tibo 原貼與多層自我回文會在同一張時間軸卡片保留上下文。每張卡片的來源按鈕都由受控的 `links.openExternal()` 驗證真實使用者操作、manifest 精確 HTTPS 網域與每分鐘速率後，交給系統預設瀏覽器；面板本身仍不能離開沙箱或自行開窗。

## English

AI Update Radar is a standalone tracker for official OpenAI and Anthropic updates plus today's public posts and self-replies from Tibo (`@thsottiaux`). Official-update cards show deterministic change, scope, and attention cues before the source-language headline; longer official text is collapsed but remains available for verification. These cues use normalized fields and explicit keywords rather than an AI translation or semantic summary. The Tibo adapter reads the fixed public profile and up to five recent conversation pages without an X login, developer app, token, or API usage. It retains a reply only when both its author and replied-to account are `thsottiaux`, and checks about every ten minutes. A root post and its self-replies are grouped into one chronological conversation card, with text labels and timeline markers distinguishing the original post from replies. Browser notifications work while the page remains open. Public-page parsing is best effort and may need an update if X changes its anonymous page or markup. `pnpm collect` performs a one-shot refresh, while `pnpm serve` is display-only. The generated `data/feed.json` is a portable, versioned contract that Agent Pets can consume later.

The `plugin/` directory now carries all six sources into Agent Pets: OpenAI changelog and deprecations, Claude Platform releases and model deprecations, Claude Code releases, and today's public Tibo posts plus chained self-replies. Each source has its own quiet baseline, due time, cached fallback, and bounded retry backoff. The sandboxed panel adds source health, search and filters, deterministic change/scope/attention cues, explicit version comparisons, and chronological Tibo thread context. Claude Code changes are grouped into one card (and one notification) per version, multiple Claude Platform items from the same date share one card, and deprecation notices show a shutdown countdown with an old model → recommended replacement list parsed from the official tables. Source buttons use the host-controlled `links.openExternal()` API, which requires a trusted user gesture, an exact declared HTTPS host, and a per-plugin rate limit. Load `update-radar/plugin` through **Settings → Plugins → Advanced → Developer mode → Load from folder…**. It requires Agent Pets `1.4.0` or later because it uses `permissions.links`; under the `1.4.1` baseline-relative Plugin Host memory check, background sync grew about 7 MB, well within the default 64 MB per-plugin budget.

To publish a new version to the plugin catalog, raise `version` in `plugin/plugin.json`, then run `node --experimental-strip-types update-radar/scripts/pack-plugin.mts` from the repository root. The script signs the package with `~/.config/agent-pets/plugin-signing/update-radar-ed25519-private.pem` (override with `--key`), checks it with the Agent Pets signature verifier and install planner, writes it to the git-ignored `update-radar/release/`, and prints the version entry for the catalog `index.json`. Output is byte-for-byte reproducible across time zones. Add the package under `packages/` and the entry to `versions` in your `agent-pets-plugins` fork, then open a pull request. Never commit the private key.

Run tests with:

```bash
pnpm test
```
