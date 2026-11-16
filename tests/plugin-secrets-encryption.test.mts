import assert from 'node:assert/strict'
import test from 'node:test'
import { createSafeStorageEncryption, type SafeStorageLike } from '../electron/plugin-secrets.ts'

function storage(available: boolean, backend?: string): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from(value),
    decryptString: value => value.toString(),
    ...(backend === undefined ? {} : { getSelectedStorageBackend: () => backend }),
  }
}

test('macOS and Windows trust isEncryptionAvailable as is', () => {
  assert.equal(createSafeStorageEncryption(storage(true), 'darwin').isEncryptionAvailable(), true)
  assert.equal(createSafeStorageEncryption(storage(true), 'win32').isEncryptionAvailable(), true)
  assert.equal(createSafeStorageEncryption(storage(false), 'win32').isEncryptionAvailable(), false)
})

test('Linux real keyrings are available; basic_text and unknown are not encryption', () => {
  for (const backend of ['gnome_libsecret', 'kwallet5', 'kwallet6']) {
    assert.equal(createSafeStorageEncryption(storage(true, backend), 'linux').isEncryptionAvailable(), true, backend)
  }
  for (const backend of ['basic_text', 'unknown']) {
    assert.equal(createSafeStorageEncryption(storage(true, backend), 'linux').isEncryptionAvailable(), false, backend)
  }
  assert.equal(createSafeStorageEncryption(storage(true), 'linux').isEncryptionAvailable(), false)
  assert.equal(createSafeStorageEncryption(storage(false, 'gnome_libsecret'), 'linux').isEncryptionAvailable(), false)
})

test('a throwing storage backend reads as unavailable and crypto calls pass through', () => {
  const throwing: SafeStorageLike = {
    ...storage(true, 'gnome_libsecret'),
    getSelectedStorageBackend: () => { throw new Error('not ready') },
  }
  assert.equal(createSafeStorageEncryption(throwing, 'linux').isEncryptionAvailable(), false)
  const wrapped = createSafeStorageEncryption(storage(true), 'darwin')
  assert.equal(wrapped.decryptString(wrapped.encryptString('x')), 'x')
})
