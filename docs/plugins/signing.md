# Plugin package signatures

A package may contain a root-level `signature.json` beside `plugin.json`:

```json
{
  "alg": "ed25519",
  "publicKey": "<base64-encoded 32-byte Ed25519 public key>",
  "signature": "<base64-encoded 64-byte Ed25519 signature>"
}
```

The signature covers every package file except the root-level `signature.json`. Sort the exact package-relative paths in ascending, locale-independent lexical order. For each file, append one UTF-8 line in this form, ending with `\n`:

```text
<path>\t<lowercase SHA-256 hex of the file bytes>\n
```

Sign the UTF-8 bytes of the complete line list with Ed25519. The verifier rejects malformed JSON, extra fields, unknown algorithms, non-canonical base64, incorrect key or signature lengths, and signatures that do not match the package contents. A valid signature proves that the package matches a signature made by the corresponding private key; it does not prove the author's identity or that the code is safe.

## Node.js example

This example uses Node's built-in `node:crypto` module and no third-party signing package. `files` must contain the exact package-relative paths and bytes that will be archived, and `privateKey` must be a `KeyObject` loaded from the author's protected local key store. Do not put the private key in the package, source repository, or registry.

```js
import { createHash, createPublicKey, sign } from 'node:crypto'

export function createSignatureFile(files, privateKey, publicKey) {
  const payload = Buffer.from(
    [...files.entries()]
      .filter(([path]) => path !== 'signature.json')
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([path, bytes]) => `${path}\t${createHash('sha256').update(bytes).digest('hex')}\n`)
      .join(''),
    'utf8',
  )
  const rawPublicKey = createPublicKey(publicKey).export({ type: 'spki', format: 'der' }).subarray(-32)
  const signature = sign(null, payload, privateKey)
  return Buffer.from(JSON.stringify({
    alg: 'ed25519',
    publicKey: rawPublicKey.toString('base64'),
    signature: signature.toString('base64'),
  }), 'utf8')
}
```

Add the returned bytes to the package as `signature.json` after constructing the payload. Recompute the signature whenever any other package file changes. Keep private keys offline or in a dedicated secret store with backups and restricted access. If a key is lost or compromised, users must explicitly review a new fingerprint before trusting a replacement key.

## Trust on first use

On the first signed installation, Agent Pets displays the signature state and binds the author's public-key fingerprint to that plugin. The fingerprint is the first 16 lowercase hexadecimal characters of SHA-256 over the raw 32-byte public key; the UI groups it in four-character blocks. Later signed updates must use the same key. A key change or a transition from signed to unsigned requires explicit confirmation, with Cancel focused by default. Unsigned packages remain installable with a clear warning. Developer-folder installs skip signature validation and are marked as unverified.
