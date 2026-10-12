import type { RabeDiag } from '../types'
import type { RabeItem } from './model'
import { byteLength } from './reading'
import { type Change, capEnded } from './registry'

// Read results and unchanged files in one poll; lastError has its paths shortened.
export type Probe = {
  files: number
  chars: number
  bytes: number
  skipped: number
  errors: number
  lastError?: string
}

export type Poller = {
  // `name` keys the poll's record in `rabe.diag`; a poll without one keeps none.
  name?: string
  run: (items: RabeItem[]) => Promise<Change | undefined>
  every?: number
  initial?: boolean
  due?: number
}
export type Pollers = Poller[]

export function delayOf(idle: number, isRunning: boolean, isChanged: boolean) {
  const quiet = isRunning || isChanged ? 0 : idle + 1
  return { idle: quiet, delay: quiet < 5 ? 2000 : 10000 }
}

export function nextStep(now: number, due: number, isRunning: boolean) {
  if (now >= due || (isRunning && due - now > 2000)) return 'poll'
  return isRunning ? 'redraw' : 'skip'
}

export function pollDue(
  poll: Pick<Poller, 'every' | 'due' | 'initial'>,
  now: number,
  initial = false,
) {
  return (!initial || poll.initial !== false) && now >= (poll.due ?? 0)
}

// An error's text without private parts: every absolute path (`/x`, `~/x`,
// `C:\x`) becomes its file name when it has an extension and `…` otherwise,
// and the text is cut. Free text around a path stays: it is cut, not read.
export function shorten(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return text
    .replace(/(?<![\w.~])(?:[A-Za-z]:[\\/]|~[\\/]|[\\/])[^\s'"]*/g, path => {
      const name = path.split(/[\\/]/).pop() ?? ''
      return /[^.\\/]\.[A-Za-z0-9]{1,8}$/.test(name) ? name : '…'
    })
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

function fail(probe: Probe, error: unknown): void {
  probe.errors++
  probe.lastError = shorten(error)
}

// The poll in flight: polls run one after another, so a source that reads a
// file or runs a process reports it here without a probe argument. An event
// hook that reads while a poll runs counts into that poll.
let current: Probe | undefined

// Counts a read result; returns it.
export function tally<T>(text: T): T {
  if (current) {
    current.files++
    current.chars += typeof text === 'string' ? text.length : 0
    current.bytes += typeof text === 'string' ? byteLength(text) : 0
  }

  return text
}

// Counts a file whose content read was skipped because it is unchanged.
export function skipped(): void {
  if (current) current.skipped++
}

// Counts a failure; returns `fallback`, so `.catch(fault)` and `.catch(e => fault(e, ''))` stand
// where a read's `.catch(() => undefined)` stood.
export function fault<F = undefined>(error: unknown, fallback?: F): F {
  if (current) fail(current, error)

  return fallback as F
}

const ROUND = 100

// The diag record after a pass: `ms` is rounded and `at` ignored when deciding
// whether anything changed, so a steady source causes no write.
export function mergeDiag(
  held: Record<string, RabeDiag>,
  stats: Record<string, RabeDiag>,
): Record<string, RabeDiag> {
  let next = held
  for (const [name, stat] of Object.entries(stats)) {
    const ms = Math.round(stat.ms / ROUND) * ROUND
    const old = held[name]
    const same =
      old &&
      old.ms === ms &&
      old.files === stat.files &&
      old.chars === stat.chars &&
      old.bytes === stat.bytes &&
      old.skipped === stat.skipped &&
      old.errors === stat.errors &&
      old.lastError === stat.lastError
    if (!same) next = { ...next, [name]: { ...stat, ms } }
  }

  return next
}

export async function collect(
  pollers: Pollers,
  items: RabeItem[],
  now: number,
  initial = false,
  tick: () => Promise<number> = async () => now,
): Promise<{ change: Change; items: RabeItem[]; stats: Record<string, RabeDiag> }> {
  const changes: Change[] = []
  const stats: Record<string, RabeDiag> = {}
  for (const poll of pollers) {
    if (!pollDue(poll, now, initial)) continue
    const probe: Probe = { files: 0, chars: 0, bytes: 0, skipped: 0, errors: 0 }
    const started = await tick().catch(() => now)
    current = probe
    try {
      const change = await poll.run(items)
      if (change) {
        changes.push(change)
        items = capEnded(change(items))
      }
    } catch (error) {
      fail(probe, error)
    }
    current = undefined
    if (poll.name) {
      const ended = await tick().catch(() => started)
      stats[poll.name] = {
        at: now,
        ms: Math.max(0, ended - started),
        files: probe.files,
        chars: probe.chars,
        bytes: probe.bytes,
        skipped: probe.skipped,
        errors: probe.errors,
        ...(probe.lastError && { lastError: probe.lastError }),
      }
    }
    poll.due = now + (poll.every ?? 0)
  }
  return {
    change: held => changes.reduce((list, change) => capEnded(change(list)), held),
    items,
    stats,
  }
}
