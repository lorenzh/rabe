import type { EngineInterface, Register } from 'claude-code'

import { commit, type Poll, type Pollers, prune } from './registry'
import { sources } from './sources'
import { band } from './ui/band'
import { builtin } from './ui/builtin'
import { pane } from './ui/pane'
import { hoursOf } from './ui/views/timeline'

export const register: Register = (on, options) => {
  const file = String(options.pricesFile ?? '')
  const pollers: Pollers = []
  sources(on, file, pollers)
  on('session.start', { cwd: /^/ }, async ($, e, next) => {
    const started = await next(e)
    let running = false
    let due = 0
    let idle = 0
    let trees = 0
    $.clock.every(1000, () => {
      if (running) return
      running = true
      void (async () => {
        try {
          const now = await $.clock.now()
          if (now < due && now < trees) {
            const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
            if (items.some(item => item.status === 'running')) {
              $.ui.invalidate('ui.render')
              if (due - now <= 2000) return
            } else return
          }
          const changed = await tick($, pollers, now >= trees)
          if (now >= trees) trees = now + 10_000
          const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
          const active = items.some(item => item.status === 'running')
          idle = changed || active ? 0 : idle + 1
          due = now + (idle < 5 ? 2000 : 10_000)
          if (active || changed) $.ui.invalidate('ui.render')
        } catch {
          due = (await $.clock.now()) + 2000
        } finally {
          running = false
        }
      })()
    })
    running = true
    try {
      await tick($, pollers, true, true).catch(() => false)
    } finally {
      running = false
    }
    due = (await $.clock.now()) + 2000
    trees = (await $.clock.now()) + 10_000
    return started
  })
  band(on)
  pane(on, hoursOf(options.timelineHours))
  if (options.hideBuiltinTasks !== false) builtin(on)
}

async function tick(
  $: EngineInterface,
  pollers: Pollers,
  trees: boolean,
  initial = false,
): Promise<boolean> {
  const { value: items = [], version: before } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const poll: Poll = { items, changes: [] }
  for (const run of pollers) await run(poll, trees, initial).catch(() => undefined)
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next =
      version === before
        ? commit(items, () => poll.items)
        : commit(value, held => poll.changes.reduce((list, change) => change(list), held))
    if (!next) return false
    const written = await $.state.set({ plugin: 'rabe', key: 'items' }, next.items, {
      ifVersion: version,
    })
    if (!written.isSet) continue
    for (;;) {
      const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const lines = prune(value, next.dropped, items)
      if (lines === value) break
      if (
        (await $.state.set({ plugin: 'rabe', key: 'lines' }, lines, { ifVersion: version })).isSet
      )
        break
    }
    for (;;) {
      const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'turns' })
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const turns = prune(value, next.dropped, items)
      if (turns === value) break
      if (
        (await $.state.set({ plugin: 'rabe', key: 'turns' }, turns, { ifVersion: version })).isSet
      )
        break
    }
    return true
  }
}
