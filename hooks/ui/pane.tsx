import type { EngineInterface, On, RenderSurface } from 'claude-code'

import type { RabePrevious } from '../../types'
import { KIND_LABEL, orderOf, previousOf } from './lists'
import { type Held, hold, render } from './render'
import {
  type Action,
  type ArmEvent,
  type Arming,
  arm,
  bounded,
  DISARMED,
  landing,
  layout,
  type Model,
  rowKeys,
  type Selection,
  stepRow,
  targetsOf,
  taskIdOf,
} from './view'
import { fallbackOf, isLiveRow, paneView } from './views/pane'

const PANE = 'rabe'

// Esc may have closed the pane before the delayed focus call.
async function refocus($: EngineInterface): Promise<void> {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  if (!pane || pane.isFocused) return
  await $.ui.open({ id: PANE, title: 'Rabe', focus: true, closeOnEscape: true })
}

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

// Whether stop and delete act: the ring is known to sit on a safe element.
// A module value, so a reload, which also drops the hold, starts disarmed.
let arming: Arming = DISARMED

function feed($: EngineInterface, event: ArmEvent): void {
  const was = arming.isArmed
  arming = arm(arming, event)
  if (arming.isArmed !== was) $.ui.invalidate('ui.render')
}

// Moves the ring onto one of the pane's safe elements. Refused while the pane
// does not hold the keys (Enter then goes to the prompt) or when another hook
// says no: either way the ring may sit anywhere, so the pane disarms.
async function focusOn($: EngineInterface, key: string): Promise<boolean> {
  const result = await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'threw' }))
  const isMoved = !('deny' in result && result.deny)
  feed($, { type: 'landed', isMoved })

  return isMoved
}

// A new view starts its hold anew, but the ring keeps its index, where the new
// view may draw a stop; so the pane disarms and the ring moves (`landing`).
async function land($: EngineInterface, keys: string[]): Promise<void> {
  for (const key of keys) if (!(await focusOn($, key))) return
}

async function act($: EngineInterface, action: Action, surface: RenderSurface): Promise<void> {
  if (landing(action, '').length > 0) feed($, { type: 'reset' })
  switch (action.type) {
    case 'tab':
      await $.state.set({ plugin: 'rabe', key: 'tab' }, action.tab)
      return land($, landing(action, ''))
    case 'fold': {
      const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
      const next = folded.includes(action.group)
        ? folded.filter(group => group !== action.group)
        : [...folded, action.group]
      await $.state.set({ plugin: 'rabe', key: 'folded' }, next)
      return land($, landing(action, ''))
    }
    case 'open': {
      // Back selects the item that was open: the focus may have moved onto a
      // row inside its detail (a workflow's agents).
      const { value: was = '' } = await $.state.get({ plugin: 'rabe', key: 'open' })
      const id = action.id || was
      if (id) {
        await $.state.set({ plugin: 'rabe', key: 'selected' }, id)
        await $.state.set({ plugin: 'rabe', key: 'tab' }, 'items')
      }
      await $.state.set({ plugin: 'rabe', key: 'open' }, action.id)
      return land($, landing(action, was))
    }
    case 'query':
      await $.state.set({ plugin: 'rabe', key: 'query' }, action.text)
      return land($, landing(action, ''))
    case 'focus':
      await focusOn($, action.key)
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
    case 'none':
      return
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

// What the pane draws from: the sources' values and the person's place.
async function look(
  $: EngineInterface,
  isFocused: boolean,
): Promise<{ model: Model; selection: Selection }> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const { value: turns = {} } = await $.state.get({ plugin: 'rabe', key: 'turns' })
  const { value: lines = {} } = await $.state.get({ plugin: 'rabe', key: 'lines' })
  const { value: tab = 'items' } = await $.state.get({ plugin: 'rabe', key: 'tab' })
  const { value: query = '' } = await $.state.get({ plugin: 'rabe', key: 'query' })
  const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
  const { value: selected = '' } = await $.state.get({ plugin: 'rabe', key: 'selected' })
  const { value: open = '' } = await $.state.get({ plugin: 'rabe', key: 'open' })
  const { value: order } = await $.state.get({ plugin: 'rabe', key: 'order' })
  const usage = await $.session.usage().catch(() => undefined)
  const model = {
    items,
    turns,
    lines,
    now: await $.clock.now(),
    usd: usage?.cost?.usd,
    previous: await previous($).catch(() => undefined),
  }

  const selection = {
    tab,
    query,
    folded,
    selected,
    open,
    isFocused,
    isArmed: arming.isArmed,
    isListArmed: arming.isListArmed,
    ...(order && { order }),
  }

  return { model, selection }
}

// The view the person chose. A change of it is theirs, so its hold starts anew.
const scopeOf = (sel: Selection) => JSON.stringify([sel.tab, sel.open, sel.query, sel.folded])

// Per surface, the focusable keys the pane drew since it opened, for one view
// (`scope`). A render hook may not write `$.state` (drawing is pure), so this
// is a module value: a reload starts the hold anew, as a new drawing would.
const holds = new Map<string, { scope: string; keys: Held[] }>()

// Per surface, where the pane sat and whether it held the keys at the last
// drawing. A move between dock and inline takes the keys from the pane.
const seats = new Map<string, { placement: string; isFocused: boolean }>()

const heldOf = (surface: RenderSurface, sel: Selection): Held[] | undefined => {
  const mine = holds.get(surface)
  return mine?.scope === scopeOf(sel) ? mine.keys : undefined
}

// An arrow key in a pane taller than its body scrolls it a row; Rabe moves
// the focus to the next or previous row instead, and the pane follows the
// focus. Past either end the scroll goes on, to show what is above or below.
async function arrow($: EngineInterface, by: number, bodyRows: number): Promise<boolean> {
  const { model, selection } = await look($, true)
  const size = { columns: 80, rows: bodyRows, surface: 'terminal', hasInput: true } as const
  const drawn = layout(paneView(model, size, selection))
  const key = stepRow(
    rowKeys(hold(drawn, heldOf('terminal', selection)).list),
    selection.selected,
    by,
  )
  if (!key) return false
  void focusOn($, key)

  return true
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

  // Each open sorts the lists once; then they hold their order (see `stable`).
  on('command.run', { command: 'rabe' }, async $ => {
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    await $.state.set({ plugin: 'rabe', key: 'order' }, orderOf(items))
    holds.clear()
    feed($, { type: 'reset' })
    await $.ui.open({ id: PANE, title: 'Rabe', closeOnEscape: true })
    $.clock.after(1500, () => void refocus($).catch(() => undefined))

    return { text: 'Rabe opened.' }
  })

  on('session.end', { reason: /^/ }, async ($, e, next) => {
    await remember($)

    return next(e)
  }).catch((_$, e, next) => next(e))

  // A move no hook refused puts the ring on a known element: the person's
  // choice, or one of Rabe's safe ones (`autoFocus`, a landing).
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element?.startsWith('row:')) {
      await $.state.set({ plugin: 'rabe', key: 'selected' }, e.element.slice(4))
    }
    const result = await next(e)
    if (e.element && !('deny' in result && result.deny)) {
      const { model, selection } = await look($, true)
      feed($, {
        type: 'focus',
        byPerson: e.origin.kind === 'person',
        key: e.element,
        isLiveRow: isLiveRow(model, selection, e.element),
      })
    }

    return result
  }).catch((_$, e, next) => next(e))

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.pointer || Math.abs(e.by) !== 1) return next(e)
    if (await arrow($, e.by, e.bodyRows).catch(() => false)) return {}

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const seat = seats.get(e.surface)
    seats.set(e.surface, { placement: e.props.placement, isFocused: e.props.isFocused })
    if (seat?.isFocused && seat.placement !== e.props.placement) {
      $.clock.after(500, () => void refocus($).catch(() => undefined))
    }
    const { model, selection: seen } = await look($, e.props.isFocused)
    const size = bounded({
      columns: e.props.bodyColumns,
      rows: e.props.scroll?.bodyRows || 24,
      surface: e.surface,
      hasInput: 'Input' in ui,
      ...(e.props.scroll && {
        window: { top: e.props.scroll.offset, rows: e.props.scroll.bodyRows },
      }),
    })

    // What x and g would act on decides whether they may.
    const armed = paneView(model, size, { ...seen, isArmed: true, isListArmed: true })
    const { selected } = seen
    feed($, {
      type: 'drawn',
      fallback: fallbackOf(model, seen),
      targets: targetsOf(armed),
      selected,
    })
    const selection = { ...seen, isArmed: arming.isArmed, isListArmed: arming.isListArmed }
    const drawn = arming.isArmed && arming.isListArmed ? armed : paneView(model, size, selection)
    const out = hold(layout(drawn), heldOf(e.surface, selection))
    holds.set(e.surface, { scope: scopeOf(selection), keys: out.held })

    return render(ui, e.surface, out.list, (action, surface) => {
      void act($, action, surface)
    })
  })
}
