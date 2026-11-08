#!/usr/bin/env node

/**
 * install.mjs - command-line front end for the Agent Pets integrations.
 *
 * This is a thin wrapper around the same installer the app's Setup Wizard uses
 * (electron/setup.ts), so there is only one implementation to keep correct: it never overwrites a
 * config file it cannot parse, backs up before changing, and removes only Agent Pets' own entries.
 * It runs the TypeScript source directly, so it needs a repository checkout and Node.js 22.18+
 * (or `node --experimental-strip-types integrations/install.mjs` on 22.6+).
 *
 * Usage:
 *   node integrations/install.mjs                  # install all
 *   node integrations/install.mjs --opencode       # OpenCode plugin only
 *   node integrations/install.mjs --codex          # Codex hooks only
 *   node integrations/install.mjs --claude-code    # Claude Code (CLI & Desktop) hooks only
 *   node integrations/install.mjs --list           # show the supported integrations
 *
 * Uninstall:
 *   node integrations/install.mjs --uninstall               # remove all hooks (keeps tokens)
 *   node integrations/install.mjs --uninstall --codex       # remove Codex hooks only
 *   node integrations/install.mjs --uninstall --everything  # also remove tokens and ~/.desktop-pet
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

const TARGETS = {
  '--opencode': 'opencode',
  '--codex': 'codex',
  '--claude-code': 'claudeCode',
}

let setup
let environment
try {
  environment = await import('../electron/setup-environment.ts')
  setup = await import('../electron/setup.ts')
} catch (error) {
  console.error('Could not load the Agent Pets installer.')
  console.error('Run this from a repository checkout with Node.js 22.18+, or add --experimental-strip-types on 22.6+.')
  console.error(String(error && error.message ? error.message : error))
  process.exit(1)
}

environment.configureSetupEnvironment({
  integrationsDir: () => here,
  nodePath: () => (process.platform === 'win32' ? process.execPath : null),
})

if (args.includes('--list')) {
  for (const [flag, target] of Object.entries(TARGETS)) console.log(`${flag}  (${target})`)
  process.exit(0)
}

const uninstall = args.includes('--uninstall')
const everything = args.includes('--everything')
const flag = args.find(arg => arg in TARGETS)
const unknown = args.filter(arg => arg.startsWith('--') && !(arg in TARGETS) && !['--uninstall', '--everything', '--list', '--all'].includes(arg))
if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown.join(' ')}`)
  process.exit(2)
}
const target = flag ? TARGETS[flag] : undefined

try {
  if (uninstall) {
    setup.uninstallIntegration(target ?? (everything ? 'all' : undefined))
    console.log('Agent Pets integrations removed. Restart your coding tools.')
  } else {
    if (target !== 'opencode') {
      // Resolve Node.js up front so a missing install fails before any file is touched.
      await setup.prepareNodeForInstall()
    }
    const results = setup.installIntegration(target)
    for (const result of results) {
      console.log(`${result.status === 'written' ? 'wrote     ' : 'unchanged '} ${result.path}`)
      if (result.backupPath) console.log(`  backup: ${result.backupPath}`)
    }
    console.log('Done. Restart your coding tools for the hooks to load.')
  }
} catch (error) {
  console.error(String(error && error.message ? error.message : error))
  process.exit(1)
}
