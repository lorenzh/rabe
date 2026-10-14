import type { EngineInterface, Next, On, RenderSurface, UiFocusInput } from 'claude-code'

import type { RabePrevious } from '../../types'
import { isEnded, type RabeItem } from '../model'
import {
  deferredFocus,
  heldOf,
  IDLE,
  type InteractionEvent,
  interact,
  isHeldBack,
  movedFocus,
  REGAIN_MS,
  type Shift,
  scopeOf,
} from './interaction'
import { KIND_LABEL, kept, matches, orderOf, previousOf, rowOf } from './lists'
import { asPrevious, clipText, nameOf, toastText } from './pane-data'
import { follow, geometry, measure, NO_PIN, type Pin } from './pin'
import { type At, hold, render } from './render'
import { reserve, screens, sequence } from './sequence'
import {
  type Action,
  bounded,
  landing,
  landingOf,
  landOn,
  layout,
  type Model,
  messageLanding,
  rowKeys,
  type Selection,
  stepRow,
  taskIdOf,
  waitsForView,
} from './view'
import { isLiveRow, paneView, seatsRows, selectsOnPress, TABS } from './views/pane'
import { widen, windowOf } from './views/timeline'

const PANE = 'rabe'
const MAX_ACTIONS = 20

// The option `timelineHours`, set by `pane(on, hours)`: the Timeline's window
// when the pane opens.
let baseHours = 4

// The list under the pinned header (see `geometry`): where it stands, and
// whether the last drawing clipped it, so a scroll moves it, not the engine.
let pinned: Pin = NO_PIN
let isPinned = false

// Reasons come from files and tools.
function toast($: EngineInterface, text: string): void {
  $.ui.toast(toastText(text))
}

// Esc may have closed the pane before the delayed focus call.
async function refocus($: EngineInterface): Promise<void> {
  let shown = (await $.ui.panes()).find(one => one.id === PANE)
  if (shown && !shown.isFocused) {
    await $.ui.open({ id: PANE, title: 'Rabe', focus: true, closeOnEscape: true })
    shown = (await $.ui.panes()).find(one => one.id === PANE)
  }
  feed($, { type: 'refocused', isOpen: !!shown, isFocused: !!shown?.isFocused })
}

async function previous($: EngineInterface): Promise<RabePrevious | undefined> {
  const key = `previous:${await $.session.cwd()}`
  const stored = await $.store.get(key)
  const summary = asPrevious(stored)
  if (summary && stored && typeof stored === 'object' && 'failed' in stored) {
    await $.store.set(key, summary)
  }

  return summary
}

// Keeps this session's summary for the next one in this project; a session
// with no background work leaves the last summary in place.
async function remember($: EngineInterface, sessionId?: string): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  if (items.length === 0) {
    await previous($)
    return
  }
  const usage = await $.session.usage()
  const summary = previousOf(
    items,
    await $.clock.now(),
    { startedAt: usage.startedAt, usd: usage.cost?.usd },
    sessionId,
  )
  await $.store.set(`previous:${await $.session.cwd()}`, summary)
}

async function stop($: EngineInterface, ids: string[]): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const targets = items.filter(item => ids.includes(item.id))
  const one = targets.length === 1 ? targets[0] : undefined
  if (one) toast($, `Stopping ${KIND_LABEL[one.kind]} ${nameOf(one)}…`)
  let stopped = 0
  const stoppedItems: RabeItem[] = []
  let ended = 0
  let refused: string | undefined
  for (const item of targets) {
    if (item.kind === 'codex' && item.status === 'running') {
      const { text = 'n/a' } = await $.command
        .run({ command: 'rabe-stop', args: item.id })
        .catch((error: unknown) => ({ text: `Stop refused: ${String(error)}` }))
      if (text.startsWith('Stopped')) {
        stopped += 1
        stoppedItems.push(item)
      } else {
        const { value: current = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
        const job = current.find(one => one.id === item.id)
        refused =
          (job?.kind === 'codex' && job.detail.stopError) || text.replace(/^Stop refused: /, '')
      }
      continue
    }
    const task = taskIdOf(item)
    if (isEnded(item) || !task) {
      ended += 1
      continue
    }
    try {
      const result = await $.tool.call({ tool: 'TaskStop', task_id: task })
      if (result.deny) refused = result.deny
      else if (result.isError) refused = result.text ?? 'n/a'
      else {
        stopped += 1
        stoppedItems.push(item)
      }
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error)
    }
  }
  for (const item of stoppedItems) {
    await queueAction($, `Rabe: user stopped ${item.kind} ${item.id}`)
  }
  if (one && refused) toast($, `Stop refused: ${refused}`)
  else if (one)
    toast(
      $,
      ended
        ? `${KIND_LABEL[one.kind]} ${nameOf(one)} had already finished`
        : `Stopped ${KIND_LABEL[one.kind]} ${nameOf(one)}`,
    )
  else {
    const done = ended ? `; ${ended} had already finished` : ''
    const no = refused ? `; refused: ${refused}` : ''
    toast($, `Stopped ${stopped} of ${targets.length}${done}${no}`)
  }
}

async function queueAction($: EngineInterface, note: string): Promise<void> {
  for (;;) {
    const { value = [], version } = await $.state.get({ plugin: 'rabe', key: 'actions' })
    const { isSet } = await $.state.set(
      { plugin: 'rabe', key: 'actions' },
      [...value, note].slice(-MAX_ACTIONS),
      { ifVersion: version },
    )
    if (isSet) return
  }
}

async function clearActions($: EngineInterface, delivered: string[]): Promise<void> {
  for (;;) {
    const { value = [], version } = await $.state.get({ plugin: 'rabe', key: 'actions' })
    if (!delivered.every((note, index) => value[index] === note)) return
    const { isSet } = await $.state.set(
      { plugin: 'rabe', key: 'actions' },
      value.slice(delivered.length),
      { ifVersion: version },
    )
    if (isSet) return
  }
}

// A reload drops the hold too, so interaction starts disarmed.
let interaction = IDLE

function feed($: EngineInterface, event: InteractionEvent) {
  const was = interaction.arming
  const result = interact(interaction, event)
  interaction = result.state
  for (const effect of result.effects) {
    if (effect.type === 'refocus')
      $.clock.after(effect.after, () => void refocus($).catch(() => undefined))
    else if (effect.type === 'regain')
      $.clock.after(REGAIN_MS, () => void regain($, effect.want).catch(() => undefined))
    else $.ui.invalidate('ui.render')
  }
  const now = interaction.arming
  if (now.isArmed !== was.isArmed || now.isListArmed !== was.isListArmed) {
    $.ui.invalidate('ui.render')
  }
  return result
}

async function focusOn($: EngineInterface, key: string): Promise<boolean> {
  feed($, { type: 'focus-start', key })
  const result = await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'threw' }))
  const isMoved = !('deny' in result && result.deny) && interaction.landedOn === key
  feed($, { type: 'landed', isMoved })
  return isMoved
}

async function regain($: EngineInterface, want: Shift): Promise<void> {
  if (interaction.shift !== want) return
  const result = await $.ui
    .focus({ requestId: PANE, key: want.key })
    .catch(() => ({ deny: 'threw' }))
  feed($, { type: 'regained', want, isMoved: !('deny' in result && result.deny) })
}

// The landings waiting for a drawing of their new view (`screens`). The next
// press, Input event, arrow or person's focus move, and a close, end them.
const screen = screens()

async function onScreen($: EngineInterface, surface: RenderSurface): Promise<boolean> {
  const ready = screen.ask(surface, (ms, signal) => $.clock.sleep(ms, { signal }))
  $.ui.invalidate('ui.render')
  return ready
}

// A new view starts its hold anew, but the ring keeps its index, where the new
// view may draw a stop; so the pane disarms and the ring moves (`landing`).
async function land(
  $: EngineInterface,
  keys: string[],
  action?: Action,
  surface?: RenderSurface,
): Promise<void> {
  return landOn(
    keys,
    () => interaction.ringOn,
    key => focusOn($, key),
    action && surface && waitsForView(action) ? () => onScreen($, surface) : undefined,
  )
}

async function landView($: EngineInterface, action: Action, surface: RenderSurface): Promise<void> {
  const { model, selection } = await look($, true)
  const drawn = paneView(model, { columns: 80, rows: 24, surface, hasInput: true }, selection)
  return land($, landing(action, selection.open, drawn), action, surface)
}

// A press on a live row of the Items list away from the ring selects it: a
// click moves no ring, so the press is the person's choice of that row. The
// ring's row and the selected row open.
async function choose($: EngineInterface, id: string): Promise<boolean> {
  const { model, selection } = await look($, true)
  if (!selectsOnPress(model, selection, id, interaction.ringOn)) return false
  await $.state.set({ plugin: 'rabe', key: 'selected' }, id)
  feed($, { type: 'press' })

  return true
}

// Hides ended items for the session: they stay in `rabe.items`, which polls
// fill again, and only the Items list leaves them out (`kept`). An id stays even when
// the cap drops its item, which a poll may find again.
async function remove($: EngineInterface, action: Action & { type: 'remove' | 'clear' }) {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const { value: query = '' } = await $.state.get({ plugin: 'rabe', key: 'query' })
  let gone: RabeItem[] = []
  for (;;) {
    const { value: removed = [], version } = await $.state.get({ plugin: 'rabe', key: 'removed' })
    gone = kept(items, removed).filter(
      item =>
        isEnded(item) &&
        (action.type === 'remove' ? action.ids.includes(item.id) : matches(item, query)),
    )
    if (gone.length === 0) return
    const next = [...removed, ...gone.map(item => item.id)]
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'removed' }, next, {
      ifVersion: version,
    })
    if (isSet) break
  }
  const [one] = gone
  toast(
    $,
    gone.length === 1 && one
      ? `Removed ${KIND_LABEL[one.kind]} ${nameOf(one)}`
      : `Removed ${gone.length} ended items`,
  )
}

async function act($: EngineInterface, action: Action, surface: RenderSurface): Promise<void> {
  if (action.type === 'open' && (await choose($, action.id))) return
  const [safe] = landing(action, '')
  if (action.type !== 'message' && safe) {
    feed($, { type: 'reset' })
    await focusOn($, safe)
  }
  switch (action.type) {
    case 'tab':
      await $.state.set({ plugin: 'rabe', key: 'tab' }, action.tab)
      return landView($, action, surface)
    case 'fold': {
      const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
      const next = folded.includes(action.group)
        ? folded.filter(group => group !== action.group)
        : [...folded, action.group]
      await $.state.set({ plugin: 'rabe', key: 'folded' }, next)
      return land($, landing(action, ''), action, surface)
    }
    case 'open': {
      // Back selects the item that was open: the focus may have moved onto a
      // row inside its detail (a workflow's agents). A folded forwarder has no
      // row, so back selects its job.
      const { value: open = '' } = await $.state.get({ plugin: 'rabe', key: 'open' })
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const was = rowOf(open, items)
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
      return action.isSubmit ? landView($, action, surface) : land($, landing(action, ''))
    case 'window': {
      const now = await $.clock.now()
      const { value = windowOf(baseHours, now) } = await $.state.get({
        plugin: 'rabe',
        key: 'window',
      })
      await $.state.set({ plugin: 'rabe', key: 'window' }, widen(value, now))
      return land($, landing(action, ''))
    }
    case 'focus':
      await focusOn($, action.key)
      return
    case 'stop':
      await stop($, action.ids)
      return
    case 'remove':
    case 'clear':
      await remove($, action)
      return
    case 'delete': {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const item = items.find(one => one.id === action.id)
      if (
        item?.kind !== 'cron' ||
        item.status !== 'running' ||
        item.detail.scheduledFor !== undefined
      )
        return
      const result = await $.tool.call({ tool: 'CronDelete', id: item.detail.jobId })
      const reason = result.deny ?? (result.isError ? (result.text ?? 'n/a') : undefined)
      toast(
        $,
        reason
          ? `Delete refused: ${reason.replace(/<\/?tool_use_error>/g, '').trim()}`
          : `Deleted cron ${nameOf(item)}`,
      )
      if (!reason) await queueAction($, `Rabe: user deleted cron ${item.id}`)
      return
    }
    case 'copy': {
      if (action.what !== 'command' && action.what !== 'prompt' && /[\r\n]/.test(action.text)) {
        toast($, `Copy refused: ${action.what} contains a line break.`)
        return
      }
      // Over SSH the clipboard needs the terminal's OSC 52.
      const text = clipText(action.text)
      const result = await $.ui
        .copy({ text, surface })
        .catch((error: unknown) => ({ isCopied: false as const, reason: String(error) }))
      const preview = toastText(text)
      // only text the filters left alone is offered for selection
      const selectable = action.what !== 'prompt' && preview === action.text
      const lines = text.split(/\r\n|\r|\n/).length
      const chars = [...text].length
      const copied = `Copied ${action.what} · ${lines} ${lines === 1 ? 'line' : 'lines'} · ${chars} ${chars === 1 ? 'char' : 'chars'}`
      toast(
        $,
        result.isCopied
          ? copied
          : `Copy failed: ${result.reason}.${selectable ? ` Select it: ${text}` : ''}`,
      )
      return
    }
    case 'none':
      return
    case 'message': {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const item = items.find(one => one.id === action.id)
      if (item?.kind !== 'agent' || !action.text.trim()) return
      const sent = await $.session.send({ to: { agentId: item.detail.agentId }, text: action.text })
      toast(
        $,
        sent.isDelivered
          ? `Message sent to claude ${nameOf(item)}`
          : `Message not sent: ${sent.reason}`,
      )
      if (sent.isDelivered) await queueAction($, `Rabe: user sent a message to agent ${item.id}`)
      return sequence(async () => {
        const { selection } = await look($, true)
        const target = messageLanding(action, selection, interaction.ringOn)
        if (target) await land($, target)
      })
    }
  }
}

// What the pane draws from: the sources' values and the person's place.
async function look(
  $: EngineInterface,
  isFocused: boolean,
): Promise<{ model: Model; selection: Selection }> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const { value: removed = [] } = await $.state.get({ plugin: 'rabe', key: 'removed' })
  const { value: turns = {} } = await $.state.get({ plugin: 'rabe', key: 'turns' })
  const { value: lines = {} } = await $.state.get({ plugin: 'rabe', key: 'lines' })
  const { value: edits = [] } = await $.state.get({ plugin: 'rabe', key: 'edits' })
  const { value: tab = 'items' } = await $.state.get({ plugin: 'rabe', key: 'tab' })
  const { value: query = '' } = await $.state.get({ plugin: 'rabe', key: 'query' })
  const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
  const { value: selected = '' } = await $.state.get({ plugin: 'rabe', key: 'selected' })
  const { value: open = '' } = await $.state.get({ plugin: 'rabe', key: 'open' })
  const { value: order } = await $.state.get({ plugin: 'rabe', key: 'order' })
  const { value: worktrees } = await $.state.get({ plugin: 'rabe', key: 'worktrees' })
  const { value: window } = await $.state.get({ plugin: 'rabe', key: 'window' })
  const now = await $.clock.now()
  const usage = await $.session.usage().catch(() => undefined)
  const model = {
    items,
    removed,
    turns,
    lines,
    now,
    usd: usage?.cost?.usd,
    previous: await previous($).catch(() => undefined),
    edits,
    cwd: await $.session.cwd().catch(() => undefined),
    sessionId: await $.session.id().catch(() => undefined),
    ...(worktrees && { worktrees }),
  }

  const selection = {
    tab,
    query,
    folded,
    selected,
    open,
    isFocused,
    isArmed: interaction.arming.isArmed,
    isListArmed: interaction.arming.isListArmed,
    window: window ?? windowOf(baseHours, now),
    ...(order && { order }),
  }

  return { model, selection }
}

// The presses and Input events under way, per surface and element, oldest
// first. Each event's hook adds its own slot before `next(e)`; the closure
// beneath, which the engine runs with the event, fills the oldest empty slot of
// its element, so an event carries out only an action of its own element.
// ponytail: two events on one element in flight at once may swap their
// actions; both are that element's, and each runs exactly once.
type Slot = { press?: { action: Action; surface: RenderSurface } }
const waiting = new Map<string, Slot[]>()

const slotOf = (at: At) => `${at.surface} ${at.element}`

function leave(action: Action, at: At): void {
  const slot = waiting.get(slotOf(at))?.find(one => !one.press)
  if (slot) slot.press = { action, surface: at.surface }
}

// Runs a press or an Input event beneath the hook, then carries out the action
// its closure left in this event's own slot with the hook's `$`.
async function carry<R>($: EngineInterface, at: At, run: () => Promise<R>): Promise<R> {
  const key = slotOf(at)
  const mine: Slot = {}
  screen.release()
  const focusTurn = reserve()
  feed($, { type: 'press-start' })
  waiting.set(key, [...(waiting.get(key) ?? []), mine])
  let result: R
  try {
    result = await run()
  } catch (error) {
    await focusTurn(async () => undefined)
    feed($, { type: 'press-end' })
    throw error
  } finally {
    const rest = (waiting.get(key) ?? []).filter(one => one !== mine)
    if (rest.length > 0) waiting.set(key, rest)
    else waiting.delete(key)
  }
  try {
    const press = mine.press
    if (press && !isHeldBack(interaction, at)) {
      const action = press.action
      if (
        action.type === 'focus' ||
        (action.type !== 'message' && landing(action, '').length > 0)
      ) {
        await focusTurn(() => act($, action, press.surface))
      } else {
        await focusTurn(async () => undefined)
        await act($, action, press.surface)
      }
    } else {
      await focusTurn(async () => undefined)
    }

    return result
  } finally {
    feed($, { type: 'press-end' })
  }
}

// An arrow key in a pane taller than its body scrolls it a row; Rabe moves
// the focus to the next or previous row instead, and the pane follows the
// focus. Past either end the scroll goes on, to show what is above or below.
async function arrow($: EngineInterface, by: number, bodyRows: number): Promise<number | false> {
  const { model, selection } = await look($, true)
  const size = { columns: 80, rows: bodyRows, surface: 'terminal', hasInput: true } as const
  const drawn = layout(paneView(model, size, selection))
  const keys = rowKeys(
    hold(drawn, heldOf(interaction, 'terminal', selection), seatsRows(selection)).list,
  )
  const key = stepRow(keys, selection.selected, by)
  if (!key) return false
  const from = keys.indexOf(`row:${selection.selected}`)
  const to = keys.indexOf(key)
  const moved = from < 0 ? to + 1 : to - from
  feed($, { type: 'step', key })
  await focusOn($, key)

  return by - moved
}

async function focused($: EngineInterface, e: UiFocusInput, next: Next<'ui.focus'>) {
  const { value: before = '' } = await $.state.get({ plugin: 'rabe', key: 'selected' })
  const asked = e.element?.startsWith('row:') ? e.element.slice(4) : before
  if (asked !== before) await $.state.set({ plugin: 'rabe', key: 'selected' }, asked)
  const result = await next(e)
  const landing = landingOf(next.trace, 'deny' in result && !!result.deny)
  const landed = landing?.element
  const selected = landed?.startsWith('row:') ? landed.slice(4) : before
  if (selected !== asked) await $.state.set({ plugin: 'rabe', key: 'selected' }, selected)
  if (landing && !landed) feed($, { type: 'unfocused' })
  if (!landing) feed($, { type: 'landed', isMoved: false })
  else if (landed) {
    const { model, selection } = await look($, true)
    feed($, {
      type: 'focus',
      byPerson: e.origin.kind === 'person',
      key: landed,
      requested: e.element,
      isLiveRow: isLiveRow(model, selection, landed),
      selected: selection.selected,
    })
    // A control or Input inside the clipped list is scrolled into view.
    if (isPinned && !landed.startsWith('row:')) $.ui.invalidate('ui.render')
  }

  return result
}

export function pane(on: On, hours = baseHours): void {
  baseHours = hours
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rabe',
      description:
        'Show background work: agents, Codex jobs, shells, monitors, cron jobs and workflows',
      immediate: true,
    })

    return next(e)
  })

  // Each open sorts the lists once; then they hold their order (see `stable`).
  on('command.run', { command: 'rabe' }, async $ => {
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const { value: edits = [] } = await $.state.get({ plugin: 'rabe', key: 'edits' })
    await $.state.set({ plugin: 'rabe', key: 'order' }, orderOf(items, edits))
    await $.state.set({ plugin: 'rabe', key: 'window' }, windowOf(baseHours, await $.clock.now()))
    feed($, { type: 'opened' })
    pinned = NO_PIN
    await $.ui.open({ id: PANE, title: 'Rabe', closeOnEscape: true })

    return { text: 'Rabe opened.' }
  })

  // A close the host carries out clears every hold; a canceled one keeps it.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (!(await $.ui.panes()).some(one => one.id === PANE)) {
      screen.release()
      feed($, { type: 'closed' })
      isPinned = false
    }
    return result
  }).catch((_$, e, next) => next(e))

  on('session.end', { reason: /^/ }, async ($, e, next) => {
    await remember($, e.resume?.id ?? e.sessionId)

    return next(e)
  }).catch((_$, e, next) => next(e))

  on('prompt.submit', { origin: { kind: /^/ } }, async ($, e, next) => {
    const { value: actions = [] } = await $.state.get({ plugin: 'rabe', key: 'actions' })
    if (actions.length === 0) return next(e)
    const result = await next({ ...e, context: [...(e.context ?? []), ...actions] })
    if (!result.drop) await clearActions($, actions)
    return result
  }).catch((_$, e, next) => next(e))

  on('ui.focus', { requestId: PANE, origin: { kind: 'plugin' } }, ($, e, next) =>
    focused($, e, next),
  ).catch((_$, e, next) => next(e))

  // A fresh plugin move must reach a different hook than this active person hook.
  on('ui.focus', { requestId: PANE, origin: { kind: 'person' } }, ($, e, next) => {
    screen.release()
    const keys =
      interaction.holds[interaction.surface ?? 'terminal']?.keys.map(one => one.key) ?? []
    const move = deferredFocus(interaction, keys, e.element)
    if (move) {
      feed($, { type: 'focus-queued', key: e.element, move })
      return sequence(async () => {
        const current =
          interaction.holds[interaction.surface ?? 'terminal']?.keys.map(one => one.key) ?? []
        const key = movedFocus(interaction, current, move)
        if (!key) return focused($, e, next)
        feed($, { type: 'step', key })
        return (await focusOn($, key)) ? {} : { deny: 'Rabe focus move refused' }
      })
    }
    return interaction.ringOn && e.element !== interaction.ringOn
      ? sequence(() => focused($, e, next))
      : focused($, e, next)
  }).catch((_$, e, next) => next(e))

  // Rabe's own `$.ui.focus` from a Button's or Input's closure reaches no
  // hook of Rabe's, so its landings would never count; calls from these do.
  on('ui.press', { requestId: PANE }, ($, e, next) =>
    carry($, e, async () => {
      const tab = TABS.find(one => e.element === `tab-${one.tab}`)
      if (!tab) return next(e)
      leave({ type: 'tab', tab: tab.tab }, e)
      return { element: e.element }
    }),
  ).catch((_$, e, next) =>
    next.called && next.error.message?.includes('no handler is held under handle')
      ? { element: e.element }
      : next(e),
  )
  on('ui.input', { requestId: PANE }, ($, e, next) => carry($, e, () => next(e))).catch(
    (_$, e, next) =>
      next.called && next.error.message?.includes('no handler is held under handle')
        ? { element: e.element, value: e.value }
        : next(e),
  )

  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    // The pane fits its body: the list scrolls under the header, by our own offset.
    if (isPinned && e.contentRows <= e.bodyRows) {
      if (e.by !== 0) {
        pinned = { ...pinned, top: Math.max(0, pinned.top + e.by) }
        $.ui.invalidate('ui.render')
      }
      return {}
    }
    if (e.pointer || e.by === 0 || Math.abs(e.by) >= e.bodyRows) return next(e)
    screen.release()
    const remaining = await sequence(() => arrow($, e.by, e.bodyRows)).catch(() => false)
    if (remaining === 0) return {}
    if (typeof remaining === 'number')
      return next(
        e.offset > 0 && e.offset < e.contentRows - e.bodyRows
          ? { ...e, offset: e.offset - e.by + remaining }
          : e,
      )

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ask = screen.asked()
    const ui = $.ui.resolve(e)
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

    // On the terminal a body taller than its room scrolls under the header.
    // The scroll is measured on the held pieces the pane draws: a dry run of
    // the drawing finds them for the scroll the view gets.
    const fresh =
      e.surface === 'terminal' && e.props.scroll ? geometry(model, size, seen) : undefined
    isPinned = !!fresh
    const drawing = (rows: number): InteractionEvent => ({
      type: 'render',
      model,
      size: fresh ? { ...size, window: { top: fresh.above + pinned.top, rows } } : size,
      selection: seen,
      placement: e.props.placement,
    })
    let rows = fresh?.rows ?? 0
    if (fresh) {
      const dry = interact(interaction, drawing(rows)).list ?? []
      const geo = measure(dry, fresh.head, size, seen.selected, interaction.ringOn)
      pinned = follow(pinned, geo, scopeOf(seen), geo.key)
      rows = geo.rows
    }

    const { list = [] } = feed($, drawing(rows))
    screen.drew(e.surface, ask)
    if (!fresh) return render(ui, e.surface, list, leave)
    const geo = measure(list, fresh.head, size, seen.selected, interaction.ringOn)
    pinned = { ...pinned, top: Math.min(pinned.top, Math.max(0, geo.total - geo.rows)) }

    return render(ui, e.surface, list, leave, 'cells', {
      split: geo.split,
      rows: geo.rows,
      top: pinned.top,
    })
  })
}
