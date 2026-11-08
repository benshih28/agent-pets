import { inflateSync } from 'fflate'

// Single ZIP reader for untrusted sprite kits. inspectZipArchive() reads only
// the end-of-central-directory record, the central directory and each local
// header (O(entries), no inflation); extractZipEntry() then inflates exactly
// the bytes that inspection described. Using one parser for both steps is the
// point: a second parser (e.g. fflate's unzipSync) can pick a different EOCD
// or follow a ZIP64 locator and extract files the pre-scan never saw.
// Rejected before anything is inflated:
//   - more than one EOCD signature, a ZIP64 locator, a central directory that
//     does not end exactly at the EOCD, or trailing bytes after the comment
//   - multi-disk / ZIP64 / encrypted / unknown-method archives
//   - local headers that disagree with their central record
//   - symlink and reparse-point entries
//   - names that are not valid UTF-8 or contain control characters
//   - absolute, drive-letter, backslash or ".." names (zip-slip), even though
//     callers never use entry names as output paths
//   - duplicate names (case-insensitive, NFC) that different parsers resolve differently
//   - overlapping or out-of-bounds entries (the "overlapping files" zip bomb)
//   - per-entry and whole-archive compression ratios typical of zip bombs

export interface ZipInspectLimits {
  /** Maximum central-directory records, directories and metadata included. */
  maxEntries: number
  /** Maximum declared uncompressed bytes across every entry. */
  maxTotalUncompressedBytes: number
  /** Maximum uncompressed/compressed ratio for an entry above `ratioCheckMinBytes`. */
  maxCompressionRatio: number
  ratioCheckMinBytes: number
}

export type ZipInspectError =
  | 'invalid_archive'
  | 'unsupported_archive'
  | 'encrypted_entry'
  | 'symlink_entry'
  | 'invalid_name'
  | 'unsafe_path'
  | 'duplicate_path'
  | 'file_limit_exceeded'
  | 'total_size_exceeded'
  | 'compression_ratio_exceeded'
  | 'overlapping_entries'
  | 'checksum_mismatch'

export interface ZipEntryInfo {
  /** The name decoded as UTF-8 (validated). */
  name: string
  compressedSize: number
  uncompressedSize: number
  directory: boolean
  method: number
  crc32: number
  /** Offset of the entry's data in the archive, from its validated local header. */
  dataOffset: number
}

export type ZipInspectResult =
  | { ok: true; entries: ZipEntryInfo[]; totalUncompressedBytes: number }
  | { ok: false; error: ZipInspectError }

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_LOCATOR_SIZE = 20
const FLAG_DATA_DESCRIPTOR = 0x8
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_MIN_SIZE = 22
const MAX_COMMENT_SIZE = 0xffff
const CENTRAL_HEADER_SIZE = 46
const LOCAL_HEADER_SIZE = 30
const UNIX_HOST = 3
const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const DOS_REPARSE_POINT = 0x400
const FLAG_ENCRYPTED = 0x1
const FLAG_STRONG_ENCRYPTION = 0x40
const SUPPORTED_METHODS = new Set([0, 8])
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  // Take the LAST signature (what fflate and most readers use) and require its
  // comment to end exactly at EOF. A fake EOCD hidden inside the comment of a
  // real one is therefore the one we see, and its length check fails.
  const lowest = Math.max(0, bytes.length - EOCD_MIN_SIZE - MAX_COMMENT_SIZE)
  for (let offset = bytes.length - EOCD_MIN_SIZE; offset >= lowest; offset -= 1) {
    if (u32(bytes, offset) === EOCD_SIGNATURE) {
      return offset + EOCD_MIN_SIZE + u16(bytes, offset + 20) === bytes.length ? offset : -1
    }
  }
  return -1
}

function containsSignature(bytes: Uint8Array, start: number, end: number, signature: number): boolean {
  for (let offset = start; offset + 4 <= end; offset += 1) {
    if (u32(bytes, offset) === signature) return true
  }
  return false
}

const utf8 = new TextDecoder('utf-8', { fatal: true })

function decodeName(bytes: Uint8Array): string | null {
  // Archivers such as macOS Archive Utility write UTF-8 without setting the
  // language-encoding flag, so the flag is not required; the bytes must still
  // be valid UTF-8. Legacy code pages (CP437, Big5, Shift-JIS) are rejected
  // because their meaning depends on the reader's locale.
  try {
    const name = utf8.decode(bytes)
    return name.length > 0 && !CONTROL_CHARACTERS.test(name) ? name : null
  } catch {
    return null
  }
}

function isUnsafePath(name: string): boolean {
  if (name.startsWith('/') || name.includes('\\') || /^[a-zA-Z]:/.test(name)) return true
  return name.split('/').some(segment => segment === '..')
}

function validLimits(limits: ZipInspectLimits): boolean {
  return [limits.maxEntries, limits.maxTotalUncompressedBytes, limits.maxCompressionRatio, limits.ratioCheckMinBytes]
    .every(value => Number.isSafeInteger(value) && value > 0)
}

export function inspectZipArchive(bytes: Uint8Array, limits: ZipInspectLimits): ZipInspectResult {
  if (!(bytes instanceof Uint8Array) || !validLimits(limits)) return { ok: false, error: 'invalid_archive' }
  if (bytes.length < EOCD_MIN_SIZE) return { ok: false, error: 'invalid_archive' }
  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd < 0) return { ok: false, error: 'invalid_archive' }

  const diskNumber = u16(bytes, eocd + 4)
  const centralDisk = u16(bytes, eocd + 6)
  const entriesOnDisk = u16(bytes, eocd + 8)
  const entryCount = u16(bytes, eocd + 10)
  const centralSize = u32(bytes, eocd + 12)
  const centralOffset = u32(bytes, eocd + 16)
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return { ok: false, error: 'unsupported_archive' }
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) return { ok: false, error: 'unsupported_archive' }
  if (entryCount > limits.maxEntries) return { ok: false, error: 'file_limit_exceeded' }
  if (eocd >= ZIP64_LOCATOR_SIZE && u32(bytes, eocd - ZIP64_LOCATOR_SIZE) === ZIP64_LOCATOR_SIGNATURE) {
    return { ok: false, error: 'unsupported_archive' }
  }
  if (centralOffset + centralSize !== eocd) return { ok: false, error: 'invalid_archive' }
  if (containsSignature(bytes, eocd + 4, bytes.length, EOCD_SIGNATURE)) return { ok: false, error: 'invalid_archive' }

  const entries: ZipEntryInfo[] = []
  const seen = new Set<string>()
  const ranges: Array<[number, number]> = []
  let totalUncompressed = 0
  let totalCompressed = 0
  let cursor = centralOffset
  const centralEnd = centralOffset + centralSize

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + CENTRAL_HEADER_SIZE > centralEnd || u32(bytes, cursor) !== CENTRAL_SIGNATURE) {
      return { ok: false, error: 'invalid_archive' }
    }
    const host = bytes[cursor + 5]
    const flags = u16(bytes, cursor + 8)
    const method = u16(bytes, cursor + 10)
    const compressedSize = u32(bytes, cursor + 20)
    const uncompressedSize = u32(bytes, cursor + 24)
    const nameLength = u16(bytes, cursor + 28)
    const extraLength = u16(bytes, cursor + 30)
    const commentLength = u16(bytes, cursor + 32)
    const entryDisk = u16(bytes, cursor + 34)
    const externalAttributes = u32(bytes, cursor + 38)
    const localOffset = u32(bytes, cursor + 42)
    const recordEnd = cursor + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
    if (recordEnd > centralEnd) return { ok: false, error: 'invalid_archive' }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || entryDisk !== 0) {
      return { ok: false, error: 'unsupported_archive' }
    }
    if ((flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) return { ok: false, error: 'encrypted_entry' }
    if (!SUPPORTED_METHODS.has(method)) return { ok: false, error: 'unsupported_archive' }

    const fileType = (externalAttributes >>> 16) & S_IFMT
    if ((host === UNIX_HOST && fileType === S_IFLNK) || (host !== UNIX_HOST && (externalAttributes & DOS_REPARSE_POINT) !== 0)) {
      return { ok: false, error: 'symlink_entry' }
    }

    const name = decodeName(bytes.subarray(cursor + CENTRAL_HEADER_SIZE, cursor + CENTRAL_HEADER_SIZE + nameLength))
    if (!name) return { ok: false, error: 'invalid_name' }
    if (isUnsafePath(name)) return { ok: false, error: 'unsafe_path' }
    const key = name.normalize('NFC').toLowerCase()
    if (seen.has(key)) return { ok: false, error: 'duplicate_path' }
    seen.add(key)

    if (method === 0 && compressedSize !== uncompressedSize) return { ok: false, error: 'invalid_archive' }
    if (uncompressedSize > 0 && compressedSize === 0) return { ok: false, error: 'compression_ratio_exceeded' }
    if (uncompressedSize >= limits.ratioCheckMinBytes && uncompressedSize / compressedSize > limits.maxCompressionRatio) {
      return { ok: false, error: 'compression_ratio_exceeded' }
    }
    totalUncompressed += uncompressedSize
    totalCompressed += compressedSize
    if (totalUncompressed > limits.maxTotalUncompressedBytes) return { ok: false, error: 'total_size_exceeded' }

    // The local header carries its own name/extra lengths; the data range it
    // describes must stay inside the archive, before the central directory,
    // and must not be shared with another entry.
    if (localOffset + LOCAL_HEADER_SIZE > centralOffset || u32(bytes, localOffset) !== LOCAL_SIGNATURE) {
      return { ok: false, error: 'invalid_archive' }
    }
    // The local header must describe the same entry as the central record:
    // flags, method, name bytes and (unless a data descriptor follows) sizes and CRC.
    const crc32 = u32(bytes, cursor + 16)
    const localFlags = u16(bytes, localOffset + 6)
    const localNameLength = u16(bytes, localOffset + 26)
    const dataStart = localOffset + LOCAL_HEADER_SIZE + localNameLength + u16(bytes, localOffset + 28)
    const dataEnd = dataStart + compressedSize
    if (dataEnd > centralOffset) return { ok: false, error: 'invalid_archive' }
    if (localFlags !== flags || u16(bytes, localOffset + 8) !== method || localNameLength !== nameLength) {
      return { ok: false, error: 'invalid_archive' }
    }
    for (let offset = 0; offset < nameLength; offset += 1) {
      if (bytes[localOffset + LOCAL_HEADER_SIZE + offset] !== bytes[cursor + CENTRAL_HEADER_SIZE + offset]) {
        return { ok: false, error: 'invalid_archive' }
      }
    }
    if ((flags & FLAG_DATA_DESCRIPTOR) === 0 && (u32(bytes, localOffset + 14) !== crc32
      || u32(bytes, localOffset + 18) !== compressedSize || u32(bytes, localOffset + 22) !== uncompressedSize)) {
      return { ok: false, error: 'invalid_archive' }
    }
    ranges.push([localOffset, dataEnd])

    entries.push({
      name, compressedSize, uncompressedSize, directory: name.endsWith('/'), method, crc32, dataOffset: dataStart,
    })
    cursor = recordEnd
  }

  ranges.sort((left, right) => left[0] - right[0])
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index][0] < ranges[index - 1][1]) return { ok: false, error: 'overlapping_entries' }
  }
  if (totalUncompressed >= limits.ratioCheckMinBytes && totalCompressed > 0
    && totalUncompressed / totalCompressed > limits.maxCompressionRatio) {
    return { ok: false, error: 'compression_ratio_exceeded' }
  }
  return { ok: true, entries, totalUncompressedBytes: totalUncompressed }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export type ZipExtractResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; error: 'invalid_archive' | 'checksum_mismatch' }

/**
 * Inflates one entry returned by inspectZipArchive() from the same archive
 * bytes. The output buffer is preallocated from the declared size (+1 byte so
 * an over-long stream is detected rather than silently truncated), then the
 * exact length and CRC-32 are verified.
 */
export function extractZipEntry(archive: Uint8Array, entry: ZipEntryInfo): ZipExtractResult {
  if (entry.directory || entry.dataOffset + entry.compressedSize > archive.length) return { ok: false, error: 'invalid_archive' }
  const compressed = archive.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
  let data: Uint8Array
  if (entry.method === 0) {
    data = compressed.slice()
  } else if (entry.method === 8) {
    try {
      data = inflateSync(compressed, { out: new Uint8Array(entry.uncompressedSize + 1) })
    } catch {
      return { ok: false, error: 'invalid_archive' }
    }
  } else {
    return { ok: false, error: 'invalid_archive' }
  }
  if (data.length !== entry.uncompressedSize) return { ok: false, error: 'invalid_archive' }
  if (crc32(data) !== entry.crc32) return { ok: false, error: 'checksum_mismatch' }
  return { ok: true, data }
}
