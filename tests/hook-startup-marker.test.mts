import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { HOOK_STARTUP_MARKER_LINGER_MS, HOOK_STARTUP_MARKER_MAX_AGE_MS, hookStartupMarkerName, writeHookStartupMarker } from '../electron/main/hook-startup-marker.ts'
import { hookStartupLocation } from '../electron/main/hook-startup-location.ts'
import { resolveLocalPorts } from '../electron/main/ports.ts'
import { LOCAL_PORT_ENV } from '../src/types/local-wire.ts'
import { configureSetupEnvironment, setupEnvironment } from '../electron/setup-environment.ts'
import { hookScriptDeployPath } from '../electron/setup.ts'
import { removeTempTree } from './support/temp-dir.mts'

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
    removeTempTree(root)
  }
})

const markerFile = (dir: string, port = 17373) => path.join(dir, hookStartupMarkerName(port))

/** 保證已結束的 pid：啟動子程序等它結束。 */
function deadPid(): number {
  const result = spawnSync(process.execPath, ['-e', ''])
  assert.ok(result.pid)
  return result.pid
}

function ageMarker(file: string, ms: number): void {
  const old = new Date(Date.now() - ms)
  fs.utimesSync(file, old, old)
}

test('clear removes only a marker this process wrote', () => {
  const dir = tempDir()
  try {
    const first = writeHookStartupMarker(dir, 17373, { pid: process.pid })
    // 新實例（例如 --relaunch）取得鎖、接手後，舊實例結束時不能刪掉新實例的標記。
    const second = writeHookStartupMarker(dir, 17373, { pid: process.pid + 1 })
    second.claim()
    first.clear()
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), `${process.pid + 1}\n`)
    second.clear()
    assert.equal(fs.existsSync(markerFile(dir)), false)
  } finally {
    removeTempTree(dir)
  }
})

test('a fresh marker owned by a live process is neither overwritten nor removed by a second launch', () => {
  const dir = tempDir()
  try {
    const first = writeHookStartupMarker(dir, 17373, { pid: process.pid })
    // 第二個啟動的程序（拿不到鎖）：不能蓋掉第一個實例的標記，clear() 也不能移除它。
    const second = writeHookStartupMarker(dir, 17373, { pid: process.pid + 1 })
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), `${process.pid}\n`)
    second.clear()
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), `${process.pid}\n`)
    first.clear()
    assert.equal(fs.existsSync(markerFile(dir)), false)
  } finally {
    removeTempTree(dir)
  }
})

test('a stale marker or one owned by a dead process is replaced', () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(markerFile(dir), `${process.pid}\n`)
    ageMarker(markerFile(dir), HOOK_STARTUP_MARKER_MAX_AGE_MS + 5_000)
    writeHookStartupMarker(dir, 17373, { pid: 4242 })
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), '4242\n')

    fs.writeFileSync(markerFile(dir), `${deadPid()}\n`)
    writeHookStartupMarker(dir, 17373, { pid: 4343 })
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), '4343\n')
  } finally {
    removeTempTree(dir)
  }
})

test('a garbled or oversized marker is replaced', () => {
  const dir = tempDir()
  try {
    for (const content of ['not a pid', 'x'.repeat(100), '']) {
      fs.writeFileSync(markerFile(dir), content)
      writeHookStartupMarker(dir, 17373, { pid: 4242 })
      assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), '4242\n')
    }
  } finally {
    removeTempTree(dir)
  }
})

test('claim after the single-instance lock takes over a live owner, and only our clear removes it', () => {
  const dir = tempDir()
  try {
    // 舊實例還在退出中、標記是它的：新實例啟動時不寫，取得鎖後 claim 接手。
    const old = writeHookStartupMarker(dir, 17373, { pid: process.pid })
    const next = writeHookStartupMarker(dir, 17373, { pid: process.pid + 1 })
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), `${process.pid}\n`)
    next.claim()
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), `${process.pid + 1}\n`)
    old.clear()
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), `${process.pid + 1}\n`)
    next.clear()
    assert.equal(fs.existsSync(markerFile(dir)), false)
  } finally {
    removeTempTree(dir)
  }
})

test('claim recreates a marker the previous instance already removed, and is a no-op once listening', () => {
  const dir = tempDir()
  try {
    const timers: Array<() => void> = []
    const marker = writeHookStartupMarker(dir, 17373, { pid: 7, setTimer: callback => timers.push(callback) })
    fs.rmSync(markerFile(dir))
    marker.claim()
    assert.equal(fs.readFileSync(markerFile(dir), 'utf8'), '7\n')
    marker.listening()
    timers[0]()
    marker.claim()
    assert.equal(fs.existsSync(markerFile(dir)), false, 'claim after the port is listening must not write a marker')
  } finally {
    removeTempTree(dir)
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
    removeTempTree(dir)
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
    removeTempTree(dir)
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
    marker.claim()
  } finally {
    removeTempTree(root)
  }
})

// electron/main/early-hook-startup-marker.ts 在 main.ts 其餘模組載入前就寫標記，所以不能呼叫 runtime.ts 的 localPorts()
// 與 setup.ts 的 hookScriptDeployPath()；它改用 hookStartupLocation，這裡確認兩邊算出同一組值。
test('the early marker location equals the event port and deploy folder main.ts used before', () => {
  const environments: Array<[Record<string, string | undefined>, boolean]> = [
    [{}, false],
    [{ [LOCAL_PORT_ENV.event]: '27373' }, false],
    [{ [LOCAL_PORT_ENV.event]: '27373' }, true],
    [{ [LOCAL_PORT_ENV.event]: 'nope' }, false],
    [{ [LOCAL_PORT_ENV.event]: '80' }, false],
  ]
  for (const [env, isPackaged] of environments) {
    const location = hookStartupLocation(env, isPackaged)
    assert.equal(location.eventPort, resolveLocalPorts(env, isPackaged).event, JSON.stringify([env, isPackaged]))
    assert.equal(location.directory, hookScriptDeployPath())
  }
  // 打包版忽略環境變數；開發版讀得到覆寫。
  assert.equal(hookStartupLocation({ [LOCAL_PORT_ENV.event]: '27373' }, true).eventPort, 17373)
  assert.equal(hookStartupLocation({ [LOCAL_PORT_ENV.event]: '27373' }, false).eventPort, 27373)
})

test('the early marker location follows the configured setup home directory', () => {
  const original = setupEnvironment().homeDir
  const home = path.join(os.tmpdir(), 'agent-pets-early-marker-home')
  try {
    configureSetupEnvironment({ homeDir: () => home })
    assert.equal(hookStartupLocation({}, false, setupEnvironment().homeDir()).directory, hookScriptDeployPath())
  } finally {
    configureSetupEnvironment({ homeDir: original })
  }
})
