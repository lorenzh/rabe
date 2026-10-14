import type { RabeItem, RabePrevious } from '../../types'
import { isEnded } from '../model'

export function toastText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '?')
}

// Tabs and line breaks stay; an escape could end a bracketed paste.
export function clipText(text: string): string {
  return text.replace(/(?![\t\n\r])[\p{Cc}\p{Cf}]/gu, '?')
}

// Titles and agent names can contain prompts or file text.
export function nameOf(item: RabeItem): string {
  return item.id.slice(item.kind.length + 1)
}

// The store is the plugin's own JSON; an older Rabe may have written another
// shape, and a summary before 0.4 has no session id.
export function asPrevious(value: unknown): RabePrevious | undefined {
  const prev = value as (RabePrevious & { failed?: unknown }) | undefined
  if (
    typeof prev?.endedAt !== 'number' ||
    (!Array.isArray(prev.failedIds) && !Array.isArray(prev.failed)) ||
    !prev.counts
  ) {
    return undefined
  }

  return {
    ...(typeof prev.sessionId === 'string' && prev.sessionId && { sessionId: prev.sessionId }),
    endedAt: prev.endedAt,
    startedAt: prev.startedAt,
    counts: prev.counts,
    tokens: prev.tokens,
    usd: prev.usd,
    failedIds: Array.isArray(prev.failedIds) ? prev.failedIds : [],
  }
}

// The answer of `/rabe` where the pane cannot draw: counts, then one line per
// item with its kind, status word and title.
export function itemsText(items: RabeItem[]): string {
  if (items.length === 0) return 'Rabe: no background work.'
  const live = items.filter(one => !isEnded(one)).length
  const rows = items.map(one => `- ${one.kind} ${one.status}: ${toastText(one.title)}`)

  return [`Rabe: ${live} running, ${items.length - live} ended.`, ...rows].join('\n')
}
