// The app an agent session runs in (terminal, IDE or desktop app), as reported by the hook from a
// few environment variables. Only the short allowlisted id below ever reaches the renderer; the
// macOS bundle id stays in the main process and must be one of `bundleIds` to be activated.

export type HostKind = 'terminal' | 'ide' | 'desktop' | 'unknown'

export type HostAppId =
  | 'apple-terminal'
  | 'iterm2'
  | 'warp'
  | 'ghostty'
  | 'wezterm'
  | 'kitty'
  | 'alacritty'
  | 'hyper'
  | 'tabby'
  | 'windows-terminal'
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'jetbrains'
  | 'claude-desktop'
  | 'unknown'

/** Renderer-facing host projection; `switchable` is computed by the main process. */
export interface AgentHost {
  kind: HostKind
  app: HostAppId
  /** Main-process verdict: macOS and an allowlisted bundle id (the allowlist is the boundary). */
  switchable?: boolean
}

interface HostAppDefinition {
  kind: Exclude<HostKind, 'unknown'>
  /** Product name; a proper noun, not translated. */
  label: string
  /** Exact macOS bundle ids this app may be activated by. */
  bundleIds: ReadonlyArray<string>
  /** Used when the hook reported the app but no bundle id; absent when the id is ambiguous. */
  defaultBundleId?: string
}

export const HOST_APPS: Readonly<Record<Exclude<HostAppId, 'unknown'>, HostAppDefinition>> = Object.freeze({
  'apple-terminal': { kind: 'terminal', label: 'Terminal', bundleIds: ['com.apple.Terminal'], defaultBundleId: 'com.apple.Terminal' },
  iterm2: { kind: 'terminal', label: 'iTerm2', bundleIds: ['com.googlecode.iterm2'], defaultBundleId: 'com.googlecode.iterm2' },
  warp: { kind: 'terminal', label: 'Warp', bundleIds: ['dev.warp.Warp-Stable', 'dev.warp.Warp-Preview'], defaultBundleId: 'dev.warp.Warp-Stable' },
  ghostty: { kind: 'terminal', label: 'Ghostty', bundleIds: ['com.mitchellh.ghostty'], defaultBundleId: 'com.mitchellh.ghostty' },
  wezterm: { kind: 'terminal', label: 'WezTerm', bundleIds: ['com.github.wez.wezterm'], defaultBundleId: 'com.github.wez.wezterm' },
  kitty: { kind: 'terminal', label: 'kitty', bundleIds: ['net.kovidgoyal.kitty'], defaultBundleId: 'net.kovidgoyal.kitty' },
  alacritty: { kind: 'terminal', label: 'Alacritty', bundleIds: ['org.alacritty'], defaultBundleId: 'org.alacritty' },
  hyper: { kind: 'terminal', label: 'Hyper', bundleIds: ['co.zeit.hyper'], defaultBundleId: 'co.zeit.hyper' },
  tabby: { kind: 'terminal', label: 'Tabby', bundleIds: ['org.tabby'], defaultBundleId: 'org.tabby' },
  'windows-terminal': { kind: 'terminal', label: 'Windows Terminal', bundleIds: [] },
  vscode: { kind: 'ide', label: 'VS Code', bundleIds: ['com.microsoft.VSCode'], defaultBundleId: 'com.microsoft.VSCode' },
  'vscode-insiders': { kind: 'ide', label: 'VS Code Insiders', bundleIds: ['com.microsoft.VSCodeInsiders'], defaultBundleId: 'com.microsoft.VSCodeInsiders' },
  cursor: { kind: 'ide', label: 'Cursor', bundleIds: ['com.todesktop.230313mzl4w4u92'], defaultBundleId: 'com.todesktop.230313mzl4w4u92' },
  windsurf: { kind: 'ide', label: 'Windsurf', bundleIds: ['com.exafunction.windsurf'], defaultBundleId: 'com.exafunction.windsurf' },
  zed: { kind: 'ide', label: 'Zed', bundleIds: ['dev.zed.Zed', 'dev.zed.Zed-Preview'], defaultBundleId: 'dev.zed.Zed' },
  jetbrains: {
    kind: 'ide',
    label: 'JetBrains IDE',
    bundleIds: [
      'com.jetbrains.intellij', 'com.jetbrains.intellij.ce', 'com.jetbrains.WebStorm', 'com.jetbrains.pycharm',
      'com.jetbrains.pycharm.ce', 'com.jetbrains.goland', 'com.jetbrains.rider', 'com.jetbrains.CLion',
      'com.jetbrains.PhpStorm', 'com.jetbrains.rubymine', 'com.google.android.studio',
    ],
  },
  'claude-desktop': { kind: 'desktop', label: 'Claude', bundleIds: ['com.anthropic.claudefordesktop'], defaultBundleId: 'com.anthropic.claudefordesktop' },
})

export function isHostAppId(value: unknown): value is HostAppId {
  return value === 'unknown' || (typeof value === 'string' && Object.hasOwn(HOST_APPS, value))
}

export function hostAppLabel(app: HostAppId | undefined): string | null {
  if (!app || app === 'unknown') return null
  return HOST_APPS[app].label
}
