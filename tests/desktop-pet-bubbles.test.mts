import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const desktopPetSource = readFileSync(new URL('../src/components/DesktopPet.vue', import.meta.url), 'utf8')

test('agent toast and activity share one out-in transition after presentation say', () => {
  const branch = desktopPetSource.match(/<Transition v-else-if="bubbleSelection === 'agent-toast' \|\| bubbleSelection === 'activity'" name="toast" mode="out-in">([\s\S]*?)<\/Transition>/)
  assert.ok(branch)
  const content = branch?.[1] ?? ''
  assert.match(content, /<div\s+v-if="store\.toast"/)
  assert.match(content, /<div v-else-if="!isMultiPet && store\.activityText"/)

  const presentationSayPosition = desktopPetSource.indexOf('<Transition v-else-if="bubbleSelection === \'presentation-say\'')
  const toastActivityPosition = desktopPetSource.indexOf(branch?.[0] ?? '')
  assert.ok(presentationSayPosition >= 0)
  assert.ok(toastActivityPosition > presentationSayPosition)
})
