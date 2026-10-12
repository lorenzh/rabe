import type { RabeItem, RabePrevious } from '../../types'

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
