import assert from 'node:assert/strict'
import test from 'node:test'
import {
  electronDevArgv,
  electronDevEnvironment,
  GPU_SAFE_DEV_MODE,
  shouldDisableDevHardwareAcceleration,
} from '../electron/dev-runtime.ts'

test('Electron development startup preserves Chromium sandboxing', () => {
  assert.deepEqual(electronDevArgv(), ['.'])
  assert.equal(electronDevArgv().includes('--no-sandbox'), false)
})

test('development safe mode passes an isolated main-process preference', () => {
  const source = {
    VITE_DEV_SERVER_URL: 'http://localhost:5173',
    AGENT_PETS_GPU_SAFE_MODE: 'stale',
  }
  const safe = electronDevEnvironment(source, true)
  const standard = electronDevEnvironment(source, false)

  assert.equal(GPU_SAFE_DEV_MODE, 'gpu-safe')
  assert.notEqual(safe, source)
  assert.equal(safe.VITE_DEV_SERVER_URL, source.VITE_DEV_SERVER_URL)
  assert.equal(safe.AGENT_PETS_GPU_SAFE_MODE, '1')
  assert.equal('AGENT_PETS_GPU_SAFE_MODE' in standard, false)
  assert.equal(source.AGENT_PETS_GPU_SAFE_MODE, 'stale')
})

test('hardware acceleration fallback is restricted to Windows Vite safe mode', () => {
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', false, 'http://localhost:5173', '1'),
    true,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', false, 'http://localhost:5173', undefined),
    false,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', false, 'http://localhost:5173', '0'),
    false,
  )
  assert.equal(shouldDisableDevHardwareAcceleration('win32', false, undefined, '1'), false)
  assert.equal(
    shouldDisableDevHardwareAcceleration('win32', true, 'http://localhost:5173', '1'),
    false,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('darwin', false, 'http://localhost:5173', '1'),
    false,
  )
  assert.equal(
    shouldDisableDevHardwareAcceleration('linux', false, 'http://localhost:5173', '1'),
    false,
  )
})
