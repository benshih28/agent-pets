// 只有主題編輯器的 chunk 該引用這裡，驗證器才不會進共用 chunk。
// 這個檔案也會被 Node 直接執行的測試間接 import，所以維持相對路徑與 .ts 副檔名（`@/` 只有 Vite／vue-tsc 認得）。
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
