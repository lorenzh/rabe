import type { EngineInterface, On, RenderSurface } from 'claude-code'

import type { RabePrevious } from '../../types'
import { KIND_LABEL, previousOf } from './lists'
import { render } from './render'
import { type Action, taskIdOf } from './view'
import { paneView } from './views/pane'

const PANE = 'rabe'

async function tick($: EngineInterface): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  if (items.some(item => item.status === 'running')) $.ui.invalidate('ui.render')
}

// The store is the plugin's own JSON; an older Rabe may have written another shape.
function asPrevious(value: unknown): RabePrevious | undefined {
  const prev = value as RabePrevious | undefined
  return typeof prev?.endedAt === 'number' && Array.isArray(prev.failed) && prev.counts
    ? prev
    : undefined
}

async function previous($: EngineInterface): Promise<RabePrevious | undefined> {
  return asPrevious(await $.store.get(`previous:${await $.session.cwd()}`))
}

// Keeps this session's summary for the next one in this project; a session
// with no background work leaves the last summary in place.
async function remember($: EngineInterface): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  if (items.length === 0) return
  const usage = await $.session.usage()
  const summary = previousOf(items, await $.clock.now(), {
    startedAt: usage.startedAt,
    usd: usage.cost?.usd,
  })
  await $.store.set(`previous:${await $.session.cwd()}`, summary)
}

async function stop($: EngineInterface, ids: string[]): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const targets = items.filter(item => ids.includes(item.id))
  const one = targets.length === 1 ? targets[0] : undefined
  if (one) $.ui.toast(`Stopping ${KIND_LABEL[one.kind]} ${one.title}…`)
  let stopped = 0
  let ended = 0
  let refused: string | undefined
  for (const item of targets) {
    if (item.kind === 'codex' && item.status === 'running') {
      const { text = 'n/a' } = await $.command
        .run({ command: 'rabe-stop', args: item.id })
        .catch((error: unknown) => ({ text: `Stop refused: ${String(error)}` }))
      if (text.startsWith('Stopped')) stopped += 1
      else refused = text.replace(/^Stop refused: /, '')
      continue
    }
    const task = taskIdOf(item)
    if (item.status !== 'running' || !task) {
      ended += 1
      continue
    }
    try {
      const result = await $.tool.call({ tool: 'TaskStop', task_id: task })
      if (result.deny) refused = result.deny
      else if (result.isError) refused = result.text ?? 'n/a'
      else stopped += 1
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error)
    }
  }
  if (one && refused) $.ui.toast(`Stop refused: ${refused}`)
  else if (one) $.ui.toast(ended ? `${one.title} had already finished` : `Stopped ${one.title}`)
  else {
    const done = ended ? `; ${ended} had already finished` : ''
    const no = refused ? `; refused: ${refused}` : ''
    $.ui.toast(`Stopped ${stopped} of ${targets.length}${done}${no}`)
  }
}

async function act($: EngineInterface, action: Action, surface: RenderSurface): Promise<void> {
  switch (action.type) {
    case 'tab':
      await $.state.set({ plugin: 'rabe', key: 'tab' }, action.tab)
      return
    case 'select':
      await $.state.set({ plugin: 'rabe', key: 'selected' }, action.id)
      return
    case 'fold': {
      const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
      const next = folded.includes(action.group)
        ? folded.filter(group => group !== action.group)
        : [...folded, action.group]
      await $.state.set({ plugin: 'rabe', key: 'folded' }, next)
      return
    }
    case 'open':
      if (action.id) {
        await $.state.set({ plugin: 'rabe', key: 'selected' }, action.id)
        await $.state.set({ plugin: 'rabe', key: 'tab' }, 'items')
      }
      await $.state.set({ plugin: 'rabe', key: 'open' }, action.id)
      return
    case 'query':
      await $.state.set({ plugin: 'rabe', key: 'query' }, action.text)
      return
    case 'focus':
      await $.ui.focus({ requestId: PANE, key: action.key })
      return
    case 'stop':
      await stop($, action.ids)
      return
    case 'delete': {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const item = items.find(one => one.id === action.id)
      if (item?.kind !== 'cron' || item.detail.scheduledFor !== undefined) return
      const result = await $.tool.call({ tool: 'CronDelete', id: item.detail.jobId })
      const reason = result.deny ?? (result.isError ? (result.text ?? 'n/a') : undefined)
      $.ui.toast(reason ? `Delete refused: ${reason}` : `Deleted cron ${item.title}`)
      return
    }
    case 'copy': {
      const result = await $.ui.copy({ text: action.text, surface })
      $.ui.toast(result.isCopied ? `Copied: ${action.text}` : `Copy failed: ${result.reason}`)
      return
    }
    case 'message': {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const item = items.find(one => one.id === action.id)
      if (item?.kind !== 'agent' || !action.text.trim()) return
      const sent = await $.session.send({ to: { agentId: item.detail.agentId }, text: action.text })
      $.ui.toast(
        sent.isDelivered
          ? `Message sent to claude ${item.title}`
          : `Message not sent: ${sent.reason}`,
      )
      return
    }
  }
}

export function pane(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rabe',
      description:
        'Show background work: agents, Codex jobs, shells, monitors, cron jobs and workflows',
    })
    $.clock.every(1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'rabe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Rabe', closeOnEscape: true })
    $.clock.after(
      1500,
      () => void $.ui.open({ id: PANE, title: 'Rabe', focus: true, closeOnEscape: true }),
    )

    return { text: 'Rabe opened.' }
  })

  on('session.end', { reason: /^/ }, async ($, e, next) => {
    await remember($)

    return next(e)
  }).catch((_$, e, next) => next(e))

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element?.startsWith('row:')) {
      await $.state.set({ plugin: 'rabe', key: 'selected' }, e.element.slice(4))
    }

    return next(e)
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const { value: turns = {} } = await $.state.get({ plugin: 'rabe', key: 'turns' })
    const { value: lines = {} } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const { value: tab = 'items' } = await $.state.get({ plugin: 'rabe', key: 'tab' })
    const { value: query = '' } = await $.state.get({ plugin: 'rabe', key: 'query' })
    const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
    const { value: selected = '' } = await $.state.get({ plugin: 'rabe', key: 'selected' })
    const { value: open = '' } = await $.state.get({ plugin: 'rabe', key: 'open' })
    const usage = await $.session.usage().catch(() => undefined)
    const model = {
      items,
      turns,
      lines,
      now: await $.clock.now(),
      usd: usage?.cost?.usd,
      previous: await previous($).catch(() => undefined),
    }
    const size = {
      columns: e.props.bodyColumns,
      rows: e.props.scroll?.bodyRows || 24,
      surface: e.surface,
      hasInput: 'Input' in ui,
    }
    const selection = { tab, query, folded, selected, open, isFocused: e.props.isFocused }

    return render(ui, e.surface, paneView(model, size, selection), (action, surface) => {
      void act($, action, surface)
    })
  })
}
