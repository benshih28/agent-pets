import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HOOK_STARTUP_MARKER_LINGER_MS, hookStartupMarkerName, writeHookStartupMarker } from '../electron/main/hook-startup-marker.ts'

// app 啟動標記：hook 連線被拒時只有看到它才重試（見 docs/dev/hook-delivery.md）。

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-startup-marker-'))
}

test('the marker is named after the event port and holds only the owner pid', () => {
  const root = tempDir()
  const dir = path.join(root, '.desktop-pet')
  try {
    writeHookStartupMarker(dir, 27373, { pid: 4242 })
    const file = path.join(dir, hookStartupMarkerName(27373))
    assert.equal(path.basename(file), 'event-port-27373.starting')
    assert.equal(fs.readFileSync(file, 'utf8'), '4242\n')
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('clear removes only a marker this process wrote', () => {
  const dir = tempDir()
  try {
    const first = writeHookStartupMarker(dir, 17373, { pid: 1 })
    // 新實例（例如 --relaunch）接手後，舊實例結束時不能刪掉新實例的標記。
    const second = writeHookStartupMarker(dir, 17373, { pid: 2 })
    first.clear()
    assert.equal(fs.readFileSync(path.join(dir, hookStartupMarkerName(17373)), 'utf8'), '2\n')
    second.clear()
    assert.equal(fs.existsSync(path.join(dir, hookStartupMarkerName(17373))), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('listening removes the marker after a short linger, once', () => {
  const dir = tempDir()
  try {
    const timers: Array<{ callback: () => void; ms: number }> = []
    const marker = writeHookStartupMarker(dir, 17373, { pid: 7, setTimer: (callback, ms) => timers.push({ callback, ms }) })
    marker.listening()
    marker.listening()
    assert.equal(timers.length, 1)
    assert.equal(timers[0].ms, HOOK_STARTUP_MARKER_LINGER_MS)
    assert.equal(fs.existsSync(path.join(dir, hookStartupMarkerName(17373))), true)
    timers[0].callback()
    assert.equal(fs.existsSync(path.join(dir, hookStartupMarkerName(17373))), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a symlink planted at the marker path is replaced, never written through', { skip: process.platform === 'win32' }, () => {
  const dir = tempDir()
  try {
    const target = path.join(dir, 'victim.txt')
    fs.writeFileSync(target, 'keep me')
    fs.symlinkSync(target, path.join(dir, hookStartupMarkerName(17373)))
    writeHookStartupMarker(dir, 17373, { pid: 9 })
    assert.equal(fs.readFileSync(target, 'utf8'), 'keep me')
    assert.equal(fs.lstatSync(path.join(dir, hookStartupMarkerName(17373))).isFile(), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an unwritable directory never throws', () => {
  const root = tempDir()
  try {
    const blocker = path.join(root, 'not-a-dir')
    fs.writeFileSync(blocker, '')
    const marker = writeHookStartupMarker(path.join(blocker, 'child'), 17373)
    marker.clear()
    marker.listening()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
