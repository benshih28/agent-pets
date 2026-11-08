import assert from 'node:assert/strict'
import test from 'node:test'
import { sectionAchievements } from '../src/utils/achievement-order.ts'
import type { AchievementView } from '../src/types/achievement.ts'

const view = (id: string, current: number, target: number, extra: Partial<AchievementView> = {}): AchievementView => ({
  id: id as never, version: 1, titleKey: 'achievementHelloWorld', descriptionKey: 'achievementHelloWorldHelp',
  visualReward: 'sparkle', unlocked: false, tokenQuality: 'none', category: 'milestone', hidden: false,
  progress: { current, target }, ...extra,
})

test('in-progress achievements sort by closeness, unlocked by recency, hidden ones are held back', () => {
  const sections = sectionAchievements([
    view('far', 1, 100),
    view('near', 6, 7),
    view('tie-small', 0, 1),
    view('tie-big', 0, 50),
    view('old', 1, 1, { unlocked: true, unlockedAt: 10 }),
    view('new', 1, 1, { unlocked: true, unlockedAt: 20 }),
    view('secret', 0, 1, { hidden: true }),
  ])
  assert.deepEqual(sections.inProgress.map(item => item.id), ['near', 'far', 'tie-small', 'tie-big'])
  assert.deepEqual(sections.unlocked.map(item => item.id), ['new', 'old'])
  assert.deepEqual(sections.hidden.map(item => item.id), ['secret'])
})
