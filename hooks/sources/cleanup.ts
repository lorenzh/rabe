import type { EngineInterface, On } from 'claude-code'

import type { RabeItem } from '../model'
import { capEnded, evict, keepItems } from '../registry'

async function remember(
  $: Pick<EngineInterface, 'state'>,
  seen: RabeItem[],
  kept: RabeItem[],
): Promise<void> {
  for (;;) {
    const { value = [], version } = await $.state.get({ plugin: 'rabe', key: 'evicted' })
    const next = evict(value, seen, kept)
    if (next === value) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'evicted' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
}

async function pruneLines($: Pick<EngineInterface, 'state'>, items: RabeItem[]): Promise<void> {
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const next = keepItems(value, items)
    if (next === value) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'lines' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
}

async function pruneTurns($: Pick<EngineInterface, 'state'>, items: RabeItem[]): Promise<void> {
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'turns' })
    const next = keepItems(value, items)
    if (next === value) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'turns' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
}

// Every write of `rabe.items` passes here, whichever file made it. The cap is
// applied here, so what it drops is known, also an item the same write added.
export function cleanup(on: On): void {
  on('state.set', { plugin: 'rabe', key: 'items' }, async ($, e, next) => {
    if (e.plugin !== 'rabe' || e.key !== 'items') return next(e)
    const kept = capEnded(e.value)
    const before =
      e.previous ??
      (await $.state.get({ plugin: 'rabe', key: 'items' }).catch(() => undefined))?.value ??
      []
    const answer = await next(kept === e.value ? e : { ...e, value: kept })
    try {
      if (answer.value?.isSet) {
        await remember($, [...before, ...e.value], kept)
        await pruneLines($, kept)
        await pruneTurns($, kept)
      }
    } catch {}

    return answer
  })
}
