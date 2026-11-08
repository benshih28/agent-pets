import { isAbsolute, join } from 'node:path'
import type { AgentAdapterId, AdapterInstallTarget, InstallReport } from '../src/types/agent-adapter'
import { reportFromWrites } from './install-outcome.ts'
import { projectAdapterCapabilities, type AgentAdapterOperations, type AdapterInspection } from './agent-adapter.ts'
import { configuredHookExecutable, isCodexHooksFeatureEnabled } from './hook-config.ts'
import {
  agentPresence,
  claudeCodeSettingsPath,
  codexConfigPath,
  codexHooksPath,
  fileExists,
  hookScriptDeployPath,
  hookScriptIsCurrent,
  hookScriptPath,
  installIntegration,
  openCodeCliPluginPath,
  openCodeDesktopPluginPath,
  openCodePluginIsCurrent,
  prepareNodeForInstall,
  readFile,
  uninstallIntegration,
} from './setup.ts'

// `code` is `<check id>.<status>`; the renderer localizes it (onboarding.check.*) and the English
// message is only a fallback for unknown codes.
function check(id: string, status: 'pass' | 'warn' | 'fail', message: string) {
  return { id, status, code: `${id}.${status}`, message }
}

function isAgentPetsHookConfigured(settingsPath: string, expectedArg: string): boolean {
  const raw = readFile(settingsPath)
  if (!raw) return false

  try {
    const config = JSON.parse(raw) as { hooks?: unknown }
    const events = config.hooks
    if (!events || typeof events !== 'object') return false
    const hookPaths = [hookScriptPath(), join(hookScriptDeployPath(), 'agent-hook.cmd')]
    return Object.values(events as Record<string, unknown>).some(groups => {
      if (!Array.isArray(groups)) return false
      return groups.some(group => {
        if (!group || typeof group !== 'object' || !Array.isArray((group as { hooks?: unknown }).hooks)) return false
        return (group as { hooks: unknown[] }).hooks.some(hook => {
          if (!hook || typeof hook !== 'object' || (hook as { type?: unknown }).type !== 'command') return false
          const command = typeof (hook as { command?: unknown }).command === 'string'
            ? (hook as { command: string }).command
            : ''
          const args = Array.isArray((hook as { args?: unknown }).args)
            ? (hook as { args: unknown[] }).args.join(' ')
            : ''
          const combined = `${command} ${args}`
          return hookPaths.some(hookPath => combined.includes(hookPath)) && combined.includes(expectedArg)
        })
      })
    })
  } catch {
    return false
  }
}

function nodeCheck(settingsPath: string) {
  const executable = configuredHookExecutable(settingsPath)
  if (executable === null) return check('node', 'fail', 'No Node.js executable is configured for the hook.')
  // A bare "node" depends on PATH, which GUI-launched agents often lack.
  const usable = isAbsolute(executable) && fileExists(executable)
  return check('node', usable ? 'pass' : 'fail', usable
    ? 'The Node.js executable used by the hook exists.'
    : 'The Node.js executable used by the hook was not found.')
}

function agentPresenceCheck(found: boolean) {
  return check('agent-present', found ? 'pass' : 'warn', found
    ? 'The tool has been used on this machine.'
    : 'No configuration folder for this tool was found; it may not be installed.')
}

function inspectOpenCode(): AdapterInspection {
  const cli = fileExists(openCodeCliPluginPath())
  const desktop = fileExists(openCodeDesktopPluginPath())
  const installed = cli || desktop
  const outdated = (cli && !openCodePluginIsCurrent('cli')) || (desktop && !openCodePluginIsCurrent('desktop'))
  // Either side is enough: most people use only the CLI or only the Desktop app.
  const health = !installed ? 'needs_install' : outdated ? 'degraded' : 'ready'
  return {
    installed,
    health,
    message: installed ? 'At least one OpenCode plugin is installed.' : 'The OpenCode plugin is not installed.',
    checks: [
      check('opencode-cli', cli ? 'pass' : 'warn', cli ? 'OpenCode CLI plugin found.' : 'OpenCode CLI plugin not found.'),
      check('opencode-desktop', desktop ? 'pass' : 'warn', desktop ? 'OpenCode Desktop plugin found.' : 'OpenCode Desktop plugin not found.'),
      ...(installed ? [check('plugin-current', outdated ? 'warn' : 'pass', outdated ? 'An installed plugin is out of date.' : 'Installed plugins are current.')] : []),
      check('permission-channel', 'pass', 'Permission replies use a dedicated local broker channel.'),
      agentPresenceCheck(agentPresence().opencode),
    ],
  }
}

function inspectCodex(): AdapterInspection {
  const hooks = fileExists(codexHooksPath())
  const script = fileExists(hookScriptPath())
  const enabled = isCodexHooksFeatureEnabled(readFile(codexConfigPath()))
  const configured = isAgentPetsHookConfigured(codexHooksPath(), ' codex')
  const node = configured ? nodeCheck(codexHooksPath()) : null
  const outdated = script && !hookScriptIsCurrent()
  const healthy = hooks && script && configured && enabled && node?.status !== 'fail' && !outdated
  const partiallyInstalled = hooks || script || configured
  return {
    installed: hooks && script && configured && enabled,
    health: healthy ? 'ready' : partiallyInstalled ? 'degraded' : 'needs_install',
    message: healthy ? 'Codex hooks are set up.' : 'Codex hooks need to be installed or repaired.',
    checks: [
      check('hooks-file', hooks ? 'pass' : 'fail', hooks ? 'Codex hooks.json found.' : 'Codex hooks.json not found.'),
      check('hooks-enabled', enabled ? 'pass' : 'fail', enabled ? 'Codex hooks are enabled.' : 'Codex hooks are not enabled in config.toml.'),
      check('hook-script', script ? 'pass' : 'fail', script ? 'Shared hook script found.' : 'Shared hook script not found.'),
      ...(script ? [check('hook-script-current', outdated ? 'warn' : 'pass', outdated ? 'The hook script is out of date.' : 'The hook script is current.')] : []),
      check('hook-command', configured ? 'pass' : 'fail', configured ? 'The Agent Pets hook command is configured.' : 'The Agent Pets hook command is not configured.'),
      ...(node ? [node] : []),
      agentPresenceCheck(agentPresence().codex),
    ],
  }
}

function inspectClaudeCode(): AdapterInspection {
  const settings = fileExists(claudeCodeSettingsPath())
  const script = fileExists(hookScriptPath())
  const configured = isAgentPetsHookConfigured(claudeCodeSettingsPath(), 'claude')
  const node = configured ? nodeCheck(claudeCodeSettingsPath()) : null
  const outdated = script && !hookScriptIsCurrent()
  const healthy = settings && script && configured && node?.status !== 'fail' && !outdated
  const partiallyInstalled = settings || script || configured
  return {
    installed: settings && script && configured,
    health: healthy ? 'ready' : partiallyInstalled ? 'degraded' : 'needs_install',
    message: healthy ? 'Claude Code hooks are set up.' : 'Claude Code hooks need to be installed or repaired.',
    checks: [
      check('settings-file', settings ? 'pass' : 'fail', settings ? 'Claude Code settings found.' : 'Claude Code settings not found.'),
      check('hook-script', script ? 'pass' : 'fail', script ? 'Shared hook script found.' : 'Shared hook script not found.'),
      ...(script ? [check('hook-script-current', outdated ? 'warn' : 'pass', outdated ? 'The hook script is out of date.' : 'The hook script is current.')] : []),
      check('hook-command', configured ? 'pass' : 'fail', configured ? 'The Agent Pets hook command is configured.' : 'The Agent Pets hook command is not configured.'),
      ...(node ? [node] : []),
      agentPresenceCheck(agentPresence().claude),
    ],
  }
}

export interface AgentAdapterOperationsOptions {
  /** Main-process preference: whether Claude Code permissions may be answered from the pet. */
  claudePermissionRespondEnabled?: () => boolean
}

export function createAgentAdapterOperations(options: AgentAdapterOperationsOptions = {}): AgentAdapterOperations {
  return {
    capabilities: (id, base) => projectAdapterCapabilities(id, base, options.claudePermissionRespondEnabled?.() === true),
    inspect(id: AgentAdapterId): AdapterInspection {
      switch (id) {
        case 'opencode': return inspectOpenCode()
        case 'codex': return inspectCodex()
        case 'claude-code': return inspectClaudeCode()
        case 'generic-http':
          return {
            installed: true,
            health: 'ready',
            message: 'The local /v1/events ingress is available through the authenticated receiver.',
            checks: [
              check('loopback', 'pass', 'The receiver binds to loopback only.'),
              check('token', 'pass', 'Requests need the token created at install time.'),
              check('permissions', 'pass', 'Generic HTTP is observe-only and cannot answer Permission.'),
            ],
          }
      }
    },
    async prepare(target: AdapterInstallTarget): Promise<void> {
      // Codex and Claude Code write a Node command into their hooks; OpenCode's plugin does not.
      if (target !== 'opencode') await prepareNodeForInstall()
    },
    install(target: AdapterInstallTarget): InstallReport {
      return reportFromWrites(installIntegration(target))
    },
    uninstall(target: AdapterInstallTarget): void {
      uninstallIntegration(target)
    },
  }
}
