import type { RabeDiff, RabeOrder } from '../../../types'
import { recorded } from '../../diffs'
import { isInside, type RabeItemOf } from '../../model'
import { fit, type Span } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ago, middleEllipsis } from '../format'
import { stable } from '../lists'
import { byConflict, type Touched, touched, worktreeRows } from '../touched'
import { type Drawn, isPress, type Line, type Model, type Size, type View } from '../view'
import { SPLIT_COLUMNS, shownFrom } from './items'
import { beside, fitLine, focusOn, plain } from './lines'

const dim = { fg: C.dim }
const CHANGE = 29

const and = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')

function conflictLines(files: Touched[]): Line[] {
  const conflicts = files.filter(file => file.isConflict)
  const [first] = conflicts
  if (!first) return []
  // a tree only when it is proven to hold the file: git placed it, or an
  // editor's worktree (Claude Code's metadata) contains its path
  const own = first.by.find(editor => editor.tree && isInside(first.path, editor.tree))
  const tree = first.tree?.path ?? own?.tree
  const where = first.tree?.isMain
    ? ' in the main tree'
    : tree
      ? ` in ${tree.split(/[\\/]/).filter(Boolean).at(-1)}`
      : ''
  const more = conflicts.length > 1 ? ` · +${conflicts.length - 1} more` : ''

  return [
    {
      bg: CHIP.failed.bg,
      spans: [
        [' ⚠ conflict ', { fg: C.red }],
        [` ${first.rel}`, { fg: C.bright }],
        [' is edited by '],
        [and(first.by.map(editor => editor.title)), { fg: C.orange }],
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
  const inner = Math.max(2, columns - 2 - Math.min(CHANGE, Math.floor(columns / 3)) - 2)
  const file = Math.ceil(inner * 0.47)

  return { file, by: inner - file }
}

// How the file changed; a shell write is a guess.
function how(file: Touched): string {
  const count = file.edits > 1 ? `${file.edits} changes: ` : ''

  return `${count}${file.hows.join(', ')}`
}

function fileRow(file: Touched, w: Widths, selected: string): Line {
  const isSelected = file.id === selected
  const name = middleEllipsis(file.rel, w.file)
  const gone = 'deleted · '
  return {
    spans: [
      mark(isSelected),
      [' '],
      {
        key: `row:${file.id}`,
        label: name,
        action: file.last.item
          ? { type: 'open', id: file.last.item.id }
          : { type: 'copy', text: file.path, what: 'path' },
        ...(!isSelected && { dim: true }),
      },
      [' '.repeat(w.file - [...name].length)],
      [` ${fit(file.by.map(editor => editor.title).join(', '), w.by)} `, dim],
      ...(file.isDeleted ? [[gone, { fg: C.red }] as Span] : []),
      [how(file)],
    ],
    ...(isSelected && { bg: C.selected }),
  }
}

function fileLines(files: Touched[], w: Widths, selected: string): Line[] {
  const title: Line = {
    spans: [
      [`FILES TOUCHED ${files.length}`, { fg: C.orange }],
      ['  from edits, Codex and shell commands', dim],
    ],
  }
  if (files.length === 0) return [title, { spans: [['  No file changed yet.', dim]] }]

  return [
    title,
    { spans: [[`  ${fit('FILE', w.file)} ${fit('BY', w.by)} CHANGE`, dim]] },
    ...files.map(file => fileRow(file, w, selected)),
  ]
}

function treeLines(model: Model, files: Touched[]): Line[] {
  const { rows, unknown } = worktreeRows(model.items, files, model.worktrees, model.cwd)
  const width = Math.min(34, Math.max(9, ...rows.map(row => row.name.length)))
  const row = (label: string, rest: string): Line => ({
    spans: [['  '], ['⎇', { fg: C.purple }], [` ${fit(label, width)}  `], [rest, dim]],
  })
  const isGit = (model.worktrees?.length ?? 0) > 0
  const empty = isGit ? '  No worktree in use yet.' : '  No agents yet.'

  return [
    {
      spans: [
        [`WORKTREES ${rows.length}`, { fg: C.purple }],
        [
          isGit
            ? '  from git and agent metadata'
            : '  from agent metadata, running agents included',
          dim,
        ],
      ],
    },
    ...rows.map(one => row(one.name, [one.branch, one.who.join(', ')].filter(Boolean).join(' · '))),
    ...(unknown ? [row('n/a', `${unknown} agent${unknown === 1 ? '' : 's'}: tree n/a`)] : []),
    ...(rows.length || unknown ? [] : [{ spans: [[empty, dim]] as Span[] }]),
  ]
}

// What the diff area shows for a file: its latest recorded operation, or why
// there is none. An older operation never stands in for the latest one.
function shownDiff(file: Touched, diffs: Model['diffs']): { diff?: RabeDiff; note?: string } {
  if (file.isDeleted) return { note: 'deleted' }
  const diff = recorded(diffs, file.last.id, file.path, file.at)
  if (!diff) return { note: 'diff n/a: content not recorded' }
  if (diff.note === 'too-large') return { note: 'diff n/a: file too large' }
  if (diff.isEvicted) return { note: 'diff n/a: dropped, too much diff content held' }
  if (diff.note === 'unchanged') return { note: 'no change' }

  return { diff }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// `+12 -3 · 2 hunks · edit by <title>`, or the reason there is no diff.
function summaryOf(file: Touched, diffs: Model['diffs']): string {
  const { diff, note } = shownDiff(file, diffs)
  const head = diff
    ? `+${diff.added} -${diff.removed} · ${plural(diff.hunks, 'hunk')}`
    : (note ?? '')

  return `${head} · edit by ${file.last.title}`
}

function diffLines(file: Touched, diffs: Model['diffs'], now: number): Line[] {
  const { diff, note } = shownDiff(file, diffs)
  const head: Line[] = [
    { spans: [[file.rel, { fg: C.bright }]] },
    { spans: [[`${summaryOf(file, diffs)} · ${ago(now - file.at)}`, dim]] },
    { spans: [] },
  ]
  if (!diff) return [...head, { spans: [[note ?? '', dim]] }]
  const body = diff.lines.map((line): Line => {
    const text = line.replace(/\t/g, '    ')
    const fg = text.startsWith('@@')
      ? C.blue
      : text.startsWith('+')
        ? C.green
        : text.startsWith('-')
          ? C.red
          : undefined

    return { spans: [[text, fg === undefined ? {} : { fg }]] }
  })
  const cutNote: Line[] = diff.isTruncated
    ? [{ spans: [['… cut: the change is longer than the 200 lines kept', dim]] }]
    : []

  return [...head, ...body, ...cutNote]
}

const sshLine = (port: number) => `ssh -L ${port}:localhost:${port} <your-host>`

type Port = { item: RabeItemOf<'shell'>; port: number; at: number }

// The ports of the running shells, one per port. With an order, `held` are
// the ports of the shells that ran with one at the open, in that order, and
// `fresh` the others, in the order they were found. A port whose shell
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
    fresh: byPort(shown.filter(item => !held.some(one => one.port === item.detail.port))).toSorted(
      (a, b) => a.at - b.at,
    ),
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
          action: { type: 'copy', text: sshLine(port), what: 'ssh line' },
          ...(hasHotkey && { hotkey: 'c' }),
          ...(!isSelected && { dim: true }),
        },
      ],
      ...((isSelected || hasHotkey) && { bg: isSelected ? C.selected : CHIP.monitor.bg }),
    },
  ]
}

// The Effects tab: a conflict when two agents edit one file in one tree, the
// files agents touched (each a row that opens the agent that edited it last),
// the worktrees, and the ports of shells, each with its ssh command as a row
// that copies it (`c` the first). While the pane is open the files and ports
// of the open hold their order (`stable`), and the rows found since follow
// them in their section, in the order they were found.
export const effectsView: View = (model, size, sel): Drawn => {
  const { order } = sel
  const all = touched(model.items, model.edits, model.cwd, model.worktrees)
  const files = stable(all, order?.files, byConflict)
  const ports = portsOf(model, order)
  const shown = [...ports.held, ...ports.fresh]
  const ids = [...files.map(file => file.id), ...shown.map(({ port }) => `ssh:${port}`)]
  const selected = ids.includes(sel.selected) ? sel.selected : (ids[0] ?? '')
  const hotkey = ports.held[0]?.port ?? ports.fresh[0]?.port
  const file = files.find(one => one.id === selected)
  const isSplit = size.columns >= SPLIT_COLUMNS && files.length > 0
  const listWidth = isSplit ? Math.min(48, Math.floor(size.columns * 0.42)) : size.columns
  const w = widths(listWidth)
  const portLines: Line[] = [
    {
      spans: [
        [`PORTS ${shown.length}`, { fg: C.blue }],
        ['  found in shell output, may miss some', dim],
      ],
    },
    ...shown.flatMap(port => portRows(port, port.port === hotkey, selected)),
    ...(shown.length ? [] : [{ spans: [['  No open port found.', dim]] as Span[] }]),
  ]
  const lines = focusOn(
    [
      ...conflictLines(byConflict(all)),
      ...fileLines(files, w, selected),
      { spans: [] },
      ...treeLines(model, all),
      { spans: [] },
      ...portLines,
    ],
    selected,
  )

  if (isSplit) return { nodes: split(lines, file, model, size, listWidth), buttons: [] }
  const nodes = lines.map(line => fitLine(line, size.columns))
  if (file) {
    // The last row the pane shows once it follows the focus, so the summary
    // never lands below the window; blank rows fill a short list.
    const row = shownFrom(size, focusRow(lines)) + (size.window?.rows ?? size.rows) - 1
    while (nodes.length < row) nodes.push({ spans: [] })
    nodes.splice(
      row,
      0,
      fitLine({ spans: [[` ${summaryOf(file, model.diffs)}`, dim]] }, size.columns),
    )
  }

  return { nodes, buttons: [] }
}

const focusRow = (lines: Line[]) =>
  lines.findIndex(line => line.spans.some(part => isPress(part) && part.autoFocus))

// The list beside the selected file's diff, drawn from the first row the pane
// shows so the diff stays in view while the focus walks a long list. The diff
// is plain text, so the rows' focus order stays.
function split(
  lines: Line[],
  file: Touched | undefined,
  model: Model,
  size: Size,
  listWidth: number,
): Line[] {
  const right = size.columns - listWidth - 2
  const at = focusRow(lines)
  const detail = file
    ? [
        ...Array.from({ length: shownFrom(size, at) }, () => ({ spans: [] })),
        ...diffLines(file, model.diffs, model.now).map(plain),
      ]
    : []
  const rule: Span[] = [['│', { fg: C.rule }], [' ']]

  return beside(lines, listWidth, rule, detail, right)
}
