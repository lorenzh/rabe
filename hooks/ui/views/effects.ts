import type { RabeItemOf } from '../../model'
import { fit, grid, type Span } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { worktrees } from '../lists'
import type { Drawn, Model, View, ViewButton } from '../view'
import { draw, type Line } from './lines'

const dim = { fg: C.dim }
const CHANGE = 8

type Agent = RabeItemOf<'agent'>
type Touched = { path: string; rel: string; by: Agent[]; edits: number; at: number }

function relative(path: string, agent: Agent): string {
  const root = agent.detail.worktreePath ?? agent.detail.cwd

  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

// The files agents edited, from the Edit and Write calls the engine ran for
// them (a turn's tool calls are only asked for and may be refused).
// Editors are listed in the order they first edited; conflicts come first.
export function touched(model: Model): Touched[] {
  const edits = model.items
    .flatMap(item => (item.kind === 'agent' ? [item] : []))
    .flatMap(agent => (agent.detail.edits ?? []).map(edit => ({ agent, ...edit })))
    .toSorted((a, b) => a.at - b.at)
  const files = new Map<string, Touched>()
  for (const { agent, path, at } of edits) {
    const file = files.get(path) ?? { path, rel: relative(path, agent), by: [], edits: 0, at }
    if (!file.by.includes(agent)) file.by.push(agent)
    file.edits += 1
    file.at = at
    files.set(path, file)
  }

  return [...files.values()].toSorted(
    (a, b) => Number(b.by.length > 1) - Number(a.by.length > 1) || b.at - a.at,
  )
}

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

function fileLines(files: Touched[], width: number, room: number): Line[] {
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
  const shown = files.length > room ? files.slice(0, Math.max(0, room - 1)) : files
  const rows: Line[] = shown.map(file => ({
    spans: [
      ['  '],
      [fit(file.rel, fileWidth), file.by.length > 1 ? { fg: C.yellow } : {}],
      [` ${fit(file.by.map(agent => agent.title).join(', '), byWidth)} `, dim],
      [`${file.edits} edit${file.edits === 1 ? '' : 's'}`],
    ],
  }))
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
// files agents touched, the worktrees, and the ports of running shells with
// the ssh command to reach them; a Button copies each command.
export const effectsView: View = (model, size): Drawn => {
  const g = grid(size.columns, size.rows)
  const files = touched(model)
  const ports = model.items.flatMap(item =>
    item.kind === 'shell' && item.status === 'running' && item.detail.port !== undefined
      ? [{ item, port: item.detail.port }]
      : [],
  )
  const portLines: Line[] = [
    {
      spans: [
        [`PORTS ${ports.length}`, { fg: C.blue }],
        ['  found in shell output, may miss some', dim],
      ],
    },
    ...ports.flatMap(({ item, port }, i): Line[] => [
      { spans: [['  '], [`:${port}`, { fg: C.blue }], [`  ${item.detail.command}`]] },
      {
        spans: [[`      ${sshLine(port)}`]],
        ...(i === 0 && { bg: CHIP.monitor.bg, right: [['c copies ', dim]] as Span[] }),
      },
    ]),
    ...(ports.length ? [] : [{ spans: [['  No open port found.', dim]] as Span[] }]),
  ]
  const top = conflictLines(files)
  const bottom = [{ spans: [] }, ...treeLines(model), { spans: [] }, ...portLines]
  const room = Math.max(1, size.rows - top.length - bottom.length - 2)
  const lines = [...top, ...fileLines(files, size.columns, room), ...bottom]
  draw(g, 0, 0, size.columns, lines.slice(0, size.rows))
  const buttons: ViewButton[] = ports.map(({ port }, i) => ({
    key: `port-${port}`,
    label: i === 0 ? `c: copy ssh :${port}` : `copy ssh :${port}`,
    ...(i === 0 && { hotkey: 'c' }),
    action: { type: 'copy', text: sshLine(port) },
  }))

  return { grid: g, buttons }
}
