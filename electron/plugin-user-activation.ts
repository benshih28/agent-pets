export const PLUGIN_USER_ACTIVATION_WINDOW_MS = 1_000

export class PluginUserActivationGuard {
  private activatedAt = 0
  private keyboardAt = 0

  recordKeyboard(event: Pick<KeyboardEvent, 'isTrusted' | 'key' | 'repeat'>, now = Date.now()): void {
    if (!event.isTrusted || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    this.keyboardAt = now
    this.activatedAt = now
  }

  recordClick(event: Pick<MouseEvent, 'isTrusted' | 'detail'>, now = Date.now()): void {
    if (!event.isTrusted) return
    const isKeyboardFollowUp = event.detail === 0 && now - this.keyboardAt <= PLUGIN_USER_ACTIVATION_WINDOW_MS
    if (!isKeyboardFollowUp) this.activatedAt = now
  }

  consume(now = Date.now()): boolean {
    const activated = this.activatedAt > 0 && now - this.activatedAt <= PLUGIN_USER_ACTIVATION_WINDOW_MS
    this.activatedAt = 0
    return activated
  }
}
