import './support/src-alias.mts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, mock, test } from 'node:test'
import { createRenderer, defineComponent, ref, watch, type ComputedRef, type Ref } from 'vue'

const START = Date.UTC(2026, 10, 10, 8, 0, 0)
const MINUTE = 60_000

const globals = globalThis as unknown as Record<string, unknown>
globals.document = {
  hidden: false,
  documentElement: { lang: '' },
  addEventListener() {},
  removeEventListener() {},
}

mock.timers.enable({ apis: ['setInterval', 'Date'], now: START })
after(() => mock.timers.reset())

const { locale } = await import('../src/i18n.ts')
const { useRelativeTime } = await import('../src/composables/useRelativeTime.ts')
const { FEED_RELATIVE_TIME } = await import('../src/utils/intl-format.ts')

const renderer = createRenderer<object, object>({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null,
})

function mountLabel(createdAt: number): { at: Ref<number>; label: ComputedRef<string>; unmount: () => void } {
  const at = ref(createdAt)
  let label!: ComputedRef<string>
  const app = renderer.createApp(defineComponent({
    setup() {
      label = useRelativeTime(at, FEED_RELATIVE_TIME)
      return () => null
    },
  }))
  app.mount({})
  return { at, label, unmount: () => app.unmount() }
}

test('the inbox label follows the shared clock instead of the mount-time now', () => {
  locale.value = 'en-US'
  const { at, label, unmount } = mountLabel(Date.now())
  try {
    assert.equal(label.value, 'now')

    mock.timers.tick(5 * MINUTE)
    assert.equal(label.value, '5 minutes ago', 'an open inbox ages its rows')

    at.value = Date.now()
    assert.equal(label.value, 'now')

    mock.timers.tick(2 * MINUTE)
    assert.equal(label.value, '2 minutes ago')
  } finally {
    unmount()
  }
})

test('a timestamp ahead of the clock is clamped to now, never shown in the future', () => {
  locale.value = 'en-US'
  const { at, label, unmount } = mountLabel(Date.now())
  try {
    at.value = Date.now() + 3 * MINUTE
    assert.equal(label.value, 'now')
    assert.doesNotMatch(label.value, /^in /)
  } finally {
    unmount()
  }
})

test('per-second ticks only notify readers when the label text changes', () => {
  locale.value = 'en-US'
  const { label, unmount } = mountLabel(Date.now() - 2 * MINUTE)
  const seen: string[] = []
  const stop = watch(label, value => { seen.push(value) }, { flush: 'sync' })
  try {
    assert.equal(label.value, '2 minutes ago')
    for (let second = 0; second < 90; second += 1) mock.timers.tick(1_000)
    assert.deepEqual(seen, ['3 minutes ago'])
  } finally {
    stop()
    unmount()
  }
})

test('the inbox no longer captures a setup-time Date.now()', () => {
  const inbox = readFileSync(new URL('../src/components/plugin-panel/PluginNotificationInbox.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(inbox, /Date\.now\(\)/)
  assert.match(inbox, /<RelativeTime\b[^>]*:at="record\.item\.createdAt"/)
})
