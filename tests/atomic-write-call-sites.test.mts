import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeJsonAtomic } from '../electron/desktop-preferences.ts'
import { OnboardingStore } from '../electron/onboarding-state.ts'
import { prepareUserImage, storeUserImage } from '../electron/panel-theme-images.ts'
import { UserPanelThemeStore, writeUserPanelThemeExportFile } from '../electron/panel-theme-user-store.ts'
import { writePluginDataJson } from '../electron/plugin-data-file.ts'
import { PluginRegistry } from '../electron/plugin-registry.ts'
import { ProjectMcpRegistryStore } from '../electron/project-mcp-registry.ts'
import { installProjectMcp } from '../electron/project-mcp-setup.ts'
import { BACKUP_MARKER, listBackups, writeConfigSafely, writeTextAtomic } from '../electron/safe-config-write.ts'
import { POSIX_FILE_MODES, SKIP_WITHOUT_FILE_SYMLINKS } from './support/fs-capabilities.mts'
import { builtinDefinition, png } from './support/panel-theme-fixtures.mts'
import { removeTempTree } from './support/temp-dir.mts'

// 以呼叫點為單位固定「暫存檔 → rename → 權限 → 失敗清理」的現有行為。
// 每個案例都經由該模組公開的寫入入口，所以底層實作換掉後同一組斷言仍適用。

type SymlinkPolicy = 'refuse' | 'follow' | 'replace'

interface CallSite {
  target: string
  /** 第 n 輪寫入；吞掉錯誤的呼叫點要把失敗轉成 throw。 */
  write(round: number): void
}

interface CallSiteCase {
  name: string
  setup(directory: string): CallSite
  temporaryName: RegExp
  /** POSIX 上寫入後的權限；undefined 表示不固定。 */
  mode?: number
  symlink: SymlinkPolicy
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

function fsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: injected`), { code })
}

/** 暫時替換 node:fs 的一個函式；ESM 的具名匯出要靠 syncBuiltinESMExports 才會跟著換。 */
function withFsPatch<K extends 'renameSync' | 'writeFileSync'>(
  name: K,
  replacement: (original: typeof fs[K]) => typeof fs[K],
  run: () => void,
): void {
  const original = fs[name]
  fs[name] = replacement(original)
  syncBuiltinESMExports()
  try {
    run()
  } finally {
    fs[name] = original
    syncBuiltinESMExports()
  }
}

const isTemporary = (file: unknown): file is string => typeof file === 'string' && file.endsWith('.tmp')

/** rename 暫存檔時依序丟出 codes 裡的錯誤（用完後走真正的 rename），並記下暫存檔路徑。 */
function withRenameFailures(codes: string[], run: (temporaryPaths: string[]) => void): void {
  const temporaryPaths: string[] = []
  withFsPatch('renameSync', original => ((from: fs.PathLike, to: fs.PathLike) => {
    if (isTemporary(from)) {
      temporaryPaths.push(from)
      assert.equal(fs.existsSync(from), true, 'temporary file exists when it is renamed')
      const code = codes.shift()
      if (code) throw fsError(code)
    }
    original(from, to)
  }) as typeof fs.renameSync, () => run(temporaryPaths))
}

// Windows 偶有防毒或索引程式短暫鎖檔，renameSyncWithRetry 會以同一個暫存路徑重試，
// 所以 rename 次數不固定；要固定的是「一次寫入只用一個暫存檔」，因此比對不重複的路徑。
function onlyTemporaryPath(temporaryPaths: readonly string[]): string {
  const distinct = [...new Set(temporaryPaths)]
  assert.equal(distinct.length, 1, 'one write uses exactly one temporary file')
  return distinct[0]!
}

/** 寫入暫存檔時先寫一半再丟出 ENOSPC，模擬寫到一半磁碟滿。 */
function withPartialWriteFailure(run: () => void): void {
  withFsPatch('writeFileSync', original => ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
    if (typeof file === 'number' || isTemporary(file)) {
      original(file, typeof data === 'string' ? data.slice(0, 1) : new Uint8Array(data.buffer, data.byteOffset, 1), options)
      throw fsError('ENOSPC')
    }
    original(file, data, options)
  }) as typeof fs.writeFileSync, run)
}

function withDirectory(run: (directory: string) => void): void {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pets-atomic-sites-')))
  try { run(directory) } finally { removeTempTree(directory) }
}

function listing(directory: string): string[] {
  return fs.readdirSync(directory).sort()
}

function snapshot(target: string): { listing: string[]; bytes: Buffer } {
  return { listing: listing(path.dirname(target)), bytes: fs.readFileSync(target) }
}

function assertUntouched(target: string, before: ReturnType<typeof snapshot>): void {
  assert.deepEqual(listing(path.dirname(target)), before.listing, 'no temporary file is left behind')
  assert.deepEqual(fs.readFileSync(target), before.bytes, 'the target keeps its previous content')
}

function canSymlink(): boolean {
  return SKIP_WITHOUT_FILE_SYMLINKS === false
}

const CASES: CallSiteCase[] = [
  {
    name: 'safe-config-write writeTextAtomic (user dotfiles)',
    setup: directory => {
      const target = path.join(directory, 'settings.json')
      return { target, write: round => writeTextAtomic(target, `{"round":${round}}\n`, { mode: 0o600 }) }
    },
    temporaryName: /^\.settings\.json\.\d+\.\d+\.tmp$/,
    mode: 0o600,
    symlink: 'follow',
  },
  {
    name: 'onboarding-state OnboardingStore.update',
    setup: directory => {
      const target = path.join(directory, 'onboarding.json')
      return { target, write: round => { new OnboardingStore(target, () => 1_000 + round).update('completed') } }
    },
    temporaryName: /^\.onboarding\.json\.\d+\.\d+\.tmp$/,
    mode: 0o600,
    symlink: 'follow',
  },
  {
    name: 'desktop-preferences writeJsonAtomic (desktop preferences, panel size)',
    setup: directory => {
      const target = path.join(directory, 'desktop-preferences.json')
      return { target, write: round => writeJsonAtomic(target, { round }) }
    },
    temporaryName: /^\.desktop-preferences\.json\.\d+\.\d+\.tmp$/,
    mode: 0o600,
    symlink: 'replace',
  },
  {
    name: 'plugin-data-file writePluginDataJson',
    setup: directory => {
      const target = path.join(directory, 'data.json')
      return { target, write: round => writePluginDataJson(target, { round }) }
    },
    temporaryName: /^\.data\.json\.\d+\.\d+\.tmp$/,
    mode: 0o600,
    symlink: 'refuse',
  },
  {
    name: 'project-mcp-registry ProjectMcpRegistryStore.register',
    setup: directory => {
      const target = path.join(directory, 'project-mcp-registry.json')
      const project = path.join(directory, 'project')
      return { target, write: round => new ProjectMcpRegistryStore(target, { now: () => `2026-11-10T00:00:0${round}.000Z` }).register(project) }
    },
    temporaryName: /^\.project-mcp-registry\.json\.\d+\.\d+\.tmp$/,
    mode: 0o600,
    symlink: 'refuse',
  },
  {
    name: 'project-mcp-setup installProjectMcp (project .mcp.json)',
    setup: directory => {
      const target = path.join(directory, '.mcp.json')
      return {
        target,
        write: round => {
          const summary = installProjectMcp(directory, {
            nodeExecutable: path.join(directory, `node-${round}`, 'node.exe'),
            bridgePath: path.join(directory, '.desktop-pet', 'presentation-mcp.mjs'),
          }, { clients: ['claude'], updateStale: true })
          const result = summary.results[0]!
          if (result.status === 'error') throw new Error(`install failed: ${result.message}`)
        },
      }
    },
    temporaryName: /^\.\.mcp\.json\.\d+\.\d+\.tmp$/,
    mode: 0o644,
    symlink: 'refuse',
  },
  {
    name: 'panel-theme-user-store UserPanelThemeStore.update',
    setup: directory => {
      const store = new UserPanelThemeStore(directory, { randomHex: () => '00000000000a' })
      const id = store.create('Theme', builtinDefinition()).id
      const target = path.join(store.directory, `${id}.json`)
      return {
        target,
        write: round => {
          const definition = builtinDefinition()
          definition.shape = { radiusSm: round + 4, radiusMd: round + 8, radiusLg: round + 12 }
          store.update(id, definition)
        },
      }
    },
    temporaryName: /^\.u-[0-9a-f]{12}\.[0-9a-f-]{36}\.tmp$/,
    mode: 0o600,
    symlink: 'refuse',
  },
  {
    name: 'panel-theme-user-store writeUserPanelThemeExportFile',
    setup: directory => {
      const target = path.join(directory, 'theme-export.json')
      return { target, write: round => writeUserPanelThemeExportFile(target, `{"round":${round}}`) }
    },
    temporaryName: new RegExp(`^\\.theme-export\\.json\\.${UUID}\\.tmp$`),
    mode: 0o600,
    symlink: 'replace',
  },
  {
    name: 'plugin-registry PluginRegistry.setStatus',
    setup: directory => {
      const target = path.join(directory, 'plugins', 'registry.json')
      fs.mkdirSync(path.dirname(target))
      fs.writeFileSync(target, JSON.stringify({
        plugins: { 'demo-plugin': { id: 'demo-plugin', currentVersion: '1.0.0', status: 'installed', installedAt: 1 } },
      }))
      const registry = new PluginRegistry(directory)
      return {
        target,
        write: round => {
          if (!registry.setStatus('demo-plugin', round % 2 === 0 ? 'disabled_crashed' : 'enabled')) throw new Error('setStatus failed')
        },
      }
    },
    temporaryName: new RegExp(`^\\.registry\\.json\\.\\d+\\.${UUID}\\.tmp$`),
    mode: 0o600,
    symlink: 'refuse',
  },
]

for (const site of CASES) {
  test(`${site.name}: writes through a uniquely named temporary file in the target directory`, () => {
    withDirectory(directory => {
      const { target, write } = site.setup(directory)
      write(0)
      const before = fs.readFileSync(target)
      withRenameFailures([], () => write(1))
      assert.notDeepEqual(fs.readFileSync(target), before)
      assert.equal(listing(path.dirname(target)).some(name => name.endsWith('.tmp')), false)
      if (POSIX_FILE_MODES && site.mode !== undefined) assert.equal(fs.statSync(target).mode & 0o777, site.mode)
    })
  })

  test(`${site.name}: temporary file name format is stable`, () => {
    withDirectory(directory => {
      const { target, write } = site.setup(directory)
      write(0)
      withRenameFailures([], temporaryPaths => {
        write(1)
        const temporaryPath = onlyTemporaryPath(temporaryPaths)
        assert.equal(path.dirname(temporaryPath), path.dirname(target))
        assert.match(path.basename(temporaryPath), site.temporaryName)
      })
    })
  })

  test(`${site.name}: a failed rename keeps the target and removes the temporary file`, () => {
    withDirectory(directory => {
      const { target, write } = site.setup(directory)
      write(0)
      const before = snapshot(target)
      withRenameFailures(['EXDEV'], () => assert.throws(() => write(1)))
      assertUntouched(target, before)
    })
  })

  test(`${site.name}: a transient Windows rename lock is retried, elsewhere it fails cleanly`, () => {
    withDirectory(directory => {
      const { target, write } = site.setup(directory)
      write(0)
      const before = snapshot(target)
      withRenameFailures(['EBUSY'], temporaryPaths => {
        if (process.platform === 'win32') {
          write(1)
          assert.ok(temporaryPaths.length >= 2, 'the temporary file is renamed again after EBUSY')
          onlyTemporaryPath(temporaryPaths)
          assert.notDeepEqual(fs.readFileSync(target), before.bytes)
          assert.deepEqual(listing(path.dirname(target)), before.listing)
        } else {
          assert.throws(() => write(1))
          assertUntouched(target, before)
        }
      })
    })
  })

  test(`${site.name}: a write that fails midway keeps the target and removes the temporary file`, () => {
    withDirectory(directory => {
      const { target, write } = site.setup(directory)
      write(0)
      const before = snapshot(target)
      withPartialWriteFailure(() => assert.throws(() => write(1)))
      assertUntouched(target, before)
    })
  })

  test(`${site.name}: symlinked target is ${site.symlink === 'refuse' ? 'refused' : site.symlink === 'follow' ? 'followed' : 'replaced'}`, { skip: SKIP_WITHOUT_FILE_SYMLINKS }, () => {
    withDirectory(directory => {
      const { target, write } = site.setup(directory)
      write(0)
      const elsewhere = path.join(directory, 'elsewhere')
      fs.mkdirSync(elsewhere)
      const real = path.join(elsewhere, 'real.json')
      fs.copyFileSync(target, real)
      const original = fs.readFileSync(real)
      fs.rmSync(target)
      fs.symlinkSync(real, target)
      if (site.symlink === 'refuse') {
        assert.throws(() => write(1))
        assert.equal(fs.lstatSync(target).isSymbolicLink(), true)
        assert.deepEqual(fs.readFileSync(real), original)
      } else if (site.symlink === 'follow') {
        write(1)
        assert.equal(fs.lstatSync(target).isSymbolicLink(), true, 'the dotfile link is kept')
        assert.notDeepEqual(fs.readFileSync(real), original, 'the link target receives the new content')
        assert.equal(listing(elsewhere).some(name => name.endsWith('.tmp')), false)
      } else {
        write(1)
        assert.equal(fs.lstatSync(target).isSymbolicLink(), false, 'the link itself is replaced by a regular file')
        assert.deepEqual(fs.readFileSync(real), original, 'the link target is never written through')
      }
    })
  })
}

test('panel-theme-images storeUserImage: content-addressed write, cleanup and symlink refusal', () => {
  withDirectory(userData => {
    const prepared = prepareUserImage(png(256, 256))
    assert.equal(prepared.ok, true)
    if (!prepared.ok) return
    const directory = path.join(userData, 'panel-theme-images', 'demo-plugin')
    const target = path.join(directory, prepared.file)

    withRenameFailures(['EXDEV'], () => assert.throws(() => storeUserImage(userData, 'demo-plugin', prepared)))
    assert.deepEqual(listing(directory), [], 'a failed rename leaves no file')

    withPartialWriteFailure(() => assert.throws(() => storeUserImage(userData, 'demo-plugin', prepared)))
    assert.deepEqual(listing(directory), [], 'a failed write leaves no file')

    withRenameFailures([], temporaryPaths => {
      storeUserImage(userData, 'demo-plugin', prepared)
      assert.match(path.basename(onlyTemporaryPath(temporaryPaths)), new RegExp(`^\\.${prepared.sha256}\\.${UUID}\\.tmp$`))
    })
    assert.deepEqual(listing(directory), [prepared.file])
    assert.deepEqual(new Uint8Array(fs.readFileSync(target)), prepared.bytes)
    if (POSIX_FILE_MODES) assert.equal(fs.statSync(target).mode & 0o777, 0o600)

    // 相同內容已存在：不再寫入。
    withRenameFailures([], temporaryPaths => {
      storeUserImage(userData, 'demo-plugin', prepared)
      assert.equal(temporaryPaths.length, 0)
    })

    if (canSymlink()) {
      const real = path.join(userData, 'real.bin')
      fs.writeFileSync(real, 'other')
      fs.rmSync(target)
      fs.symlinkSync(real, target)
      assert.throws(() => storeUserImage(userData, 'demo-plugin', prepared))
      assert.equal(fs.readFileSync(real, 'utf8'), 'other')
    }
  })
})

test('project-mcp-setup keeps the existing mode of a shared project config', { skip: !POSIX_FILE_MODES && 'POSIX modes only' }, () => {
  withDirectory(directory => {
    const target = path.join(directory, '.mcp.json')
    fs.writeFileSync(target, '{}\n', { mode: 0o640 })
    fs.chmodSync(target, 0o640)
    const summary = installProjectMcp(directory, {
      nodeExecutable: path.join(directory, 'node.exe'),
      bridgePath: path.join(directory, '.desktop-pet', 'presentation-mcp.mjs'),
    }, { clients: ['claude'] })
    assert.equal(summary.results[0]!.status, 'installed')
    assert.equal(fs.statSync(target).mode & 0o777, 0o640)
  })
})

test('safe-config-write keeps an existing dotfile mode when none is given', { skip: !POSIX_FILE_MODES && 'POSIX modes only' }, () => {
  withDirectory(directory => {
    const target = path.join(directory, 'config.toml')
    fs.writeFileSync(target, 'a = 1\n')
    fs.chmodSync(target, 0o640)
    writeTextAtomic(target, 'a = 2\n')
    assert.equal(fs.statSync(target).mode & 0o777, 0o640)
  })
})

test('writeConfigSafely backs up before writing, keeps the backup when the write fails, and skips identical content', () => {
  withDirectory(directory => {
    const target = path.join(directory, 'settings.json')
    fs.writeFileSync(target, '{"a":1}\n')

    const unchanged = writeConfigSafely(target, '{"a":1}\n')
    assert.deepEqual(unchanged, { status: 'unchanged', path: target, backupPath: null })
    assert.deepEqual(listBackups(target), [])

    const written = writeConfigSafely(target, '{"a":2}\n')
    assert.equal(written.status, 'written')
    assert.ok(written.backupPath && path.basename(written.backupPath).startsWith(`settings.json${BACKUP_MARKER}`))
    assert.equal(fs.readFileSync(written.backupPath, 'utf8'), '{"a":1}\n')
    if (POSIX_FILE_MODES) assert.equal(fs.statSync(written.backupPath).mode & 0o777, 0o600)

    withRenameFailures(['EXDEV'], () => assert.throws(() => writeConfigSafely(target, '{"a":3}\n'), { code: 'EXDEV' }))
    assert.equal(fs.readFileSync(target, 'utf8'), '{"a":2}\n')
    const backups = listBackups(target)
    assert.equal(backups.length, 2, 'the backup taken before the failed write is kept for recovery')
    assert.equal(fs.readFileSync(backups.at(-1)!, 'utf8'), '{"a":2}\n')
    assert.equal(listing(directory).some(name => name.endsWith('.tmp')), false)
  })
})
