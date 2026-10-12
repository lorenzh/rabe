import type { RabeFileCursor, RabeLines } from '../types'
import { MAX_LINES } from './tasks'

export type FileStamp = { size: number; mtimeMs: number; identity?: string }

export function fileOffset(stat: FileStamp, held?: RabeFileCursor): number | undefined {
  if (fileReset(stat, held)) return 0
  if (!held) return 0
  if (held.offset < held.size && !held.partial) return held.offset
  if (stat.size === held.size && stat.mtimeMs === held.mtimeMs) return undefined
  return held.offset
}

export function fileReset(stat: FileStamp, held?: RabeFileCursor): boolean {
  return (
    !held ||
    stat.size < Math.max(held.size, held.offset) ||
    stat.identity !== held.identity ||
    (stat.size === held.size && stat.mtimeMs !== held.mtimeMs)
  )
}

export function byteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

export function readChunk(text: string, truncated: boolean, json: boolean, discarding = false) {
  const start = discarding ? text.indexOf('\n') + 1 : 0
  const endLine = text.lastIndexOf('\n') + 1
  if ((discarding && start === 0) || (truncated && endLine === 0)) {
    return { text: '', bytes: byteLength(text), partial: false, isDiscarding: true }
  }
  let end = endLine
  if (json && !truncated) {
    try {
      JSON.parse(text.slice(end))
      end = text.length
    } catch {}
  }
  return {
    text: json || truncated ? text.slice(start, end) : text.slice(start),
    bytes: byteLength(text.slice(0, end)),
    partial: !truncated && end < text.length,
  }
}

export function outputLines(
  held: RabeLines | undefined,
  lines: string[],
  now: number,
  reset: boolean,
  partial: boolean,
  ended = false,
): RabeLines {
  const before = reset ? undefined : held
  const last = partial ? before?.lines.at(-1) : undefined
  const kept = last ? (before?.lines.slice(0, -1) ?? []) : (before?.lines ?? [])
  const fresh = lines.map((text, n) => ({ at: n === 0 && last ? last.at : now, text }))
  const combined = [...kept, ...fresh]
  const separator = ended && combined.at(-1)?.text === ''
  if (separator) combined.pop()
  return {
    seen: (before?.seen ?? 0) - (last ? 1 : 0) + lines.length - (separator ? 1 : 0),
    lines: combined.slice(-MAX_LINES),
  }
}
