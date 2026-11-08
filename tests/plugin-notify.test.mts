import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import {
  ACTION_TOAST_MS, MAX_VISIBLE_TOASTS, SUCCESS_TOAST_MS, toastDuration, usePluginNotify,
} from '../src/composables/plugin/usePluginNotify.ts'

test('toast duration: errors persist, successes and actions time out', () => {
  assert.equal(toastDuration({ tone: 'error' }), null)
  assert.equal(toastDuration({ tone: 'success' }), SUCCESS_TOAST_MS)
  assert.equal(toastDuration({ tone: 'success', action: { label: 'x', run() {} } }), ACTION_TOAST_MS)
  assert.equal(toastDuration({ tone: 'info', durationMs: 123 }), 123)
})

test('success toast auto-dismisses while an error stays until dismissed', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const notifier = usePluginNotify()
    notifier.notify({ tone: 'success', text: 'ok' })
    const errorId = notifier.notify({ tone: 'error', text: 'bad', detail: 'code_x' })
    assert.equal(notifier.toasts.value.length, 2)
    mock.timers.tick(SUCCESS_TOAST_MS)
    assert.deepEqual(notifier.toasts.value.map(toast => toast.text), ['bad'])
    assert.equal(notifier.toasts.value[0].sticky, true)
    notifier.dismiss(errorId)
    assert.equal(notifier.toasts.value.length, 0)
  } finally {
    mock.timers.reset()
  }
})

test('identical messages replace each other and the stack is bounded', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const notifier = usePluginNotify()
    notifier.notify({ tone: 'error', text: 'same' })
    notifier.notify({ tone: 'error', text: 'same' })
    assert.equal(notifier.toasts.value.length, 1)
    for (let index = 0; index < MAX_VISIBLE_TOASTS + 2; index += 1) notifier.notify({ tone: 'error', text: `e${index}` })
    assert.equal(notifier.toasts.value.length, MAX_VISIBLE_TOASTS)
    assert.equal(notifier.toasts.value.at(-1)?.text, `e${MAX_VISIBLE_TOASTS + 1}`)
    notifier.dispose()
  } finally {
    mock.timers.reset()
  }
})

test('running a toast action dismisses it first and then runs it once', () => {
  const notifier = usePluginNotify()
  let runs = 0
  const id = notifier.notify({ tone: 'success', text: 'done', action: { label: 'Undo', run: () => { runs += 1 } } })
  notifier.runAction(id)
  notifier.runAction(id)
  assert.equal(runs, 1)
  assert.equal(notifier.toasts.value.length, 0)
  notifier.dispose()
})
