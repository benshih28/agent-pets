// Display form of an Electron accelerator (e.g. "CommandOrControl+Shift+Y")
// for the current platform: macOS uses modifier symbols, others spell out
// "Ctrl+Shift+Y". Feed it the accelerator that is actually registered rather
// than a hard-coded label.
export type AcceleratorPlatform = 'mac' | 'other'

const MAC: Record<string, string> = {
  commandorcontrol: '⌘',
  cmdorctrl: '⌘',
  command: '⌘',
  cmd: '⌘',
  meta: '⌘',
  control: '⌃',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
}

const OTHER: Record<string, string> = {
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  command: 'Win',
  cmd: 'Win',
  meta: 'Win',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
}

export function detectPlatform(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): AcceleratorPlatform {
  return /mac|iphone|ipad/i.test(platform) ? 'mac' : 'other'
}

/** Individual key caps, e.g. ["Ctrl", "Shift", "Y"] — render each in a <kbd>. */
export function acceleratorKeys(accelerator: string, platform: AcceleratorPlatform = detectPlatform()): string[] {
  const table = platform === 'mac' ? MAC : OTHER
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => table[part.toLowerCase()] ?? (part.length === 1 ? part.toUpperCase() : part))
}

export function formatAccelerator(accelerator: string, platform: AcceleratorPlatform = detectPlatform()): string {
  const keys = acceleratorKeys(accelerator, platform)
  return platform === 'mac' ? keys.join('') : keys.join('+')
}
