import assert from 'node:assert/strict'
import test from 'node:test'
import { asRecord, isRecord, recordOrEmpty } from '../electron/value-guards.ts'

const NON_RECORDS: readonly unknown[] = [
  null,
  undefined,
  [],
  [{ a: 1 }],
  0,
  1,
  Number.NaN,
  '',
  'text',
  true,
  false,
  10n,
  Symbol('s'),
  () => ({}),
]

test('isRecord accepts plain and null-prototype objects but rejects null, arrays, functions and primitives', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord({ a: 1 }), true)
  assert.equal(isRecord(Object.create(null)), true)
  for (const value of NON_RECORDS) assert.equal(isRecord(value), false, String(typeof value))
})

test('asRecord returns the same object or null, with the same rules as isRecord', () => {
  const plain = { a: 1 }
  const bare = Object.create(null) as Record<string, unknown>
  bare.b = 2
  assert.equal(asRecord(plain), plain)
  assert.equal(asRecord(bare), bare)
  assert.equal(asRecord(bare)?.b, 2)
  for (const value of NON_RECORDS) assert.equal(asRecord(value), null, String(typeof value))
})

test('recordOrEmpty returns the same object, or a fresh empty object for anything else', () => {
  const plain = { a: 1 }
  const bare = Object.create(null) as Record<string, unknown>
  assert.equal(recordOrEmpty(plain), plain)
  assert.equal(recordOrEmpty(bare), bare)
  for (const value of NON_RECORDS) {
    const result = recordOrEmpty(value)
    assert.deepEqual(result, {}, String(typeof value))
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
  }
  // 每次都是新物件：呼叫端寫入不會汙染下一次的預設值。
  const first = recordOrEmpty(null)
  first.polluted = true
  assert.deepEqual(recordOrEmpty(null), {})
  // 陣列上的欄位不會被讀到：陣列一律當空物件。
  assert.equal(recordOrEmpty(Object.assign([], { height: 40 })).height, undefined)
})
