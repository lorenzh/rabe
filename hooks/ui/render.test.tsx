import { expect, test } from 'claude-code/testing'

import type { RabeItem, RabeItemOf } from '../model'
import { type Grid, grid, lines, safe, write } from './cells/grid'
import { ALL, babysit, ci, dev, explore, flow, NOW, raster, review } from './fixtures'
import { orderOf } from './lists'
import { type Held, hold, render, type Ui } from './render'
import {
  type Action,
  type Drawn,
  isPress,
  landing,
  layout,
  type Model,
  NO_SELECTION,
  type Piece,
  type Selection,
  type Size,
} from './view'
import { paneView } from './views/pane'

const PROBE = {
  surface: 'terminal',
  plugin: 'rabe',
  component: 'AbovePrompt',
  requestId: 'probe',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 512,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

let shown: Grid = grid(1, 1)

// The engine refuses a whole Raster for one bad cell and names it; each
// refused character is noted and the rest drawn again, so all are listed.
test('the engine takes every character safe lets through in a Raster', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) =>
    render($.ui.resolve(e), e.surface, { nodes: [{ chart: shown }], buttons: [] }, () => {}),
  )
  let rest: string[] = []
  for (let code = 0x21; code <= 0xffff; code++) {
    const ch = String.fromCharCode(code)
    if (safe(ch) === ch) rest.push(ch)
  }
  expect(rest.length).toBeGreaterThan(1000)
  const refused: string[] = []
  for (;;) {
    shown = grid(512, Math.ceil(rest.length / 512))
    rest.forEach((ch, i) => {
      write(shown, i % 512, Math.floor(i / 512), ch)
    })
    try {
      const ui = await $.ui.mount(PROBE as never)
      await ui.unmount()
      break
    } catch (error) {
      const code = /holds U\+([0-9A-F]+)/.exec(String(error))?.[1]
      if (!code) throw error
      refused.push(code)
      rest = rest.filter(ch => ch !== String.fromCharCode(Number.parseInt(code, 16)))
    }
  }
  expect(refused).toEqual([])
})

// The focus ring follows a Button's index, so while the pane is open the
// focusable keys it draws may only grow at the end (`hold`).
const tag = (type: string) => (props: Record<string, unknown>) => ({ type, props })
const UI = {
  Box: tag('Box'),
  Text: tag('Text'),
  Button: tag('Button'),
  Input: tag('Input'),
  Raster: tag('Raster'),
} as unknown as Ui

type Element = { type: string; props: Record<string, unknown> }

function elements(one: unknown): Element[] {
  if (Array.isArray(one)) return one.flatMap(elements)
  if (!one || typeof one !== 'object' || !('type' in one)) return []
  const element = one as Element
  if (element.type === 'Button' || element.type === 'Input') return [element]

  return elements(element.props.children)
}

const SIZE: Size = { columns: 80, rows: 30, surface: 'terminal', hasInput: true }
const OPEN: Selection = { ...NO_SELECTION, isFocused: true }

type Step = { keys: string[]; held: Held[]; tree: Element[]; acts: Action[]; list: Piece[] }

function draw(model: Model, size: Size, sel: Selection, before?: Held[]): Step {
  const acts: Action[] = []
  const { list, held } = hold(layout(paneView(model, size, sel)), before)
  const tree = elements(render(UI, size.surface, list, action => acts.push(action)))

  return { keys: tree.map(one => String(one.props.key)), held, tree, acts, list }
}

// What a press on each focusable element drawn does; an Input's with `text`.
const actionsOf = (list: Piece[], text = ''): [string, Action][] =>
  list.flatMap((piece): [string, Action][] =>
    'spans' in piece
      ? piece.spans.filter(isPress).map(one => [one.key, one.action])
      : 'button' in piece
        ? [[piece.button.key, piece.button.action]]
        : 'input' in piece
          ? [[piece.input.key, piece.input.action(text)]]
          : [],
  )

// The person's own change of the view, as `act` in pane.tsx writes it.
function apply(sel: Selection, action: Action): void {
  if (action.type === 'tab') sel.tab = action.tab
  if (action.type === 'query') sel.query = action.text
  if (action.type === 'fold') {
    const { group } = action
    sel.folded = sel.folded.includes(group)
      ? sel.folded.filter(one => one !== group)
      : [...sel.folded, group]
  }
  if (action.type === 'open') {
    const id = action.id || sel.open
    if (id) Object.assign(sel, { selected: id, tab: 'items' })
    sel.open = action.id
  }
}

const model = (items: RabeItem[]): Model => ({ items, turns: {}, lines: {}, now: NOW })

const shell = (id: string, port?: number, at = NOW): RabeItem =>
  ({
    ...dev,
    id: `shell:${id}`,
    title: `serve ${id}`,
    detail: { command: `serve ${id}`, taskId: id, ...(port && { port, portAt: at }) },
  }) as RabeItem

const agentOf = (id: string, extra: Partial<RabeItemOf<'agent'>['detail']> = {}): RabeItem =>
  ({
    ...explore,
    id: `agent:${id}`,
    title: `agent ${id}`,
    detail: { agentId: id, cwd: '/repo', ...extra },
  }) as RabeItem

test('rows found after the open do not move the controls', () => {
  const items = [shell('a')]
  const sel = { ...OPEN, selected: 'shell:a', order: orderOf(items) }
  const first = draw(model(items), SIZE, sel)
  const later = draw(model([...items, shell('b')]), SIZE, sel, first.held)
  expect(later.keys.slice(0, first.keys.length)).toEqual(first.keys)
  expect(later.keys.indexOf('stop')).toBe(first.keys.indexOf('stop'))
  expect(later.keys.indexOf('stop')).toBeLessThan(later.keys.indexOf('row:shell:a'))
  const open = { ...sel, open: flow.id, order: orderOf([flow]) }
  const run = draw(model([flow]), SIZE, open)
  const more = draw(model([flow, agentOf('w9', { workflowPhase: 'Review' })]), SIZE, open, run.held)
  expect(more.keys.indexOf('back')).toBe(run.keys.indexOf('back'))
  expect(more.keys.slice(0, run.keys.length)).toEqual(run.keys)
})

test('a phase found late does not reorder the agent rows of a workflow', () => {
  const runOf = {
    ...flow,
    detail: { runId: 'wf1', taskId: 'wf_task', phases: ['Review'] },
  } as RabeItem
  const a = { ...agentOf('wa'), parentId: flow.id, startedAt: NOW - 9000 }
  const b = { ...agentOf('wb'), parentId: flow.id, startedAt: NOW - 8000 }
  const items = [runOf, a, b]
  const sel = { ...OPEN, open: flow.id, selected: a.id, order: orderOf(items) }
  const first = draw(model(items), SIZE, sel)
  const phased = { ...b, detail: { ...b.detail, workflowPhase: 'Review' } } as RabeItem
  const later = draw(model([runOf, a, phased]), SIZE, sel, first.held)
  expect(
    rowKeysOf(paneView(model([runOf, a, phased]), SIZE, sel)).indexOf(`row:${b.id}`),
  ).toBeLessThan(rowKeysOf(paneView(model([runOf, a, phased]), SIZE, sel)).indexOf(`row:${a.id}`))
  expect(later.keys.slice(0, first.keys.length)).toEqual(first.keys)
  expect(later.keys.indexOf(`row:${a.id}`)).toBeLessThan(later.keys.indexOf(`row:${b.id}`))
})

test('an edit pruned from the history leaves its held Effects row as an inert slot', () => {
  const edits = (list: string[]) => list.map((path, i) => ({ path, at: NOW + i }))
  const b99 = Array.from({ length: 99 }, () => '/repo/b.ts')
  const editor = agentOf('ed', { edits: edits(['/repo/a.ts', ...b99]) })
  const items = [editor, shell('p1', 5173), shell('p2', 3000)]
  const sel = { ...OPEN, tab: 'effects' as const, selected: 'ssh:5173', order: orderOf(items) }
  const first = draw(model(items), SIZE, sel)
  const pruned = agentOf('ed', { edits: edits([...b99, '/repo/b.ts']) })
  const later = draw(model([pruned, ...items.slice(1)]), SIZE, sel, first.held)
  expect(later.keys).toEqual(first.keys)
  const slot = later.tree.find(one => one.props.key === 'row:file:/repo/a.ts')
  expect(slot?.props).toMatchObject({ label: 'a.ts', dimColor: true })
  ;(slot?.props.onPress as (e: unknown) => void)({ surface: 'terminal' })
  expect(later.acts).toEqual([])
})

test('a gone slot follows the element before it and reads gone first, never under the next heading', () => {
  const items = [shell('p1', 5173), shell('p2', 3000), shell('p3', 4000)]
  const sel = { ...OPEN, tab: 'effects' as const, selected: 'ssh:5173', order: orderOf(items) }
  const first = draw(model(items), SIZE, sel)
  const later = draw(model([items[0], items[2]] as RabeItem[]), SIZE, sel, first.held)
  expect(later.keys).toEqual(first.keys)
  const text = (piece: Piece | undefined) =>
    piece && 'spans' in piece
      ? piece.spans.map(one => (isPress(one) ? one.label : one[0])).join('')
      : ''
  const at = later.list.findIndex(piece => text(piece).includes('ssh -L 3000'))
  expect(text(later.list[at - 1])).toContain('ssh -L 5173')
  expect(text(later.list[at])).toBe(' gone ssh -L 3000:localhost:3000 <your-host>')
  expect(text(later.list[at + 1])).toContain(':4000')
})

test('all four tabs stay at every width, the underline under the active one', () => {
  const tabs = ['tab-items', 'tab-cost', 'tab-effects', 'tab-timeline']
  const ten = Array.from({ length: 10 }, (_, i) => shell(`t${i}`))
  for (let columns = 12; columns <= 200; columns++) {
    for (const items of [ten.slice(0, 9), ten]) {
      const drawn = paneView(model(items), { ...SIZE, columns }, { ...OPEN, tab: 'timeline' })
      expect(rowKeysOf(drawn).slice(0, 4)).toEqual(tabs)
    }
  }
  for (const columns of [38, 80, 140]) {
    const drawn = paneView(model(ten), { ...SIZE, columns }, { ...OPEN, tab: 'cost' })
    const [tabRow = '', rule = ''] = lines(raster(drawn))
    const from = tabRow.indexOf('2: C')
    expect(from).toBeGreaterThan(0)
    expect(rule.indexOf('━')).toBe(from)
    expect(rule.lastIndexOf('━') + 1).toBe(tabRow.indexOf(' ', from + 3))
  }
})

const rowKeysOf = (drawn: Drawn) =>
  drawn.nodes.flatMap(node => ('spans' in node ? node.spans.filter(isPress).map(p => p.key) : []))

// A seeded random walk over what changes while the pane is open.
function random(seed: number) {
  let s = seed
  return (n: number) => {
    s = (s * 1103515245 + 12345) % 2 ** 31
    return Math.floor((s / 2 ** 31) * n)
  }
}

const WIDTHS = [24, 38, 60, 80, 89, 90, 120, 160]
const PHASES = ['Review', 'Verify', 'Report', undefined]
const PATHS = ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts', '/repo/d.ts']

function change(items: RabeItem[], pick: (n: number) => number, n: number): RabeItem[] {
  const one = items[pick(Math.max(1, items.length))]
  const with_ = (next: RabeItem) => items.map(item => (item === one ? next : item))
  switch (pick(7)) {
    case 0: {
      const kind = pick(4)
      if (kind === 0) return [...items, agentOf(`n${n}`)]
      if (kind === 1) return [...items, shell(`n${n}`, pick(2) ? 4000 + pick(5) : undefined)]
      if (kind === 2) return [...items, { ...ci, id: `monitor:n${n}`, title: `watch ${n}` }]
      const phase = PHASES[pick(PHASES.length)]
      return [...items, { ...agentOf(`w${n}`, { workflowPhase: phase }), parentId: flow.id }]
    }
    case 1:
      return items.filter(item => item !== one)
    case 2:
      return one?.status === 'running'
        ? with_({ ...one, status: pick(2) ? 'done' : 'failed', endedAt: NOW + n })
        : items
    case 3:
      return one?.kind === 'agent'
        ? with_({ ...one, detail: { ...one.detail, workflowPhase: PHASES[pick(PHASES.length)] } })
        : items
    case 4: {
      if (one?.kind !== 'agent') return items
      const edits = [...(one.detail.edits ?? []), { path: PATHS[pick(4)] ?? '', at: NOW + n }]
      return with_({ ...one, detail: { ...one.detail, edits: edits.slice(pick(3) ? 0 : 1) } })
    }
    case 5:
      return one?.kind === 'shell' && one.detail.port === undefined
        ? with_({ ...one, detail: { ...one.detail, port: 3000 + pick(4), portAt: NOW + n } })
        : items
    default:
      return items
  }
}

const SCOPES: Partial<Selection>[] = [
  { tab: 'items' },
  { tab: 'cost' },
  { tab: 'effects' },
  { tab: 'timeline' },
  { open: flow.id },
  { open: explore.id },
  { open: dev.id },
  { open: babysit.id },
  { open: review.id },
]

// Defense in depth for the ring that keeps its index: the element after the
// tabs (the first row, `b: back` or the search) is never a stop in any view.
test('the first element after the tabs never stops or deletes', () => {
  const items = ALL.map(item => ({ ...item, status: 'running' as const }))
  for (const scope of SCOPES) {
    const sel = { ...OPEN, selected: dev.id, order: orderOf(items), ...scope }
    const { list } = draw(model(items), SIZE, sel)
    const [key, action] = actionsOf(list)[4] ?? []
    expect([
      JSON.stringify(scope),
      key,
      action?.type === 'stop' || action?.type === 'delete',
    ]).toEqual([JSON.stringify(scope), key, false])
  }
})

test('whatever changes while the pane is open, the focusable keys only grow at the end', () => {
  const start = ALL.map(item =>
    item.id === explore.id ? agentOf('a1', { edits: [{ path: PATHS[0] ?? '', at: NOW }] }) : item,
  )
  for (const surface of ['terminal', 'desktop'] as const) {
    SCOPES.forEach((scope, s) => {
      const pick = random(s + 1)
      let items = start
      const sel: Selection = { ...OPEN, order: orderOf(items), ...scope }
      let size: Size = { ...SIZE, surface }
      let last = draw(model(items), size, sel)
      for (let n = 0; n < 80; n++) {
        const what = pick(5)
        if (what === 4) {
          // The view changes: its hold starts anew, and the ring, which keeps
          // its index, is moved; where it lands must not stop or delete.
          const text = ['', 'serve', 'agent', 'zz'][pick(4)] ?? ''
          const switches = actionsOf(last.list, text).filter(([, action]) =>
            ['tab', 'open', 'fold', 'query'].includes(action.type),
          )
          const [, action] = switches[pick(switches.length)] ?? []
          if (!action) continue
          const was = sel.open
          apply(sel, action)
          last = draw(model(items), size, sel)
          const actions = new Map(actionsOf(last.list))
          const keys = landing(action, was)
          const landed = keys.filter(key => actions.has(key)).at(-1)
          const shown = `${surface} ${JSON.stringify(scope)} step ${n} ${JSON.stringify(action)}`
          expect([shown, keys[0] && actions.has(keys[0])]).toEqual([shown, true])
          const type = actions.get(landed ?? '')?.type ?? 'none'
          expect([shown, type === 'stop' || type === 'delete']).toEqual([shown, false])
          continue
        }
        if (what === 0) size = { ...size, columns: WIDTHS[pick(WIDTHS.length)] ?? 80 }
        else if (what === 1) {
          const rows = last.keys.filter(key => key.startsWith('row:'))
          sel.selected = rows[pick(Math.max(1, rows.length))]?.slice(4) ?? ''
        } else items = change(items, pick, n)
        const next = draw(model(items), size, sel, last.held)
        const shown = `${surface} ${JSON.stringify(scope)} step ${n}`
        expect([shown, next.keys.slice(0, last.keys.length)]).toEqual([shown, last.keys])
        last = next
      }
    })
  }
})
