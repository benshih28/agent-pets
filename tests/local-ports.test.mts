import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_LOCAL_PORTS, resolveLocalPorts } from '../electron/main/ports.ts'

test('development builds may override ports with valid unprivileged values', () => {
  assert.deepEqual(
    resolveLocalPorts({ AGENT_PETS_EVENT_PORT: '27373', AGENT_PETS_PERMISSION_PORT: '80', AGENT_PETS_PRESENTATION_PORT: 'abc' }, false),
    { event: 27373, permission: DEFAULT_LOCAL_PORTS.permission, presentation: DEFAULT_LOCAL_PORTS.presentation },
  )
})

test('packaged builds ignore the environment completely', () => {
  assert.deepEqual(resolveLocalPorts({ AGENT_PETS_EVENT_PORT: '27373' }, true), DEFAULT_LOCAL_PORTS)
})
