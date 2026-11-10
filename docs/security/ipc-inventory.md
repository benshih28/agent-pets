# IPC 安全清單

由 `node scripts/generate-ipc-inventory.mjs --write` 從 `electron/ipc/channels.ts`、主程序與 preload 產生；目前 124 個 handler。每列列出 sender guard、handler 中的輸入檢查概況、preload 對應與測試。新增 IPC 頻道若未同步 preload 或 sender 驗證，`tests/ipc-inventory.test.mts` 會失敗。

| 頻道 | 類型 | 允許的寄件者 | 輸入驗證概況 | Preload API | 對應測試 |
| --- | --- | --- | --- | --- | --- |
| `integration-status` | `handle` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | checkIntegration (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-diagnose` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | diagnoseAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-install` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | installAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `adapter-uninstall` | `handle` | 設定面板 main frame | isAgentAdapterId；無效輸入回安全預設或錯誤 | uninstallAdapter (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-window-mode-set` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setPetWindowMode (invoke) | `tests/ipc-desktop.test.mts` |
| `pet-window-mode-init` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | initializePetWindowMode (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-preferences-init` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | initializeDesktopPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-preferences-set` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | setDesktopPreferences (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `desktop-open-login-items-settings` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | openLoginItemsSettings (invoke) | `tests/ipc-desktop.test.mts` |
| `power-save-state` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getPowerSaveState (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-summary` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | getHistorySummary (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-usage-blocks` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getUsageBlocks (invoke) | `tests/ipc-history.test.mts` |
| `history-sessions` | `handle` | 設定面板 main frame | normalizeSessionQuery；無效輸入回安全預設或錯誤 | listHistorySessions (invoke) | `tests/agent-source-registry.test.mts`<br>`tests/agent-state-registry.test.mts`<br>`tests/history-sessions.test.mts` |
| `history-session-detail` | `handle` | 設定面板 main frame | isHistorySessionId；無效輸入回安全預設或錯誤 | getHistorySessionDetail (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-clear` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | clearHistory (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-export` | `handle` | 設定面板 main frame | 型別；isProjectId；無效輸入回安全預設或錯誤 | exportHistory (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `history-reveal-export` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | revealHistoryExport (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `test-integration` | `handle` | 設定面板 main frame | isAgentSource；無效輸入回安全預設或錯誤 | testIntegration (invoke) | `tests/ipc-integrations.test.mts` |
| `install-integrations` | `handle` | 設定面板 main frame | isIntegrationTarget；無效輸入回安全預設或錯誤 | installIntegrations (invoke) | `tests/ipc-integrations.test.mts` |
| `uninstall-integrations` | `handle` | 設定面板 main frame | isIntegrationTarget；無效輸入回安全預設或錯誤 | uninstallIntegrations (invoke) | `tests/ipc-integrations.test.mts` |
| `onboarding-get` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getOnboardingState (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `onboarding-update` | `handle` | 受信任寵物或設定面板 main frame | isOnboardingAction；無效輸入回安全預設或錯誤 | updateOnboardingState (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-validate` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；無效輸入回安全預設或錯誤 | validatePanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-list` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；無效輸入回安全預設或錯誤 | listUserPanelThemes (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-create` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；isNameArgument；無效輸入回安全預設或錯誤 | createUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-update` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；isUserPanelThemeId, isNameArgument；無效輸入回安全預設或錯誤 | updateUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-rename` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；isUserPanelThemeId, isNameArgument；無效輸入回安全預設或錯誤 | renameUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-duplicate` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；isUserPanelThemeId, isNameArgument；無效輸入回安全預設或錯誤 | duplicateUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-delete` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；isUserPanelThemeId, isDialogOpen；無效輸入回安全預設或錯誤 | deleteUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-export` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；長度／數量上限；isUserPanelThemeId；無效輸入回安全預設或錯誤 | exportUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-import` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；無效輸入回安全預設或錯誤 | importUserPanelTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-state-get` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPanelThemeState (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-appearance-set` | `on` | 設定面板 main frame（共用 sender guard） | handler／controller 驗證 payload；拒絕無效輸入 | setPanelThemeAppearance (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-pet-status-get` | `handle` | 寵物視窗 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPetStatusTheme (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-slot-set` | `handle` | 設定面板 main frame（共用 sender guard） | isPanelThemeMode, isPanelThemeRef；無效輸入回安全預設或錯誤 | setPanelThemeSlot (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-image-import` | `handle` | 設定面板 main frame（共用 sender guard） | 長度／數量上限；isPanelThemeRef, isPanelThemeMode, isDialogOpen；無效輸入回安全預設或錯誤 | importPanelThemeUserImage (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-image-clear` | `handle` | 設定面板 main frame（共用 sender guard） | isPanelThemeRef, isPanelThemeMode, isReferenced；無效輸入回安全預設或錯誤 | clearPanelThemeUserImage (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-theme-user-image-options-set` | `handle` | 設定面板 main frame（共用 sender guard） | isPanelThemeRef, isPanelThemeMode, isPanelThemeUserImageOptions；無效輸入回安全預設或錯誤 | setPanelThemeUserImageOptions (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `permission-requests-init` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | initializePermissionRequests (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `permission-decide` | `handle` | 受信任寵物或設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | decidePermission (invoke) | `tests/phase-18-renderer-characterization.test.mts` |
| `permission-audit-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | listPermissionAudit (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `permission-audit-clear` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | clearPermissionAudit (invoke) | `tests/permission-audit.test.mts` |
| `add-custom-pet` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | addCustomPet (invoke) | `tests/ipc-pet-assets.test.mts` |
| `rename-custom-pet` | `handle` | 設定面板 main frame | 型別；長度／數量上限；isFile, isSymbolicLink；無效輸入回安全預設或錯誤 | renameCustomPet (invoke) | `tests/ipc-pet-assets.test.mts` |
| `remove-custom-pet` | `handle` | 設定面板 main frame | isDirectory, isSymbolicLink；無效輸入回安全預設或錯誤 | removeCustomPet (invoke) | `tests/ipc-pet-assets.test.mts` |
| `get-custom-pet-sprite` | `handle` | 受信任寵物或設定面板 main frame | 數值範圍；isFile, isSymbolicLink；無效輸入回安全預設或錯誤 | getCustomPetSprite (invoke) | `tests/ipc-pet-assets.test.mts` |
| `prepare-import-pet-zip` | `handle` | 設定面板 main frame | 長度／數量上限；isFile, isSymbolicLink；無效輸入回安全預設或錯誤 | prepareImportPetZip (invoke) | `tests/ipc-pet-assets.test.mts` |
| `commit-import-pet-zip` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | commitImportPetZip (invoke) | `tests/ipc-pet-assets.test.mts` |
| `cancel-import-pet-zip` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | cancelImportPetZip (invoke) | `tests/ipc-pet-assets.test.mts` |
| `import-pet-sprite` | `handle` | 設定面板 main frame | 長度／數量上限；isFile, isSymbolicLink, isSupportedRasterImage；無效輸入回安全預設或錯誤 | importPetSprite (invoke) | `tests/ipc-pet-assets.test.mts` |
| `pet-context-menu` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | showPetContextMenu (send) | `tests/pet-context-menu.test.mts` |
| `pet-drag-start` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | startDrag (send) | `tests/ipc-pet-motion.test.mts` |
| `pet-drag-end` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | notifyDragEnd (send) | `tests/ipc-pet-motion.test.mts` |
| `pet-window-hover` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | notifyPetHover (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `shimeji-walk-step` | `on` | 寵物視窗 main frame | 型別；數值範圍；無效輸入回安全預設或錯誤 | shimejiWalkStep (send) | `tests/ipc-pet-motion.test.mts` |
| `load-pets` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | loadPets (invoke) | `tests/ipc-pets.test.mts`<br>`tests/project-pets-ipc-scope.test.mts` |
| `plugin-catalog-list` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | listPluginCatalog (invoke) | `tests/ipc-plugin-catalog.test.mts` |
| `plugin-catalog-install` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；長度／數量上限；isPluginPanelPluginId, isPluginCatalogUrl；無效輸入回安全預設或錯誤 | installPluginFromCatalog (invoke) | `tests/ipc-plugin-catalog.test.mts` |
| `plugin-report-issue` | `handle` | 設定面板 main frame（共用 sender guard） | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | reportInstalledPluginIssue (invoke) | `tests/ipc-plugin-catalog.test.mts` |
| `plugin-feed-unread-count` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | onPluginFeedUnreadCount (on)<br>getPluginFeedUnreadCount (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-badges-get` | `handle` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | getPluginBadges (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-event-source-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getPluginEventSourceStatuses (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-feed-complete` | `handle` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | isSafeItemId；無效輸入回安全預設或錯誤 | completePluginFeed (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-list` | `handle` | 設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | listPluginNotifications (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-read` | `handle` | 設定面板 main frame | isPluginPanelNotificationId；無效輸入回安全預設或錯誤 | markPluginNotificationRead (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-read-all` | `handle` | 設定面板 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | markAllPluginNotificationsRead (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-notifications-clear` | `handle` | 設定面板 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | clearPluginNotifications (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-skin-fallback-notify` | `handle` | 受信任寵物或設定面板 main frame | 長度／數量上限；isPluginSkinPetId；無效輸入回安全預設或錯誤 | notifyPluginSkinFallback (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-feed-open-link` | `handle` | 受信任寵物或設定面板 main frame | isSafeItemId, isPluginLinkHostAllowed；無效輸入回安全預設或錯誤 | openPluginFeedLink (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-select` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | selectPluginArchive (invoke) | `tests/ipc-plugin-install.test.mts` |
| `plugin-install-select-folder` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | selectPluginFolder (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-install-confirm` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；isInstallConfirmation；無效輸入回安全預設或錯誤 | installPluginPlan (invoke) | `tests/ipc-plugin-install.test.mts` |
| `plugin-remove` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | removeInstalledPlugin (invoke) | `tests/ipc-plugin-install.test.mts` |
| `plugin-diagnostics` | `handle` | 設定面板 main frame（共用 sender guard） | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | getPluginDiagnostics (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-panel-snapshot` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPluginPanelSnapshot (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-command-invoke` | `handle` | 設定面板 main frame（共用 sender guard） | handler／controller 驗證 payload；拒絕無效輸入 | invokePluginCommand (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-open` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；isPluginPanelPluginId；無效輸入回安全預設或錯誤 | openPluginPanelView (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-open-from-pet` | `handle` | 寵物視窗 main frame | isPluginPanelPluginId；無效輸入回安全預設或錯誤 | openPluginPanelFromPet (invoke) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-bounds` | `on` | 設定面板 main frame（共用 sender guard） | 型別；數值範圍；validateBounds；無效輸入回安全預設或錯誤 | setPluginPanelViewBounds (send) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-view-close` | `on` | 設定面板 main frame（共用 sender guard） | 型別；數值範圍；無效輸入回安全預設或錯誤 | closePluginPanelView (send) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-theme-initial` | `on` | 受信任的主 frame（再由 controller 驗證 active WebContents） | 無 payload；檢查 sender 並回傳受限狀態 | pluginPanelThemeInitial (sendSync, plugin-ui-preload) | `tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-panel-api` | `handle` | panelView 主 frame；active WebContents 二次比對 | handler／controller 驗證 payload；拒絕無效輸入 | agentPets (createPluginPanelPublicApi) | `tests/ipc-inventory.test.mts`<br>`tests/ipc-plugin-panel-ui.test.mts` |
| `plugin-preferences-global-set` | `handle` | 設定面板 main frame（共用 sender guard） | isPluginPanelPreferencePatch；無效輸入回安全預設或錯誤 | setPluginGlobalPreferences (invoke) | `tests/ipc-plugin-preferences.test.mts` |
| `plugin-preferences-instance-set` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；isPluginPanelPluginId, isPluginPanelPreferencePatch；無效輸入回安全預設或錯誤 | setPluginInstancePreferences (invoke) | `tests/ipc-plugin-preferences.test.mts` |
| `plugin-settings-get` | `handle` | 設定面板 main frame（共用 sender guard） | isPluginPanelPluginId, isUnsafePluginDataError；無效輸入回安全預設或錯誤 | getPluginSettings (invoke) | `tests/ipc-plugin-settings.test.mts` |
| `plugin-settings-set` | `handle` | 設定面板 main frame（共用 sender guard） | isPluginPanelPluginId, isUnsafePluginDataError；無效輸入回安全預設或錯誤 | setPluginSettings (invoke) | `tests/ipc-plugin-settings.test.mts` |
| `plugin-secret-consent-get` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getPluginSecretConsent (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-consent-accept` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | acceptPluginSecretConsent (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `plugin-secret-set` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；長度／數量上限；isPluginPanelPluginId, isUnsafePluginDataError；無效輸入回安全預設或錯誤 | setPluginSecret (invoke) | `tests/ipc-plugin-settings.test.mts` |
| `progression-init` | `handle` | 受信任寵物或設定面板 main frame | 型別；isProgressionPetId；無效輸入回安全預設或錯誤 | initializeProgression (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `progression-set-pet` | `handle` | 受信任寵物或設定面板 main frame | isProgressionPetId；無效輸入回安全預設或錯誤 | setProgressionPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `progression-insights` | `handle` | 受信任寵物或設定面板 main frame | 型別；isProgressionPetId；無效輸入回安全預設或錯誤 | getProgressionInsights (invoke) | `tests/progression.test.mts` |
| `achievements-init` | `handle` | 受信任寵物或設定面板 main frame | isProgressionPetId；無效輸入回安全預設或錯誤 | initializeAchievements (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-setup` | `handle` | 設定面板 main frame | 長度／數量上限；isDialogOpen；無效輸入回安全預設或錯誤 | setupProjectMcp (invoke) | `tests/project-mcp-registry.test.mts`<br>`tests/project-mcp-setup.test.mts` |
| `project-mcp-apply` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | applyProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-list` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | listProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-mcp-remove` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | removeProjectMcp (invoke) | `tests/ipc-project-mcp.test.mts`<br>`tests/project-mcp-registry.test.mts`<br>`tests/project-mcp-setup.test.mts` |
| `project-mcp-forget` | `handle` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | forgetProjectMcp (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-list` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | listProjectPets (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `project-pets-get-enabled` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | getProjectPetsEnabled (invoke) | `tests/project-pets-ipc-scope.test.mts` |
| `project-pets-set-enabled` | `handle` | 設定面板 main frame（共用 sender guard） | handler／controller 驗證 payload；拒絕無效輸入 | setProjectPetsEnabled (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-pick` | `handle` | 設定面板 main frame（共用 sender guard） | 無 payload；檢查 sender 並回傳受限狀態 | pickProjectPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-bind` | `handle` | 設定面板 main frame（共用 sender guard） | 型別；isProjectId, isValidPetId；無效輸入回安全預設或錯誤 | setProjectPetBinding (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `project-pets-archive` | `handle` | 設定面板 main frame（共用 sender guard） | isProjectId；無效輸入回安全預設或錯誤 | archiveProjectPet (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `quota-usage` | `handle` | 受信任寵物或設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | getQuotaUsage (invoke) | `tests/ipc-quota.test.mts`<br>`tests/quota.test.mts` |
| `renderer-error-report` | `on` | 受信任寵物或設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | reportRendererError (send) | `tests/ipc-reliability.test.mts` |
| `renderer-reload` | `on` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | reloadRenderer (send) | `tests/ipc-reliability.test.mts` |
| `server-health-get` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getServerHealth (invoke) | `tests/ipc-reliability.test.mts` |
| `session-snapshot-get` | `handle` | 受信任寵物或設定面板 main frame | 無 payload；檢查 sender 並回傳受限狀態 | getSessionSnapshot (invoke) | `tests/ipc-reliability.test.mts` |
| `diagnostics-export` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | exportDiagnostics (invoke) | `tests/ipc-reliability.test.mts` |
| `server-health-retry` | `handle` | 設定面板 main frame | handler／controller 驗證 payload；拒絕無效輸入 | retryServerHealth (invoke) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `session-jump` | `handle` | 受信任寵物或設定面板 main frame | isValidSessionJumpRequest；無效輸入回安全預設或錯誤 | runSessionJump (invoke) | `tests/ipc-session-jump.test.mts`<br>`tests/session-jump.test.mts` |
| `pet-mouse-passthrough` | `on` | 寵物視窗 main frame | 型別；無效輸入回安全預設或錯誤 | setMousePassthrough (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `pet-hide-request` | `on` | 寵物視窗 main frame | handler／controller 驗證 payload；拒絕無效輸入 | requestPetHide (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-toggle` | `on` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | togglePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-resize` | `on` | 設定面板 main frame | 型別；無效輸入回安全預設或錯誤 | resizePanel (send) | `tests/ipc-inventory.test.mts`（頻道與寄件者契約） |
| `panel-reset-size` | `on` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | handler／controller 驗證 payload；拒絕無效輸入 | resetPanelSize (send) | `tests/ipc-window-controls.test.mts` |
| `panel-blur-lock` | `on` | 受信任 main frame；handler 以 isTrustedIpcSender 驗證 | 型別；長度／數量上限；無效輸入回安全預設或錯誤 | setPanelBlurLock (send) | `tests/ipc-window-controls.test.mts` |
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
