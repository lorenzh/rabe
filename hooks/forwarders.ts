import type { RabeCodexCall } from '../types'
import { clip, type RabeItem, type RabeItemOf } from './model'
import { updateItem } from './registry'

const MAX_TEXT = 600

// The companion subcommands that start a job, and the `kindLabel` it gets.
const KINDS: Record<RabeCodexCall['command'], string> = {
  task: 'rescue',
  review: 'review',
  'adversarial-review': 'adversarial-review',
}

const CALL = /codex-companion\.mjs["']?\s+(task|review|adversarial-review)(?=\s|$)/

// A command line that runs the Codex plugin's companion script to start a job.
export function companionCall(
  command: string,
): Pick<RabeCodexCall, 'command' | 'text'> | undefined {
  const name = CALL.exec(command)?.[1] as RabeCodexCall['command'] | undefined

  return name && { command: name, text: clip(command, MAX_TEXT) }
}

// What the companion printed: a background launch names its job, a foreground
// run its thread (a progress line on stderr).
export function companionOutput(text: string): Pick<RabeCodexCall, 'jobId' | 'threadId'> {
  const jobId = /started in the background as ([\w-]+)\./.exec(text)?.[1]
  const threadId = /\[codex\] Thread ready \(([^)\s]+)\)/.exec(text)?.[1]

  return { ...(jobId && { jobId }), ...(threadId && { threadId }) }
}

// Quotes and backslashes differ between a shell word and the text it gives.
const flat = (text: string) =>
  text
    .replace(/["'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// The job's title is the companion's summary of its prompt, cut at 96 with `...`.
function isPrompted(call: RabeCodexCall, job: RabeItemOf<'codex'>): boolean {
  const summary = flat(job.title.replace(/\.\.\.$/, ''))

  return summary !== '' && flat(call.text).includes(summary)
}

// Whether `call` started `job`: the launch named it, or the job started while
// the call ran, is of the call's kind, and has its thread or its prompt.
function isProof(call: RabeCodexCall, job: RabeItemOf<'codex'>): boolean {
  if (call.jobId !== undefined) return call.jobId === job.detail.jobId
  if (KINDS[call.command] !== job.detail.jobKind) return false
  const start = job.startedAt
  if (start === undefined || start < call.at) return false
  if (call.endedAt !== undefined && start > call.endedAt) return false

  return call.threadId !== undefined ? call.threadId === job.detail.threadId : isPrompted(call, job)
}

type Call = { agent: string; call: RabeCodexCall }

// Sets `parentId` on each Codex job that exactly one agent's companion call
// started, where that call fits no other job; else the job keeps no parent.
export function linkForwarders(items: RabeItem[]): RabeItem[] {
  const calls: Call[] = items.flatMap(item =>
    item.kind === 'agent'
      ? (item.detail.codexCalls ?? []).map(call => ({ agent: item.id, call }))
      : [],
  )
  if (calls.length === 0) return items
  const jobs = items.filter((item): item is RabeItemOf<'codex'> => item.kind === 'codex')
  let out = items
  for (const job of jobs) {
    if (job.parentId !== undefined) continue
    const found = calls.filter(one => isProof(one.call, job))
    const [only] = found
    if (!only || found.length > 1) continue
    const fits = jobs.filter(
      one => (one.parentId === undefined || one.parentId === only.agent) && isProof(only.call, one),
    )
    if (fits.length === 1) out = updateItem(out, job.id, { parentId: only.agent })
  }

  return out
}
