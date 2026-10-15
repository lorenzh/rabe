import type { EngineInterface, Register } from 'claude-code'
import type { RabeDiag } from '../types'
import { diag } from './diag'
import { collect, delayOf, mergeDiag, nextStep, type Pollers } from './loop'
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
          const collected = await collect([...pollers], items, now, false, () => $.clock.now())
          if (session !== generation) return
          await saveDiag($, collected.stats)
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
      const collected = await collect([...pollers], items, now, true, () => $.clock.now())
      if (session === generation) await saveDiag($, collected.stats)
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
  diag(on, options)
  if (options.hideBuiltinTasks !== false) builtin(on)
}

// Writes the polls' records only when one changed. A version conflict retries
// a few times; a refusal or an error leaves the records as they are, and the
// items are written anyway.
async function saveDiag(
  $: Pick<EngineInterface, 'state'>,
  stats: Record<string, RabeDiag>,
): Promise<void> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'diag' })
      const next = mergeDiag(value, stats)
      if (next === value) return
      const { isSet } = await $.state.set({ plugin: 'rabe', key: 'diag' }, next, {
        ifVersion: version,
      })
      if (isSet) return
    }
  } catch {}
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
    if (next === value) break
    const turns = await $.state.set({ plugin: 'rabe', key: 'turns' }, next, { ifVersion: version })
    if (turns.isSet) break
  }
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'diffs' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) return
    const diffs = await $.state.set({ plugin: 'rabe', key: 'diffs' }, next, { ifVersion: version })
    if (diffs.isSet) return
  }
}
