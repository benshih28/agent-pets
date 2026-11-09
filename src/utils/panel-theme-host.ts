// 渲染端引用主程序純函式模組（顏色文法、主題驗證器、診斷）的唯一入口。這些模組不 import
// Electron 或 Node，與主程序共用同一份實作，編輯器的判斷才會和安裝／套用時完全一致。
//
// 只有主題編輯器的 chunk（PanelThemeEditor 與 panel-theme-editor/-palette 工具）引用這裡，所以
// 驗證器只在第一次開啟編輯器時才載入，不進共用 chunk。這個檔案也會被 Node 直接執行的測試
// 間接 import，所以維持相對路徑與 .ts 副檔名（`@/` 只有 Vite／vue-tsc 認得）。
export {
  formatPanelThemeColor,
  oklchToRgb,
  parsePanelThemeColor,
  rgbToOklab,
  rgbToOklch,
  withAlpha,
  type PanelThemeRgba,
} from '../../electron/panel-theme-color.ts'
export {
  builtinPanelThemeProperties,
  panelThemeSharedProperties,
  petStatusProperties,
  type ResolvedPanelTheme,
} from '../../electron/plugin-panel-themes.ts'
export { validateUserPanelTheme } from '../../electron/panel-theme-diagnostics.ts'
