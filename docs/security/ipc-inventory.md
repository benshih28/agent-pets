# IPC 安全清單

由 `node scripts/generate-ipc-inventory.mjs --write` 從 `electron/ipc/channels.ts`、主程序與 preload 產生；目前 83 個 handler。每列列出 sender guard、handler 中的輸入檢查概況、preload 對應與測試。新增 IPC 頻道若未同步 preload 或 sender 驗證，`tests/ipc-inventory.test.mts` 會失敗。

| 頻道 | 類型 | 允許的寄件者 | 輸入驗證概況 | Preload API | 對應測試 |
| --- | --- | --- | --- | --- | --- |
| `integration-status` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | checkIntegration (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-diagnose` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | diagnoseAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-install` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | installAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-uninstall` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | uninstallAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-window-mode-set` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setPetWindowMode (invoke) | `tests/ipc-desktop.test.mts` |
| `pet-window-mode-init` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | initializePetWindowMode (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-preferences-init` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | initializeDesktopPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-preferences-set` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setDesktopPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `power-save-state` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getPowerSaveState (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-summary` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | getHistorySummary (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-clear` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | clearHistory (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-export` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | exportHistory (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `test-integration` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | testIntegration (invoke) | `tests/ipc-integrations.test.mts` |
| `install-integrations` | `handle` | 設定面板 main frame | isIntegrationTarget；無效輸入回安全預設或錯誤 | installIntegrations (invoke) | `tests/ipc-integrations.test.mts` |
| `uninstall-integrations` | `handle` | 設定面板 main frame | isIntegrationTarget；無效輸入回安全預設或錯誤 | uninstallIntegrations (invoke) | `tests/ipc-integrations.test.mts` |
| `permission-requests-init` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | initializePermissionRequests (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `permission-decide` | `handle` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | 型別；無效輸入回安全預設或錯誤 | decidePermission (invoke) | `tests/phase-18-renderer-characterization.test.mts` |
| `add-custom-pet` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | addCustomPet (invoke) | `tests/ipc-pet-assets.test.mts` |
| `rename-custom-pet` | `handle` | 設定面板 main frame | 型別；長度／數量上限；isFile, isSymbolicLink；無效輸入回安全預設或錯誤 | renameCustomPet (invoke) | `tests/ipc-pet-assets.test.mts` |
| `remove-custom-pet` | `handle` | 設定面板 main frame | isDirectory, isSymbolicLink；無效輸入回安全預設或錯誤 | removeCustomPet (invoke) | `tests/ipc-pet-assets.test.mts` |
| `get-custom-pet-sprite` | `handle` | 受信任寵物或設定面板 main frame | isFile, isSymbolicLink；無效輸入回安全預設或錯誤 | getCustomPetSprite (invoke) | `tests/ipc-pet-assets.test.mts` |
| `import-pet-zip` | `handle` | 設定面板 main frame | 長度／數量上限；isFile, isSymbolicLink, isSupportedRasterImage；無效輸入回安全預設或錯誤 | importPetZip (invoke) | `tests/ipc-pet-assets.test.mts` |
| `import-pet-sprite` | `handle` | 設定面板 main frame | 長度／數量上限；isFile, isSymbolicLink, isSupportedRasterImage；無效輸入回安全預設或錯誤 | importPetSprite (invoke) | `tests/ipc-pet-assets.test.mts` |
| `pet-drag-start` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | startDrag (send) | `tests/ipc-pet-motion.test.mts` |
| `pet-drag-end` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | notifyDragEnd (send) | `tests/ipc-pet-motion.test.mts` |
| `pet-window-hover` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | notifyPetHover (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `shimeji-walk-step` | `on` | 寵物視窗 main frame | 型別；數值範圍；無效輸入回安全預設或錯誤 | shimejiWalkStep (send) | `tests/ipc-pet-motion.test.mts` |
| `load-pets` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | loadPets (invoke) | `tests/ipc-pets.test.mts`<br>`tests/project-pets-ipc-scope.test.mts` |
| `plugin-catalog-list` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | listPluginCatalog (invoke) | `tests/ipc-plugin-catalog.test.mts` |
| `plugin-catalog-install` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | installPluginFromCatalog (invoke) | `tests/ipc-plugin-catalog.test.mts` |
| `plugin-report-issue` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | reportInstalledPluginIssue (invoke) | `tests/ipc-plugin-catalog.test.mts` |
| `plugin-feed-unread-count` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | onPluginFeedUnreadCount (on)<br>getPluginFeedUnreadCount (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-badges-get` | `handle` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | getPluginBadges (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-event-source-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getPluginEventSourceStatuses (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-feed-complete` | `handle` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | 型別；無效輸入回安全預設或錯誤 | completePluginFeed (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-list` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | listPluginNotifications (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-read` | `handle` | 設定面板 main frame | isPluginPanelNotificationId；無效輸入回安全預設或錯誤 | markPluginNotificationRead (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-clear` | `handle` | 設定面板 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | clearPluginNotifications (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-skin-fallback-notify` | `handle` | 受信任寵物或設定面板 main frame | 長度／數量上限；isPluginSkinPetId；無效輸入回安全預設或錯誤 | notifyPluginSkinFallback (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-feed-open-link` | `handle` | 受信任寵物或設定面板 main frame | 型別；isPluginLinkHostAllowed；無效輸入回安全預設或錯誤 | openPluginFeedLink (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-select` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | selectPluginArchive (invoke) | `tests/ipc-plugin-install.test.mts` |
| `plugin-install-select-folder` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | selectPluginFolder (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-confirm` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | installPluginPlan (invoke) | `tests/ipc-plugin-install.test.mts` |
| `plugin-remove` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | removeInstalledPlugin (invoke) | `tests/ipc-plugin-install.test.mts` |
| `plugin-diagnostics` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPluginDiagnostics (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-snapshot` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPluginPanelSnapshot (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-command-invoke` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | invokePluginCommand (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-open` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | openPluginPanelView (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-open-from-pet` | `handle` | 寵物視窗 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | openPluginPanelFromPet (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-bounds` | `on` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setPluginPanelViewBounds (send) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-close` | `on` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | closePluginPanelView (send) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-api` | `handle` | panelView 主 frame；active WebContents 二次比對 | handler／controller 驗證 payload；拒絕無效輸入 | agentPets (createPluginPanelPublicApi) | `tests/ipc-inventory.test.mts`<br>`tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-preferences-global-set` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setPluginGlobalPreferences (invoke) | `tests/ipc-plugin-preferences.test.mts` |
| `plugin-preferences-instance-set` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setPluginInstancePreferences (invoke) | `tests/ipc-plugin-preferences.test.mts` |
| `plugin-settings-get` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPluginSettings (invoke) | `tests/ipc-plugin-settings.test.mts` |
| `plugin-settings-set` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setPluginSettings (invoke) | `tests/ipc-plugin-settings.test.mts` |
| `plugin-secret-consent-get` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPluginSecretConsent (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-consent-accept` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | acceptPluginSecretConsent (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-set` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setPluginSecret (invoke) | `tests/ipc-plugin-settings.test.mts` |
| `progression-init` | `handle` | 受信任寵物或設定面板 main frame | 型別；isProgressionPetId；無效輸入回安全預設或錯誤 | initializeProgression (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `progression-set-pet` | `handle` | 受信任寵物或設定面板 main frame | isProgressionPetId；無效輸入回安全預設或錯誤 | setProgressionPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `achievements-init` | `handle` | 受信任寵物或設定面板 main frame | isProgressionPetId；無效輸入回安全預設或錯誤 | initializeAchievements (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-setup` | `handle` | 設定面板 main frame | 長度／數量上限；isDialogOpen；無效輸入回安全預設或錯誤 | setupProjectMcp (invoke) | `tests/project-mcp-registry.test.mts`<br>`tests/project-mcp-setup.test.mts` |
| `project-mcp-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | listProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-remove` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | removeProjectMcp (invoke) | `tests/ipc-project-mcp.test.mts`<br>`tests/project-mcp-registry.test.mts` |
| `project-mcp-forget` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | forgetProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-list` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | listProjectPets (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `project-pets-get-enabled` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getProjectPetsEnabled (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `project-pets-set-enabled` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setProjectPetsEnabled (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-pick` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | pickProjectPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-bind` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | setProjectPetBinding (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-archive` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | archiveProjectPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `quota-usage` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getQuotaUsage (invoke) | `tests/ipc-quota.test.mts` |
| `pet-mouse-passthrough` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | setMousePassthrough (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-hide-request` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | requestPetHide (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-toggle` | `on` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | togglePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-resize` | `on` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | resizePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-hide` | `on` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | hidePanel (send) | `tests/ipc-window-controls.test.mts` |
| `pet-resize` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | resizeWindow (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-content-height` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | reportContentHeight (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-quit` | `on` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | quitApp (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-restart` | `on` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | restartApp (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `presentation-status-update` | `on` | 寵物視窗 main frame | normalizePresentationStatus；無效輸入回安全預設或錯誤 | publishPresentationStatus (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |

## 分析規則

- `assertTrustedIpcSender` 與 `assertPluginPanelSender` 都確認 sender 的 main frame、可信 URL 與允許的視窗；具名視窗參數會限制至該視窗。
- `plugin-panel-api` 先要求 main frame，再由 `PluginPanelViewController.handleApiRequest` 驗證目前 active WebContents、方法 allowlist、JSON 形狀與訊息大小。
- 寄件者與 payload 不合法時，handler 依各 API 回傳既有安全預設值或錯誤結果。
