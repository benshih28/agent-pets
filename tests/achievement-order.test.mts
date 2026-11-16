import assert from 'node:assert/strict'
import test from 'node:test'
import { sectionAchievements } from '../src/utils/achievement-order.ts'
import type { AchievementId, AchievementView } from '../src/types/achievement.ts'

const view = (id: AchievementId, current: number, target: number, extra: Partial<AchievementView> = {}): AchievementView => ({
  id, version: 1, titleKey: 'achievementHelloWorld', descriptionKey: 'achievementHelloWorldHelp',
  visualReward: 'sparkle', unlocked: false, tokenQuality: 'none', category: 'milestone', hidden: false,
  progress: { current, target }, ...extra,
})

test('in-progress achievements sort by closeness, unlocked by recency, hidden ones are held back', () => {
  const sections = sectionAchievements([
    view('getting_serious', 1, 100),
    view('hello_world', 6, 7),
    view('night_owl', 0, 1),
    view('one_million', 0, 50),
    view('busy_day', 1, 1, { unlocked: true, unlockedAt: 10 }),
    view('loyal_companion', 1, 1, { unlocked: true, unlockedAt: 20 }),
    view('old_friend', 0, 1, { hidden: true }),
  ])
  assert.deepEqual(sections.inProgress.map(item => item.id), ['hello_world', 'getting_serious', 'night_owl', 'one_million'])
  assert.deepEqual(sections.unlocked.map(item => item.id), ['loyal_companion', 'busy_day'])
  assert.deepEqual(sections.hidden.map(item => item.id), ['old_friend'])
})
