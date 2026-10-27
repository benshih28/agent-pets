# Packaging and versioning

Packages are ZIP files with the `.agentpet-plugin` extension. The ZIP root directly contains `plugin.json` and its declared entry, for example:

```text
hello-feed.agentpet-plugin
├── plugin.json
└── dist/main.js
```

Allowed file extensions: `.js`, `.json`, `.png`, `.webp`, `.html`, `.css`. Total extracted size is at most 5 MB, with at most 64 files and 5 MB per file; `plugin.json` is at most 256 KB. Traversal, duplicate paths, symbolic links, unsupported extensions, and HTML outside the allowed panel directory are rejected. Folder loading uses the same strict validation.

`version` accepts integer `major.minor.patch` only. A higher version is shown as **Update**, a lower version as **Downgrade**, and the same version as **Reinstall**. Added permissions are listed and require renewed consent; declining preserves the old version. New plugins start disabled.

Only `apiVersion: "1"` is currently accepted. Other API major versions are shown as incompatible and rejected; no cross-major transition period has been announced. Developer-mode folder edits are revalidated and loaded after a 500 ms debounce; folder loading does not sign or package the plugin. Create a `.agentpet-plugin` package yourself for distribution.

The online catalog can list newer compatible versions. An update is not downloaded until the user selects **Update**. The install confirmation inspects the downloaded manifest and shows any added permissions or signing-key changes before the user approves it. Optional daily checks fetch only the catalog index and never download or install packages.
