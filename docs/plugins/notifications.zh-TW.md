# 通知與泡泡

`api.feed.notify` 須宣告 `contributes.feed`。成功回傳 `{itemId, delivery}`；`delivery` 是 `bubble` 或 `center`。泡泡包含插件來源標籤，點擊連結才會由宿主開啟外部網址；連結僅允許已授權的 HTTPS host。

泡泡仲裁順序：權限請求 → 權限提示 → presentation say → Agent toast → normal 插件通知 → Agent activity → low 插件通知。插件通知受全域開關、插件開關、靜音、DND、寵物可見性與速率限制影響。

寵物不可見、DND、靜音或通知速率超限時，通知保留在插件通知中心並計入未讀，不會補送泡泡；DND 結束不會回放 DND 期間通知。寵物重新可見時只補顯示最新有效通知，使用新的 TTL。佇列滿時 Host API reject `queue_full`。

用穩定 key 合併輪詢產生的重複通知：

```js
await api.feed.notify({
  title: 'New pull request',
  body: '#42 is ready for review.',
  link: 'https://github.com/example/project/pull/42',
  dedupeKey: 'pr-42',
})
```

同一插件的 `dedupeKey` 會在 24 小時內去重；key 最多 128 字元。TTL 預設 6 秒、可設 1–15 秒；標題最多 60 字、內文最多 240 字。
