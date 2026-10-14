import { type Held, hold, isRowKey, shifts } from './render'
import {
  type ArmEvent,
  type Arming,
  arm,
  DISARMED,
  layout,
  type Model,
  type Piece,
  type Selection,
  type Size,
  targetsOf,
} from './view'
import { fallbackOf, paneView, seatsRows } from './views/pane'

export type Shift = { key: string; isAsked: boolean; tries: number }
type Seat = { placement: string; isFocused: boolean }
export type Interaction = {
  arming: Arming
  ringOn?: string
  landedOn?: string
  aimOn?: string
  landingFrom?: string
  queued?: { key: string | undefined; move: DeferredFocus }
  shift?: Shift
  seats: Record<string, Seat>
  holds: Record<string, { scope: string; keys: Held[] }>
  pressing: number
  surface?: string
  opening?: { isAsked: boolean; tries: number }
}

export const IDLE: Interaction = { arming: DISARMED, seats: {}, holds: {}, pressing: 0 }
export const REGAIN_MS = 100

export const scopeOf = (sel: Selection): string =>
  JSON.stringify([sel.tab, sel.open, sel.query, sel.folded, sel.window?.hours])

export const heldOf = (state: Interaction, surface: string, sel: Selection): Held[] | undefined => {
  const mine = state.holds[surface]
  return mine?.scope === scopeOf(sel) ? mine.keys : undefined
}

export type InteractionEvent =
  | ArmEvent
  | { type: 'opened' | 'closed' | 'press-start' | 'press-end' | 'unfocused' }
  | { type: 'render'; model: Model; size: Size; selection: Selection; placement: string }
  | { type: 'focus-start'; key: string }
  | { type: 'focus-queued'; key: string | undefined; move: DeferredFocus }
  | { type: 'refocused'; isOpen: boolean; isFocused: boolean }
  | { type: 'regained'; want: Shift; isMoved: boolean }
  // A timer's focus call on reopen landed on `key`; no focus hook ran.
  | { type: 'restored'; key: string }
  | {
      type: 'draw'
      surface: string
      placement: string
      isFocused: boolean
      scope: string
      pieces: Piece[]
      inPlace: boolean
    }

export type Effect =
  | { type: 'refocus'; after: number }
  | { type: 'regain'; want: Shift }
  | { type: 'redraw' }

export function interact(
  state: Interaction,
  event: InteractionEvent,
): { state: Interaction; effects: Effect[]; list?: Piece[] } {
  const effects: Effect[] = []
  switch (event.type) {
    case 'render': {
      const { model, size, selection } = event
      const armed = paneView(model, size, { ...selection, isArmed: true, isListArmed: true })
      const arming = arm(state.arming, {
        type: 'drawn',
        fallback: fallbackOf(model, selection),
        targets: targetsOf(armed),
        selected: selection.selected,
      })
      const drawn =
        arming.isArmed && arming.isListArmed
          ? armed
          : paneView(model, size, { ...selection, ...arming })
      return interact(
        { ...state, arming },
        {
          type: 'draw',
          surface: size.surface,
          placement: event.placement,
          isFocused: selection.isFocused,
          scope: scopeOf(selection),
          pieces: layout(drawn),
          inPlace: seatsRows(selection),
        },
      )
    }
    case 'opened':
      return {
        state: {
          ...state,
          arming: DISARMED,
          ringOn: undefined,
          landedOn: undefined,
          aimOn: undefined,
          landingFrom: undefined,
          queued: undefined,
          shift: undefined,
          holds: {},
          opening: { isAsked: true, tries: 1 },
        },
        effects: [{ type: 'refocus', after: 50 }],
      }
    case 'closed':
      return { state: { ...IDLE, pressing: state.pressing }, effects }
    case 'refocused': {
      if (!state.opening) return { state, effects }
      const opening =
        event.isOpen && !event.isFocused && state.opening.tries < 40
          ? { ...state.opening, isAsked: false }
          : undefined
      if (opening) effects.push({ type: 'redraw' })
      return { state: { ...state, opening }, effects }
    }
    case 'unfocused':
      return {
        state: {
          ...state,
          ringOn: undefined,
          landedOn: undefined,
          aimOn: undefined,
          landingFrom: undefined,
          queued: undefined,
          shift: undefined,
        },
        effects,
      }
    case 'press-start':
      return {
        state: {
          ...state,
          pressing: state.pressing + 1,
          landingFrom: state.pressing ? state.landingFrom : undefined,
        },
        effects,
      }
    case 'press-end':
      return { state: { ...state, pressing: state.pressing - 1 }, effects }
    case 'focus-start':
      return {
        state: { ...state, landedOn: undefined, aimOn: event.key, queued: undefined },
        effects,
      }
    case 'focus-queued':
      return { state: { ...state, queued: { key: event.key, move: event.move } }, effects }
    case 'landed':
      return { state: { ...state, aimOn: undefined, arming: arm(state.arming, event) }, effects }
    case 'regained':
      if (state.shift !== event.want) return { state, effects }
      return {
        state: event.isMoved
          ? { ...state, shift: undefined }
          : {
              ...state,
              shift: { ...event.want, isAsked: false },
              arming: arm(state.arming, { type: 'landed', isMoved: false }),
            },
        effects,
      }
    case 'restored':
      return {
        state: { ...state, ringOn: event.key, landedOn: event.key, shift: undefined },
        effects,
      }
    case 'draw': {
      const seat = state.seats[event.surface]
      const before = state.holds[event.surface]
      const held = before?.scope === event.scope ? before.keys : undefined
      const out = hold(event.pieces, held, event.inPlace)
      let shift = state.shift
      if (held && shifts(held, out.held, state.ringOn) && state.ringOn) {
        // Rows that come and go keep moving the ring: the tries stay bounded.
        const tries = state.shift?.key === state.ringOn ? state.shift.tries : 0
        shift = { key: state.ringOn, isAsked: false, tries }
      }
      if (shift && seat && !seat.isFocused && event.isFocused) shift = { ...shift, tries: 0 }
      // A ring row that left has no key to regain: its presses stay held back.
      const isHeld = out.held.some(one => one.key === shift?.key)
      if (shift && isHeld && !shift.isAsked && shift.tries < 3 && event.isFocused) {
        shift = { ...shift, isAsked: true, tries: shift.tries + 1 }
        effects.push({ type: 'regain', want: shift })
      }
      let opening = event.isFocused ? undefined : state.opening
      if (opening && !opening.isAsked) {
        opening = { isAsked: true, tries: opening.tries + 1 }
        effects.push({ type: 'refocus', after: 50 })
      } else if (seat?.isFocused && seat.placement !== event.placement) {
        effects.push({ type: 'refocus', after: 500 })
      }
      return {
        state: {
          ...state,
          shift,
          opening,
          holds: { ...state.holds, [event.surface]: { scope: event.scope, keys: out.held } },
          surface: event.isFocused ? event.surface : state.surface,
          seats: {
            ...state.seats,
            [event.surface]: { placement: event.placement, isFocused: event.isFocused },
          },
        },
        effects,
        list: out.list,
      }
    }
    case 'reset':
      return {
        state: {
          ...state,
          arming: DISARMED,
          ringOn: undefined,
          landedOn: undefined,
          aimOn: undefined,
          queued: undefined,
          landingFrom: state.pressing ? (state.ringOn ?? state.landingFrom) : undefined,
          shift: undefined,
        },
        effects,
      }
    case 'focus':
      return {
        state: {
          ...state,
          arming: arm(state.arming, event),
          ringOn: event.key,
          queued: undefined,
          landingFrom:
            event.byPerson || event.key === state.arming.step
              ? undefined
              : event.key === state.ringOn
                ? state.landingFrom
                : (state.ringOn ?? state.landingFrom),
          aimOn: undefined,
          landedOn: event.key,
          shift: undefined,
        },
        effects,
      }
    default:
      return { state: { ...state, arming: arm(state.arming, event) }, effects }
  }
}

export const isHeldBack = (state: Interaction, at: { surface: string; element: string }): boolean =>
  state.shift !== undefined && state.seats[at.surface]?.isFocused === true && isRowKey(at.element)

export type DeferredFocus = { by: number } | { key: string | undefined }

// The engine computes an all-fit arrow against the old tree before a press lands.
export function deferredFocus(
  state: Interaction,
  keys: readonly string[],
  key: string | undefined,
): DeferredFocus | undefined {
  if (!state.pressing && !keys.includes(state.landingFrom ?? '')) return undefined
  if (state.queued && state.queued.key === key) return state.queued.move
  const from = keys.indexOf(state.ringOn ?? '')
  const aim = keys.indexOf(state.aimOn ?? '')
  const to = keys.indexOf(key ?? '')
  const before = keys.indexOf(state.landingFrom ?? '')
  const origins = state.queued ? [keys.indexOf(state.queued.key ?? '')] : [aim, from, before]
  for (const origin of origins) {
    if (origin < 0 || to < 0) continue
    const by = to - origin
    if (!state.queued && origin === from && by === 0) return { by: 0 }
    if (Math.abs(by) === 1) return { by }
    if (keys.length > 2 && Math.abs(by) === keys.length - 1) return { by: by > 0 ? -1 : 1 }
  }
  return state.pressing ? { key } : undefined
}

export function movedFocus(
  state: Interaction,
  keys: readonly string[],
  move: DeferredFocus,
): string | undefined {
  if ('key' in move) return move.key
  const from = keys.indexOf(state.ringOn ?? '')
  if (from < 0 || keys.length === 0) return undefined
  return keys[(((from + move.by) % keys.length) + keys.length) % keys.length]
}
