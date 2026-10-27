# Publishing a plugin

The online catalog is a static JSON index. Plugin authors submit a package and its catalog entry to the catalog repository. A valid author signature lets users verify the publisher key; unsigned packages remain visibly unverified. The desktop app downloads only after the user opens the catalog and chooses an install or update.

## Prepare the package

1. Validate `plugin.json` against the [manifest guide](manifest.md) and [JSON Schema](plugin.schema.json).
2. Build the `.agentpet-plugin` archive and sign the exact archived files as described in [Signing](signing.md). Never include or commit the private signing key.
3. Calculate SHA-256 over the final archive bytes. Any archive change requires a new digest and signature.
4. Upload the package to a stable HTTPS URL on an allowed host. The app accepts catalog and package downloads only from its fixed public-host allowlist.

## Add an index entry

The root document has `schemaVersion: 1` and a `plugins` array. Each plugin id is unique. A version entry records the exact package size, digest, compatible API version, URL, and publication time:

```json
{
  "schemaVersion": 1,
  "plugins": [{
    "id": "hello-feed",
    "name": { "zh-TW": "問候通知", "en-US": "Hello Feed" },
    "description": { "zh-TW": "顯示一則問候通知。", "en-US": "Shows a greeting notification." },
    "author": "Example Author",
    "publicKeyFingerprint": "0123456789abcdef",
    "versions": [{
      "version": "1.0.0",
      "apiVersion": "1",
      "url": "https://raw.githubusercontent.com/example/plugins/main/packages/hello-feed-1.0.0.agentpet-plugin",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "size": 1234,
      "publishedAt": "2026-10-26T00:00:00.000Z"
    }]
  }]
}
```

The index is limited to 1 MiB, 500 plugins, and 20 versions per plugin. Packages are limited to 25 MiB. `sha256` is 64 lowercase hexadecimal characters and `size` is the archive size in bytes. The fingerprint is the first 16 lowercase hexadecimal characters of SHA-256 over the raw Ed25519 public key. Do not change a published version's package, digest, URL, or signing key in place; publish a new version instead.

## Submit for review

1. Open a pull request in the catalog repository with the package and its index entry.
2. Check that the archive's size and SHA-256 match the index, the signature verifies, the manifest is valid, and all package URLs use HTTPS on an allowed host.
3. Ask a reviewer to compare the package's declared permissions and contributions with the code and release notes.
4. Merge only after review. The app does not install in the background; users still choose the plugin and confirm signature or permission changes.

The catalog is not a safety certification. Authors remain responsible for their plugin, and users can inspect its declared permissions and signature fingerprint before installing.
