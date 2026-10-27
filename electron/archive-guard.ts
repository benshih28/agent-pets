import { unzipSync } from 'fflate'

export interface ArchiveGuardOptions {
  maxTotalBytes: number
  maxFileBytes: number
  maxFiles: number
  allowedExtensions: readonly string[]
  /** Strict rejects unsafe entries; compat skips them while retaining archive limits. */
  mode?: 'strict' | 'compat'
  /** Optional trusted caller filter. Rejected paths still count toward archive limits. */
  includePath?: (relativePath: string) => boolean
}

export type ArchiveGuardError =
  | 'invalid_limits'
  | 'invalid_archive'
  | 'unsafe_path'
  | 'duplicate_path'
  | 'file_limit_exceeded'
  | 'file_size_exceeded'
  | 'total_size_exceeded'
  | 'unsupported_extension'

export type ArchiveGuardResult =
  | { ok: true; files: Map<string, Uint8Array> }
  | { ok: false; error: ArchiveGuardError }

const MAX_ARCHIVE_PATH_LENGTH = 512
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const WINDOWS_FORBIDDEN = /[\u0000-\u001f\u007f<>:"|?*]/

interface SafeArchivePath {
  path: string
  directory: boolean
}

function safeArchivePath(rawPath: unknown): SafeArchivePath | null {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > MAX_ARCHIVE_PATH_LENGTH) return null
  const normalized = rawPath.normalize('NFC')
  const directory = normalized.endsWith('/')
  const path = directory ? normalized.slice(0, -1) : normalized
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path)
    || path.includes('\\') || WINDOWS_FORBIDDEN.test(path)) return null

  const segments = path.split('/')
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..'
    || /[. ]$/.test(segment) || WINDOWS_DEVICE_NAME.test(segment))) return null
  return { path, directory }
}

function extensionOf(path: string): string {
  const filename = path.slice(path.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot).toLowerCase() : ''
}

function validLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Validates ZIP metadata before fflate inflates entries, then verifies extracted bytes. */
export function guardArchive(zipBytes: Uint8Array, options: ArchiveGuardOptions): ArchiveGuardResult {
  if (!(zipBytes instanceof Uint8Array)
    || !options
    || !validLimit(options.maxTotalBytes)
    || !validLimit(options.maxFileBytes)
    || !validLimit(options.maxFiles)
    || !Array.isArray(options.allowedExtensions)
    || options.allowedExtensions.length === 0
    || (options.mode !== undefined && options.mode !== 'strict' && options.mode !== 'compat')
    || options.allowedExtensions.some(extension => typeof extension !== 'string' || !/^\.[a-z0-9]{1,10}$/i.test(extension))) {
    return { ok: false, error: 'invalid_limits' }
  }

  const allowedExtensions = new Set(options.allowedExtensions.map(extension => extension.toLowerCase()))
  if (allowedExtensions.size !== options.allowedExtensions.length) return { ok: false, error: 'invalid_limits' }

  const compatibilityMode = options.mode === 'compat'
  const seenPaths = new Set<string>()
  const declaredSizes = new Map<string, number>()
  let fileCount = 0
  let declaredTotalBytes = 0
  let rejected: ArchiveGuardError | null = null
  let extracted: Record<string, Uint8Array>

  try {
    extracted = unzipSync(zipBytes, {
      filter: (entry) => {
        const safe = safeArchivePath(entry.name)
        const isDirectory = safe?.directory === true
          || (typeof entry.name === 'string' && entry.name.endsWith('/'))
        if (isDirectory) return false

        const comparisonPath = safe?.path.toLowerCase()
        if (!compatibilityMode && !safe) {
          rejected = 'unsafe_path'
          throw new Error('Archive guard rejected an unsafe path')
        }
        if (!compatibilityMode && comparisonPath && seenPaths.has(comparisonPath)) {
          rejected = 'duplicate_path'
          throw new Error('Archive guard rejected a duplicate path')
        }

        fileCount += 1
        if (fileCount > options.maxFiles) {
          rejected = 'file_limit_exceeded'
          throw new Error('Archive guard file limit exceeded')
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 0
          || !Number.isSafeInteger(entry.originalSize) || entry.originalSize < 0) {
          rejected = 'invalid_archive'
          throw new Error('Archive guard rejected an invalid size')
        }
        if (entry.originalSize > options.maxFileBytes) {
          rejected = 'file_size_exceeded'
          throw new Error('Archive guard file size exceeded')
        }
        declaredTotalBytes += entry.originalSize
        if (!Number.isSafeInteger(declaredTotalBytes) || declaredTotalBytes > options.maxTotalBytes) {
          rejected = 'total_size_exceeded'
          throw new Error('Archive guard total size exceeded')
        }

        if (!safe || !comparisonPath) return false
        if (compatibilityMode && seenPaths.has(comparisonPath)) return false
        seenPaths.add(comparisonPath)

        const extension = extensionOf(safe.path)
        if (!allowedExtensions.has(extension)) {
          if (!compatibilityMode) {
            rejected = 'unsupported_extension'
            throw new Error('Archive guard rejected an unsupported extension')
          }
          return false
        }
        declaredSizes.set(comparisonPath, entry.originalSize)
        return options.includePath ? options.includePath(safe.path) : true
      },
    })
  } catch {
    return { ok: false, error: rejected ?? 'invalid_archive' }
  }

  const files = new Map<string, Uint8Array>()
  let actualTotalBytes = 0
  for (const [rawPath, bytes] of Object.entries(extracted)) {
    const safe = safeArchivePath(rawPath)
    if (!safe || safe.directory) return { ok: false, error: 'unsafe_path' }
    const comparisonPath = safe.path.toLowerCase()
    const declaredSize = declaredSizes.get(comparisonPath)
    if (declaredSize === undefined || bytes.byteLength !== declaredSize) {
      return { ok: false, error: 'invalid_archive' }
    }
    if (bytes.byteLength > options.maxFileBytes) return { ok: false, error: 'file_size_exceeded' }
    actualTotalBytes += bytes.byteLength
    if (!Number.isSafeInteger(actualTotalBytes) || actualTotalBytes > options.maxTotalBytes) {
      return { ok: false, error: 'total_size_exceeded' }
    }
    files.set(safe.path, bytes)
  }
  return { ok: true, files }
}
