import type { EngineInterface, Register } from 'claude-code'

import { collect, delayOf, nextStep, type Pollers } from './loop'
import type { RabeItem } from './model'
import { type Change, commit, prune } from './registry'
import { sources } from './sources'
import { band } from './ui/band'
import { builtin } from './ui/builtin'
import { pane } from './ui/pane'
import { hoursOf } from './ui/views/timeline'

export const register: Register = (on, options) => {
  const file = String(options.pricesFile ?? '')
  const pollers: Pollers = []
  let cancel = () => {}
  let generation = 0
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    cancel()
    const session = ++generation
    pollers.length = 0
    const started = await next(e)
    let running = true
    let due = 0
    let idle = 0
    const timer = $.clock.every(1000, () => {
      if (running || session !== generation) return
      running = true
      void (async () => {
        try {
          const now = await $.clock.now()
          const { value: items = [], version } = await $.state.get({ plugin: 'rabe', key: 'items' })
          const step = nextStep(
            now,
            due,
            items.some(item => item.status === 'running'),
          )
          if (step === 'skip') return
          if (step === 'redraw') {
            $.ui.invalidate('ui.render')
            return
          }
          const collected = await collect([...pollers], items, now)
          if (session !== generation) return
          const changed = await write($, collected.change, {
            version,
            before: items,
            items: collected.items,
          })
          const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
          const active = current.some(item => item.status === 'running')
          const pace = delayOf(idle, active, changed)
          idle = pace.idle
          due = now + pace.delay
          if (active || changed) $.ui.invalidate('ui.render')
        } catch {
          try {
            due = (await $.clock.now()) + 2000
          } catch {}
        } finally {
          running = false
        }
      })()
    })
    cancel = () => timer.cancel()
    try {
      const now = await $.clock.now()
      const { value: items = [], version } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const collected = await collect([...pollers], items, now, true)
      if (session === generation)
        await write($, collected.change, { version, before: items, items: collected.items })
    } catch {
    } finally {
      running = false
    }
    due = (await $.clock.now()) + 2000
    return started
  })
  sources(on, file, pollers)
  band(on)
  pane(on, hoursOf(options.timelineHours))
  if (options.hideBuiltinTasks !== false) builtin(on)
}

async function write(
  $: Pick<EngineInterface, 'state'>,
  change: Change,
  snapshot: { version: number; before: RabeItem[]; items: RabeItem[] },
): Promise<boolean> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next =
      version === snapshot.version
        ? commit(snapshot.before, () => snapshot.items)
        : commit(value, change)
    if (next === undefined) return false
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next.items, {
      ifVersion: version,
    })
    if (isSet) {
      await forget($, next.dropped)
      return true
    }
  }
}

// Drops the lines and turns of the items a write dropped.
async function forget($: Pick<EngineInterface, 'state'>, dropped: string[]): Promise<void> {
  if (dropped.length === 0) return
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) break
    const lines = await $.state.set({ plugin: 'rabe', key: 'lines' }, next, { ifVersion: version })
    if (lines.isSet) break
  }
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'turns' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) return
    const turns = await $.state.set({ plugin: 'rabe', key: 'turns' }, next, { ifVersion: version })
    if (turns.isSet) return
  }
}
