import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const WINDOWS = process.platform === 'win32'
const MAC = process.platform === 'darwin'
const POWERSHELL = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe'

function normalize(value) {
  return String(value ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

function basename(value) {
  const normalized = normalize(value)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function dirname(value) {
  const normalized = normalize(value)
  const separator = normalized.lastIndexOf('/')
  return separator < 0 ? '' : normalized.slice(0, separator)
}

// Returning null is intentionally fail-closed: an unrelated Electron process must never be stopped.
export function isProjectAgentPetsProcess(processInfo, workspaceRoot) {
  const root = normalize(workspaceRoot)
  const executablePath = normalize(processInfo?.ExecutablePath)
  const commandLine = normalize(processInfo?.CommandLine)
  const localElectron = `${root}/node_modules/electron/dist/electron.exe`
  const unpackedPet = `${root}/release/win-unpacked/agent pets.exe`
  const releaseDirectory = `${root}/release`
  const localElectronMac = `${root}/node_modules/electron/dist/electron.app/contents/macos/electron`
  const macAppSuffix = '/agent pets.app/contents/macos/agent pets'

  if (executablePath === unpackedPet) return 'release/win-unpacked/Agent Pets.exe'

  if (
    dirname(executablePath) === releaseDirectory &&
    basename(executablePath).startsWith('agentpets-') &&
    basename(executablePath).endsWith('.exe')
  ) {
    return 'release portable AgentPets executable'
  }

  // The workspace path in the command line is a second boundary: the same Electron binary running another app must not be stopped.
  if (executablePath === localElectron && commandLine.includes(root)) {
    return 'workspace Electron process'
  }

  // macOS unpacked output lands under release/<arch>/ (mac, mac-arm64, ...), so match the bundle suffix.
  if (executablePath.startsWith(`${root}/release/`) && executablePath.endsWith(macAppSuffix)) {
    return 'release macOS Agent Pets.app'
  }

  if (executablePath === localElectronMac && commandLine.includes(root)) {
    return 'workspace Electron process (macOS)'
  }

  // WMI can omit ExecutablePath for protected processes; only accept the strongest command-line signatures.
  if (!executablePath && commandLine.includes(root)) {
    if (commandLine.includes('release/win-unpacked/agent pets.exe')) {
      return 'release/win-unpacked/Agent Pets.exe (command line)'
    }
    if (commandLine.includes('/release/agentpets-') && commandLine.endsWith('.exe')) {
      return 'release portable AgentPets executable (command line)'
    }
    if (commandLine.includes('/node_modules/electron/dist/electron.exe')) {
      return 'workspace Electron process (command line)'
    }
  }

  if (!executablePath && commandLine.includes(root)) {
    if (commandLine.includes('/release/') && commandLine.includes(macAppSuffix)) {
      return 'release macOS Agent Pets.app (command line)'
    }
    if (commandLine.includes('/node_modules/electron/dist/electron.app/contents/macos/electron')) {
      return 'workspace Electron process (macOS, command line)'
    }
  }

  return null
}

function parseProcessJson(output) {
  const trimmed = String(output ?? '').replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  return Array.isArray(parsed) ? parsed : [parsed]
}

function listWindowsProcesses() {
  const query =
    "$ErrorActionPreference = 'Stop'; " +
    'Get-CimInstance Win32_Process | ' +
    'Select-Object ProcessId,Name,ExecutablePath,CommandLine | ' +
    'ConvertTo-Json -Compress'
  try {
    return parseProcessJson(
      execFileSync(
        POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', query],
        { encoding: 'utf8', timeout: 10_000, windowsHide: true },
      ),
    )
  } catch {
    // Some managed Windows sessions deny Win32_Process access; never fall back to a name-only kill.
    const fallbackQuery =
      "$ErrorActionPreference = 'Stop'; " +
      "$names = @('Agent Pets','electron'); " +
      'Get-Process | Where-Object { $names -contains $_.ProcessName -or $_.ProcessName -like \'AgentPets-*\' } | ' +
      'ForEach-Object { $path = $null; try { $path = $_.Path } catch {}; ' +
      '[pscustomobject]@{ ProcessId = $_.Id; Name = $_.ProcessName; ExecutablePath = $path; CommandLine = $null } } | ' +
      'ConvertTo-Json -Compress'
    try {
      return parseProcessJson(
        execFileSync(
          POWERSHELL,
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', fallbackQuery],
          { encoding: 'utf8', timeout: 10_000, windowsHide: true },
        ),
      )
    } catch {
      throw new Error('無法讀取 Windows 程序清單；為避免誤觸其他 Electron，停止建置。')
    }
  }
}

function listMacProcesses() {
  // The command line may contain spaces (".app/Contents/MacOS/Agent Pets"), so it cannot be split from the
  // executable path; leave ExecutablePath unset for the command-line-only matching branch.
  const result = spawnSync('ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) {
    throw new Error('無法讀取 macOS 程序清單；為避免誤觸其他 Electron，停止建置。')
  }
  const processes = []
  for (const line of String(result.stdout || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^(\d+)\s+(.*)$/)
    if (!match) continue
    const [, pidStr, commandLine] = match
    processes.push({ ProcessId: Number(pidStr), ExecutablePath: undefined, CommandLine: commandLine })
  }
  return processes
}

export function findProjectAgentPetsProcesses(workspaceRoot = process.cwd()) {
  if (WINDOWS) {
    return listWindowsProcesses()
      .map(processInfo => ({
        ...processInfo,
        reason: isProjectAgentPetsProcess(processInfo, workspaceRoot),
      }))
      .filter(processInfo => processInfo.reason !== null)
  }
  if (MAC) {
    return listMacProcesses()
      .map(processInfo => ({
        ...processInfo,
        reason: isProjectAgentPetsProcess(processInfo, workspaceRoot),
      }))
      .filter(processInfo => processInfo.reason !== null)
  }
  return []
}

function stopProcess(processInfo) {
  const pid = Number(processInfo.ProcessId)
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`無效的程序 PID：${String(processInfo.ProcessId)}`)
  }

  if (WINDOWS) {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.status !== 0) {
      // /T may have already terminated this PID; treat that race as success only after tasklist confirms it is gone.
      const stillRunning = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      if (stillRunning.status === 0 && !String(stillRunning.stdout || '').includes(String(pid))) {
        return
      }
      const detail = String(result.stderr || result.stdout || '').trim()
      throw new Error(`無法關閉 PID ${pid}${detail ? `：${detail}` : ''}`)
    }
    return
  }

  // macOS: SIGKILL directly, since the build must not proceed while the app still holds the .app bundle open.
  const result = spawnSync('kill', ['-9', String(pid)], { encoding: 'utf8' })
  if (result.status !== 0) {
    const stillRunning = spawnSync('ps', ['-p', String(pid)], { encoding: 'utf8' })
    if (stillRunning.status !== 0) return
    const detail = String(result.stderr || result.stdout || '').trim()
    throw new Error(`無法關閉 PID ${pid}${detail ? `：${detail}` : ''}`)
  }
}

export function stopProjectAgentPets(workspaceRoot = process.cwd()) {
  if (!WINDOWS && !MAC) {
    console.log('非 Windows/macOS 環境：略過 Agent Pets 程序清理。')
    return
  }

  const targets = findProjectAgentPetsProcesses(workspaceRoot)
  if (targets.length === 0) {
    console.log('建置前檢查：找不到本專案正在執行的 Agent Pets。')
    return
  }

  for (const target of targets) {
    const pid = Number(target.ProcessId)
    console.log(`建置前檢查：關閉 PID ${pid}（${target.reason}）。`)
    stopProcess(target)
  }

  const remaining = findProjectAgentPetsProcesses(workspaceRoot)
  if (remaining.length > 0) {
    throw new Error(`仍有 ${remaining.length} 個本專案 Agent Pets 程序未關閉，停止建置以避免檔案鎖定。`)
  }
}

const entryPoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entryPoint) {
  try {
    stopProjectAgentPets(path.resolve(process.cwd()))
  } catch (error) {
    console.error(`建置前 Agent Pets 清理失敗：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
