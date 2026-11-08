# Agent Pets UX 全面翻修路線圖（2026-11）

插件化之後整體體驗變差，寵物本體也有很多細節沒打磨。這份路線圖彙整 8 份唯讀稽核，共 **136 個大問題**、超過 1,000 個子任務。另外還有 CI-01（CI／Release 流程精簡）。每個大問題的證據（file:line）、使用者影響、子任務核取方塊和新畫面線框，都寫在對應的稽核檔裡。

| 稽核 | 前綴 | 大問題數 | 檔案 |
|---|---|---|---|
| 寵物本體（互動、動畫、氣泡、Mini/Edge、Shimeji、素材） | PET | 20 | [audit-pet.md](audit-pet.md) |
| 狀態面板與設定資訊架構 | SP | 18 | [audit-panel.md](audit-panel.md) |
| 插件系統 UX | PL | 18 | [audit-plugins.md](audit-plugins.md) |
| 新手引導、Hook 安裝、Project MCP | ON | 15 | [audit-onboarding.md](audit-onboarding.md) |
| 權限、通知、Tray、DND、全螢幕 | PM | 15 | [audit-permission.md](audit-permission.md) |
| 成長、成就、歷史、額度與用量 | GR | 16 | [audit-growth.md](audit-growth.md) |
| 設計系統、無障礙、i18n | DS | 19 | [audit-design.md](audit-design.md) |
| 穩定性、效能、主行程、CI/測試 | RL | 15 | [audit-reliability.md](audit-reliability.md) |

## 平行開發的工作線（依檔案所有權切分）

每條工作線在自己的 git worktree 和 `ws/<name>` 分支上開發，最後合併回 `feat/ux-overhaul`。一個大問題對應一個 commit，合併時再升一個 patch 版號。只有 schema、安全邊界、公開契約這類變更才升 minor，不升 major。

| 工作線 | 負責的大問題 | 主要擁有的檔案 |
|---|---|---|
| `pet` | PET-01〜14、16〜20、DS-03 | `DesktopPet.*`、`PetAnimation.*`、`App.vue`、`src/composables/`（新增寵物相關）、`electron/shimeji-behavior.ts`、`pet-behavior-manifest.ts`、`pet-window-mode.ts`、`electron/ipc/pet-*.ts` |
| `panel` | SP-01〜12、15〜18 | `StatusPanel.*`、`status-panel/StatusPanelSessions.vue`、`SettingsAppearance/Language/Pets/Advanced.vue`、`agentStore.ts` 的面板尺寸區塊、`electron/ipc/window-controls.ts` |
| `plugins` | PL-01〜18、SP-14 | `PluginPanel.*`、`plugin-panel/`、`SettingsPlugins.vue`、`usePluginPanelController.ts`、`electron/plugin-panel-*.ts`、`plugin-catalog*.ts`、`electron/ipc/plugin-*.ts` |
| `onboarding` | ON-01〜15 | `SetupWizard.*`、`ProjectMcpPanel.*`、`electron/setup.ts`、`agent-adapter*.ts`、`project-mcp*.ts`、`project-routing.ts`、`integrations/`、README |
| `permission` | PM-01〜15、PET-15 | `ui/InlinePermissionCard.vue`、`electron/permission-*.ts`、`desktop-tray.ts`、`tray-icon.ts`、`desktop-notifications.ts`、`notification-policy.ts`、`desktop-preferences.ts`、`desktop-visibility.ts`、`windows-fullscreen-detector.ts`、`SettingsDesktop.vue` |
| `growth` | GR-01〜16、SP-05、SP-13 | `progression.ts`、`achievements.ts`、`history.ts`、`local-usage.ts`、`quota.ts`、`SettingsGrowth.vue`、`StatusPanelHistory.vue`、`StatusPanelUsage.vue` |
| `design` | DS-01、02、04〜13、15〜19 | `src/styles/`、`src/components/ui/`（`InlinePermissionCard` 除外）、`index.html`、`src/i18n.ts`、主要 locale 檔、lint／守門腳本 |
| `reliability` | RL-01〜15、DS-14 | `electron/main.ts`、`electron/main/`、`event-server.ts`、`event-normalizer.ts`、`plugin-host-*.ts`、`plugin-broker.ts`、`plugin-registry.ts`、`plugin-schedule.ts`、`ipc/broadcast-coalescer.ts`、`agentStore.ts`（session 區塊）、`tests/`、`scripts/` |

### 共用檔案的規則

- 新文案放在 `src/locales/<domain>/{zh-TW,en-US}.json`，key 用 `<domain>.` 當前綴，兩種語系必須同時補齊（`tests/locale-domains.test.mts` 會檢查）。
- 共用的大檔（`electron/main/runtime.ts`、`agentStore.ts`、主要 locale 檔）只做局部修改，不重排、不格式化整檔。
- 不改 `package.json` 的版本號，也不動 `.claude/`。commit 不得包含個人資料、本機絕對路徑或憑證。
