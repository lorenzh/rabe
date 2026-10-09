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

// The rows of `shown`, the files that fit, and a count of the rest.
function fileLines(files: Touched[], shown: Touched[], width: number, selected: string): Line[] {
  const head: Line = {
    spans: [
      [`FILES TOUCHED ${files.length}`, { fg: C.orange }],
      ['  from agent tool calls', dim],
    ],
  }
  if (files.length === 0) return [head, { spans: [['  No agent edited a file yet.', dim]] }]
  const inner = Math.max(2, width - 2 - CHANGE - 2)
  const fileWidth = Math.ceil(inner / 2)
  const byWidth = inner - fileWidth
  const rows: Line[] = shown.map(file => {
    const isSelected = file.id === selected
    const name = fit(file.rel, fileWidth).trimEnd()
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
        [' '.repeat(fileWidth - [...name].length)],
        [` ${fit(file.by.map(agent => agent.title).join(', '), byWidth)} `, dim],
        [`${file.edits} edit${file.edits === 1 ? '' : 's'}`],
      ],
      ...(isSelected && { bg: C.selected }),
    }
  })
  const rest = files.length - shown.length

  return [
    head,
    { spans: [[`  ${fit('FILE', fileWidth)} ${fit('BY', byWidth)} CHANGE`, dim]] },
    ...rows,
    ...(rest ? [{ spans: [[`  … ${rest} more`, dim]] } as Line] : []),
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

// The Effects tab: a conflict when two agents edit one file in one tree, the
// files agents touched (each a row that opens the agent that edited it last),
// the worktrees, and the ports of running shells, each with its ssh command
// as a row that copies it (`c` the first). The files hold their order while
// the pane is open (`stable`). The file list is cut to leave room for the
// rest; what still does not fit makes the pane scroll, so no row is lost.
export const effectsView: View = (model, size, sel): Drawn => {
  const files = stable(touched(model.items), sel.order?.files, byConflict)
  const ports = model.items.flatMap(item =>
    item.kind === 'shell' && item.status === 'running' && item.detail.port !== undefined
      ? [{ item, port: item.detail.port }]
      : [],
  )
  const top = conflictLines(files)
  const trees = treeLines(model)
  const bottom = 1 + trees.length + 1 + 1 + Math.max(1, ports.length * 2)
  const room = Math.max(1, size.rows - top.length - bottom - 2)
  const shown = files.length > room ? files.slice(0, Math.max(0, room - 1)) : files
  const ids = [...shown.map(file => file.id), ...ports.map(({ port }) => `ssh:${port}`)]
  const selected = ids.includes(sel.selected) ? sel.selected : (ids[0] ?? '')
  const portLines: Line[] = [
    {
      spans: [
        [`PORTS ${ports.length}`, { fg: C.blue }],
        ['  found in shell output, may miss some', dim],
      ],
    },
    ...ports.flatMap(({ item, port }, i): Line[] => {
      const isSelected = selected === `ssh:${port}`
      return [
        { spans: [['  '], [`:${port}`, { fg: C.blue }], [`  ${item.detail.command}`]] },
        {
          spans: [
            mark(isSelected),
            // The engine draws a plain Button's hotkey as `c: ` before its label.
            [i === 0 ? '  ' : '     '],
            {
              key: `row:ssh:${port}`,
              label: sshLine(port),
              action: { type: 'copy', text: sshLine(port) },
              ...(i === 0 && { hotkey: 'c' }),
              ...(!isSelected && { dim: true }),
            },
          ],
          ...((isSelected || i === 0) && { bg: isSelected ? C.selected : CHIP.monitor.bg }),
        },
      ]
    }),
    ...(ports.length ? [] : [{ spans: [['  No open port found.', dim]] as Span[] }]),
  ]
  const lines = focusOn(
    [
      ...top,
      ...fileLines(files, shown, size.columns, selected),
      { spans: [] },
      ...trees,
      { spans: [] },
      ...portLines,
    ],
    selected,
  )

  return { nodes: lines.map(line => fitLine(line, size.columns)), buttons: [] }
}
