import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PRESENTATION_REACTIONS } from '../src/types/presentation.ts'

const animation = readFileSync(new URL('../src/components/PetAnimation.vue', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/components/PetAnimation.css', import.meta.url), 'utf8')
const desktopPet = readFileSync(new URL('../src/components/DesktopPet.vue', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/components/ui/icons.ts', import.meta.url), 'utf8')

test('every presentation reaction has its own motion class and icon mark', () => {
  for (const reaction of PRESENTATION_REACTIONS) {
    assert.match(styles, new RegExp(`\\.pet-canvas\\.pet-react-${reaction}\\b`), `missing motion for ${reaction}`)
    assert.match(animation, new RegExp(`${reaction}: '[a-z]+'`), `missing mark for ${reaction}`)
  }
  const marks = [...animation.matchAll(/(?:happy|curious|thinking|surprised|encouraging): '([a-z]+)'/g)].map(m => m[1])
  for (const icon of new Set(marks)) assert.match(icons, new RegExp(`\\b${icon}:`), `Icon.vue lacks ${icon}`)
  assert.equal(new Set(marks).size, 5, 'each reaction needs a distinct mark')
})

test('reactions requested over MCP are shown even when motion effects are off', () => {
  const watcher = desktopPet.slice(desktopPet.indexOf('watch(() => store.presentationReaction'))
  const body = watcher.slice(0, watcher.indexOf('function playAchievementReward'))
  assert.doesNotMatch(body, /reactionsActive/)
  assert.match(body, /playReaction\(kind\)/)
})
