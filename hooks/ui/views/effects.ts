import type { RabeOrder } from '../../../types'
import type { RabeItemOf } from '../../model'
import { fit, type Span } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { byConflict, stable, type Touched, touched, worktrees } from '../lists'
import type { Drawn, Line, Model, View } from '../view'
import { fitLine, focusOn } from './lines'

const dim = { fg: C.dim }
const CHANGE = 8

const and = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

function conflictLines(files: Touched[]): Line[] {
  const conflicts = files.filter(file => file.by.length > 1)
  const [first] = conflicts
  if (!first) return []
  const tree = first.by[0]?.detail.worktreePath
  const where = tree ? ` in ${tree.split('/').filter(Boolean).at(-1)}` : ' in the main tree'
  const more = conflicts.length > 1 ? ` · +${conflicts.length - 1} more` : ''

  return [
    {
      bg: CHIP.failed.bg,
      spans: [
        [' ⚠ conflict ', { fg: C.red }],
        [` ${first.rel}`, { fg: C.bright }],
        [' is edited by '],
        [and(first.by.map(agent => agent.title)), { fg: C.orange }],
        [`${where}${more}`, dim],
      ],
    },
    { spans: [] },
  ]
}

// A selectable row's start: the orange marker when selected, else a space.
const mark = (isSelected: boolean): Span => [isSelected ? '▌' : ' ', { fg: C.orange }]

type Widths = { file: number; by: number }

function widths(columns: number): Widths {
  const inner = Math.max(2, columns - 2 - CHANGE - 2)
  const file = Math.ceil(inner / 2)

  return { file, by: inner - file }
}

function fileRow(file: Touched, w: Widths, selected: string): Line {
  const isSelected = file.id === selected
  const name = fit(file.rel, w.file).trimEnd()
  return {
    spans: [
      mark(isSelected),
      [' '],
      {
        key: `row:${file.id}`,
        label: name,
        action: { type: 'open', id: file.last.id },
        ...(!isSelected && { dim: true }),
      },
      [' '.repeat(w.file - [...name].length)],
      [` ${fit(file.by.map(agent => agent.title).join(', '), w.by)} `, dim],
      [`${file.edits} edit${file.edits === 1 ? '' : 's'}`],
    ],
    ...(isSelected && { bg: C.selected }),
  }
}

function fileLines(files: Touched[], w: Widths, selected: string): Line[] {
  const head: Line = {
    spans: [
      [`FILES TOUCHED ${files.length}`, { fg: C.orange }],
      ['  from agent tool calls', dim],
    ],
  }
  if (files.length === 0) return [head, { spans: [['  No agent edited a file yet.', dim]] }]

  return [
    head,
    { spans: [[`  ${fit('FILE', w.file)} ${fit('BY', w.by)} CHANGE`, dim]] },
    ...files.map(file => fileRow(file, w, selected)),
  ]
}

function treeLines(model: Model): Line[] {
  const trees = worktrees(model.items)
  const agents = model.items.flatMap(item => (item.kind === 'agent' ? [item] : []))
  const plain = agents.filter(agent => !agent.detail.worktreePath)
  const main = plain.filter(agent => agent.detail.cwd)
  const unknown = plain.length - main.length
  const width = Math.min(34, Math.max(9, ...trees.map(tree => tree.name.length)))
  const row = (label: string, rest: string): Line => ({
    spans: [['  '], ['⎇', { fg: C.purple }], [` ${fit(label, width)}  `], [rest, dim]],
  })

  return [
    {
      spans: [
        [`WORKTREES ${trees.length}`, { fg: C.purple }],
        ['  from agent metadata, running agents included', dim],
      ],
    },
    ...trees.map(tree =>
      row(tree.name, `${tree.branch} · ${tree.items.map(item => item.title).join(', ')}`),
    ),
    ...(main.length ? [row('main tree', main.map(agent => agent.title).join(', '))] : []),
    ...(unknown ? [row('n/a', `${unknown} agent${unknown === 1 ? '' : 's'}: tree n/a`)] : []),
    ...(agents.length ? [] : [{ spans: [['  No agents yet.', dim]] as Span[] }]),
  ]
}

const sshLine = (port: number) => `ssh -L ${port}:localhost:${port} <your-host>`

type Port = { item: RabeItemOf<'shell'>; port: number; at: number }

// The ports of the running shells, one per port. With an order, `held` are
// the ports of the shells that ran with one at the open, in that order, and
// `fresh` the others, each with the time it was found. A port whose shell
// ended leaves; the renderer keeps its row's place (see `hold`).
function portsOf(model: Model, order?: RabeOrder): { held: Port[]; fresh: Port[] } {
  const shown = model.items.flatMap(item =>
    item.kind === 'shell' && item.detail.port !== undefined && item.status === 'running'
      ? [item]
      : [],
  )
  const byPort = (list: typeof shown): Port[] =>
    [...new Set(list.map(item => item.detail.port as number))].map(port => {
      const same = shown.filter(one => one.detail.port === port)
      const at = Math.min(...same.map(one => one.detail.portAt ?? one.startedAt ?? one.seenAt))
      return { item: same[0] as (typeof same)[0], port, at }
    })
  if (!order) return { held: byPort(shown), fresh: [] }
  const held = byPort(
    stable(
      shown.filter(item => order.ports?.includes(item.id)),
      order.ports,
      list => list,
    ),
  )

  return {
    held,
    fresh: byPort(shown.filter(item => !held.some(one => one.port === item.detail.port))),
  }
}

function portRows({ item, port }: Port, hasHotkey: boolean, selected: string): Line[] {
  const isSelected = selected === `ssh:${port}`
  return [
    {
      spans: [['  '], [`:${port}`, { fg: C.blue }], [`  ${item.detail.command}`]],
    },
    {
      spans: [
        mark(isSelected),
        // The engine draws a plain Button's hotkey as `c: ` before its label.
        [hasHotkey ? '  ' : '     '],
        {
          key: `row:ssh:${port}`,
          label: sshLine(port),
          action: { type: 'copy', text: sshLine(port) },
          ...(hasHotkey && { hotkey: 'c' }),
          ...(!isSelected && { dim: true }),
        },
      ],
      ...((isSelected || hasHotkey) && { bg: isSelected ? C.selected : CHIP.monitor.bg }),
    },
  ]
}

type Found = { at: number } & ({ file: Touched } | { port: Port })

// The Effects tab: a conflict when two agents edit one file in one tree, the
// files agents touched (each a row that opens the agent that edited it last),
// the worktrees, and the ports of shells, each with its ssh command as a row
// that copies it (`c` the first). While the pane is open the files and ports
// of the open hold their order (`stable`) and the rows found since go to NEW,
// the end, in the order they were found: no row above another comes or goes.
export const effectsView: View = (model, size, sel): Drawn => {
  const { order } = sel
  const all = touched(model.items)
  const files = stable(
    order ? all.filter(file => order.files?.includes(file.id)) : all,
    order?.files,
    byConflict,
  )
  const ports = portsOf(model, order)
  const found: Found[] = [
    ...all.filter(file => order && !files.includes(file)).map(file => ({ at: file.first, file })),
    ...ports.fresh.map(port => ({ at: port.at, port })),
  ].toSorted((a, b) => a.at - b.at)
  const ids = [
    ...files.map(file => file.id),
    ...ports.held.map(({ port }) => `ssh:${port}`),
    ...found.map(one => ('file' in one ? one.file.id : `ssh:${one.port.port}`)),
  ]
  const selected = ids.includes(sel.selected) ? sel.selected : (ids[0] ?? '')
  const hotkey = ports.held[0]?.port ?? ports.fresh[0]?.port
  const w = widths(size.columns)
  const portLines: Line[] = [
    {
      spans: [
        [`PORTS ${ports.held.length}`, { fg: C.blue }],
        ['  found in shell output, may miss some', dim],
      ],
    },
    ...ports.held.flatMap(port => portRows(port, port.port === hotkey, selected)),
    ...(ports.held.length ? [] : [{ spans: [['  No open port found.', dim]] as Span[] }]),
  ]
  const newLines: Line[] = found.length
    ? [
        { spans: [] },
        {
          spans: [
            [`NEW ${found.length}`, { fg: C.bright }],
            ['  found since Rabe opened', dim],
          ],
        },
        ...found.flatMap(one =>
          'file' in one
            ? [fileRow(one.file, w, selected)]
            : portRows(one.port, one.port.port === hotkey, selected),
        ),
      ]
    : []
  const lines = focusOn(
    [
      ...conflictLines(byConflict(all)),
      ...fileLines(files, w, selected),
      { spans: [] },
      ...treeLines(model),
      { spans: [] },
      ...portLines,
      ...newLines,
    ],
    selected,
  )

  return { nodes: lines.map(line => fitLine(line, size.columns)), buttons: [] }
}
