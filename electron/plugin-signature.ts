import { createHash, createPublicKey, verify } from 'node:crypto'

export const PLUGIN_SIGNATURE_FILENAME = 'signature.json'
export const PLUGIN_SIGNATURE_MAX_BYTES = 4 * 1024

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface PluginSignatureFile {
  alg: 'ed25519'
  publicKey: string
  signature: string
}

export type PluginSignatureResult =
  | { status: 'unsigned' }
  | { status: 'valid'; fingerprint: string }
  | { status: 'invalid' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function decodeCanonicalBase64(value: unknown, expectedBytes: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length > 128 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength !== expectedBytes || decoded.toString('base64') !== value) return null
  return decoded
}

function isSafePayloadPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || value.startsWith('/') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

export function parsePluginSignatureFile(value: unknown): { publicKey: Uint8Array; signature: Uint8Array } | null {
  if (!isRecord(value)
    || Object.keys(value).length !== 3
    || Object.keys(value).some(key => !['alg', 'publicKey', 'signature'].includes(key))
    || value.alg !== 'ed25519') return null
  const publicKey = decodeCanonicalBase64(value.publicKey, 32)
  const signature = decodeCanonicalBase64(value.signature, 64)
  return publicKey && signature ? { publicKey, signature } : null
}

export function createPluginSignaturePayload(files: ReadonlyMap<string, Uint8Array>): Uint8Array | null {
  if (!(files instanceof Map) || files.size > 64) return null
  const entries: Array<[string, Uint8Array]> = []
  for (const [path, bytes] of files) {
    if (!isSafePayloadPath(path) || !(bytes instanceof Uint8Array)) return null
    if (path === PLUGIN_SIGNATURE_FILENAME) continue
    entries.push([path, bytes])
  }
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  const lines = entries.map(([path, bytes]) => `${path}\t${createHash('sha256').update(bytes).digest('hex')}\n`)
  return Buffer.from(lines.join(''), 'utf8')
}

export function pluginPublicKeyFingerprint(publicKey: Uint8Array): string | null {
  if (!(publicKey instanceof Uint8Array) || publicKey.byteLength !== 32) return null
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

export function formatPluginKeyFingerprint(fingerprint: unknown): string | null {
  if (typeof fingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(fingerprint)) return null
  return fingerprint.match(/.{4}/g)?.join(' ') ?? null
}

export function verifyPluginSignature(files: ReadonlyMap<string, Uint8Array>): PluginSignatureResult {
  const signatureBytes = files.get(PLUGIN_SIGNATURE_FILENAME)
  if (signatureBytes === undefined) return { status: 'unsigned' }
  if (!(signatureBytes instanceof Uint8Array) || signatureBytes.byteLength > PLUGIN_SIGNATURE_MAX_BYTES) {
    return { status: 'invalid' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(signatureBytes)) as unknown
  } catch {
    return { status: 'invalid' }
  }
  const parsed = parsePluginSignatureFile(raw)
  const payload = createPluginSignaturePayload(files)
  if (!parsed || !payload) return { status: 'invalid' }
  const fingerprint = pluginPublicKeyFingerprint(parsed.publicKey)
  if (!fingerprint) return { status: 'invalid' }
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, parsed.publicKey]),
      format: 'der',
      type: 'spki',
    })
    return verify(null, payload, key, parsed.signature)
      ? { status: 'valid', fingerprint }
      : { status: 'invalid' }
  } catch {
    return { status: 'invalid' }
  }
}
