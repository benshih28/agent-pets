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

## English

AI Update Radar is a standalone tracker for official OpenAI and Anthropic updates plus today's public posts and self-replies from Tibo (`@thsottiaux`). Official-update cards show deterministic change, scope, and attention cues before the source-language headline; longer official text is collapsed but remains available for verification. These cues use normalized fields and explicit keywords rather than an AI translation or semantic summary. The Tibo adapter reads the fixed public profile and up to five recent conversation pages without an X login, developer app, token, or API usage. It retains a reply only when both its author and replied-to account are `thsottiaux`, and checks about every ten minutes. A root post and its self-replies are grouped into one chronological conversation card, with text labels and timeline markers distinguishing the original post from replies. Browser notifications work while the page remains open. Public-page parsing is best effort and may need an update if X changes its anonymous page or markup. `pnpm collect` performs a one-shot refresh, while `pnpm serve` is display-only. The generated `data/feed.json` is a portable, versioned contract that Agent Pets can consume later.

Run tests with:

```bash
pnpm test
```
