import type { EngineInterface, On } from 'claude-code'

import type { RabeItem } from '../model'
import { evict, keepItems } from '../registry'

async function remember(
  $: Pick<EngineInterface, 'state'>,
  before: RabeItem[],
  after: RabeItem[],
): Promise<void> {
  for (;;) {
    const { value = [], version } = await $.state.get({ plugin: 'rabe', key: 'evicted' })
    const next = evict(value, before, after)
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

// Every write of `rabe.items` passes here, whichever file made it.
export function cleanup(on: On): void {
  on('state.set', { plugin: 'rabe', key: 'items' }, async ($, e, next) => {
    const before =
      e.previous ??
      (await $.state.get({ plugin: 'rabe', key: 'items' }).catch(() => undefined))?.value
    const answer = await next(e)
    try {
      if (answer.value?.isSet && e.plugin === 'rabe' && e.key === 'items') {
        await remember($, before ?? [], e.value)
        await pruneLines($, e.value)
        await pruneTurns($, e.value)
      }
    } catch {}

    return answer
  })
}
