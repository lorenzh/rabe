import type { RabeFileCursor, RabeLines } from '../types'
import { appendLines, MAX_LINES } from './tasks'

export type FileStamp = { size: number; mtimeMs: number; identity?: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type Rec = Record<string, unknown>

// The record itself, or an empty one for anything else.
export function rec(value: unknown): Rec {
  return isRecord(value) ? value : {}
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

// One JSON object; arrays, scalars and bad text give undefined.
export function parseJson(text: string): Rec | undefined {
  try {
    const value = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

// The JSON objects of a JSONL text; blank and bad lines are skipped.
export function jsonRecords(text: string): Rec[] {
  return text.split('\n').flatMap(line => {
    const one = parseJson(line)
    return one ? [one] : []
  })
}

export function restored<T>(value: Record<string, T> | undefined): Record<string, T> {
  return isRecord(value) ? value : {}
}

export function cursorOf(value: unknown): RabeFileCursor | undefined {
  if (!isRecord(value)) return
  if (
    !['size', 'mtimeMs', 'offset'].every(
      key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0,
    ) ||
    !Number.isSafeInteger(value.size) ||
    !Number.isSafeInteger(value.offset) ||
    typeof value.partial !== 'boolean' ||
    (value.identity !== undefined && typeof value.identity !== 'string') ||
    (value.isDiscarding !== undefined && typeof value.isDiscarding !== 'boolean')
  )
    return
  return value as RabeFileCursor
}

export function linesOf(value: unknown): RabeLines | undefined {
  if (
    !isRecord(value) ||
    typeof value.seen !== 'number' ||
    !Number.isFinite(value.seen) ||
    value.seen < 0 ||
    !Array.isArray(value.lines) ||
    !value.lines.every(
      line =>
        isRecord(line) &&
        typeof line.text === 'string' &&
        typeof line.at === 'number' &&
        Number.isFinite(line.at),
    ) ||
    (value.cursor !== undefined && !cursorOf(value.cursor)) ||
    (value.ended !== undefined && !['done', 'failed', 'stopped'].includes(String(value.ended))) ||
    ['exitCode', 'port'].some(
      key =>
        value[key] !== undefined &&
        (typeof value[key] !== 'number' || !Number.isFinite(value[key])),
    )
  )
    return
  return value as RabeLines
}

export function inodeOf(stdout: string): string | undefined {
  return /^\s*(\d+)/.exec(stdout)?.[1]
}

export function unchanged(stat: FileStamp, held?: Pick<FileStamp, 'size' | 'mtimeMs'>): boolean {
  return held !== undefined && stat.size === held.size && stat.mtimeMs === held.mtimeMs
}

export function readPlan(stat: FileStamp, held: RabeFileCursor | undefined, max: number) {
  const offset = fileOffset(stat, held)
  if (offset === undefined) return
  return { offset, reset: fileReset(stat, held), whole: offset === 0 && stat.size <= max }
}

export function outputUpdate(
  held: RabeLines | undefined,
  lines: string[],
  now: number,
  reset: boolean,
  partial: boolean,
  ended: boolean,
  cursor?: RabeFileCursor,
  result: Pick<RabeLines, 'ended' | 'exitCode' | 'port'> = {},
  whole = false,
): RabeLines | undefined {
  const output = whole
    ? { ...(appendLines(held, lines, now) ?? held ?? { seen: 0, lines: [] }), cursor }
    : cursor
      ? { ...outputLines(held, lines, now, reset, partial, ended), cursor }
      : (appendLines(held, lines, now) ?? held ?? { seen: 0, lines: [] })
  const { ended: status, exitCode, port } = result
  const before = reset ? undefined : held
  const next = {
    ...output,
    ...(status || before?.ended ? { ended: status ?? before?.ended } : {}),
    ...(exitCode !== undefined || before?.exitCode !== undefined
      ? { exitCode: exitCode ?? before?.exitCode }
      : {}),
    ...(port || before?.port ? { port: port ?? before?.port } : {}),
  }
  return JSON.stringify(next) === JSON.stringify(held) ? undefined : next
}

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

// The cursor after one read: the file stamp, the byte offset past the chunk
// and whether the chunk was partial or skipped.
export function nextCursor(
  stamp: FileStamp,
  offset: number,
  chunk: { bytes: number; partial: boolean; isDiscarding?: boolean },
) {
  return {
    ...stamp,
    offset: offset + chunk.bytes,
    partial: chunk.partial,
    isDiscarding: chunk.isDiscarding,
  }
}

// True when `stat` is the regular file `name` directly inside `root`, after
// symlinks resolve: the one check that keeps a link from leaving a task folder.
export function isOwnFile(
  root: { realPath?: string },
  stat: { realPath?: string; kind?: string },
  name: string,
): boolean {
  return !!root.realPath && stat.realPath === `${root.realPath}/${name}` && stat.kind === 'file'
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
