import type { RabeEdit, RabeWorktree } from '../../types'
import { isAbsolute, isInside, pathKey, type RabeItem } from '../model'

// Who changed files: an agent, a Codex job or the main session (no item).
type Editor = { id: string; title: string; tree?: string; root?: string; item?: RabeItem }

export type Touched = {
  id: string
  path: string
  rel: string
  by: Editor[]
  last: Editor
  edits: number
  at: number
  first: number
  hows: string[]
  isDeleted: boolean
  isConflict: boolean
  // The git worktree that holds the file; absent without git or outside them.
  tree?: RabeWorktree
}

// The worktree whose path is the longest prefix of `path`.
export function treeOf(path: string, trees: RabeWorktree[]): RabeWorktree | undefined {
  return trees
    .filter(tree => isInside(path, tree.path))
    .reduce<RabeWorktree | undefined>(
      (best, tree) => (best && best.path.length >= tree.path.length ? best : tree),
      undefined,
    )
}

function relative(path: string, root?: string): string {
  const base = root?.replace(/[\\/]+$/, '')
  return base && isInside(path, base) && pathKey(path) !== pathKey(base)
    ? path.slice(base.length + 1)
    : path
}

function howOf(edit: RabeEdit): string {
  if (edit.via === 'shell') return 'via shell'
  if (edit.via === 'codex') return `codex ${edit.change ?? 'update'}`

  return edit.via ?? 'edit'
}

type Edits = { editor: Editor; edits: RabeEdit[] }

function editorsOf(items: RabeItem[], main: RabeEdit[], cwd?: string): Edits[] {
  const own = items.flatMap((item): Edits[] => {
    if (item.kind === 'agent') {
      const { worktreePath, cwd: root } = item.detail
      const editor = {
        id: item.id,
        title: item.title,
        tree: worktreePath,
        root: worktreePath ?? root,
        item,
      }
      return [{ editor, edits: item.detail.edits ?? [] }]
    }
    if (item.kind === 'codex') {
      const editor = { id: item.id, title: item.title, root: item.detail.workspaceRoot, item }
      return [{ editor, edits: item.detail.edits ?? [] }]
    }
    return []
  })

  return [...own, { editor: { id: 'main', title: 'main session', root: cwd }, edits: main }]
}

// The files changed by agents (Edit and Write calls the engine ran, not the
// calls a turn asks for), Codex jobs (file changes) and the main session, and
// the files shell commands of each wrote (a guess), in the order they were
// first changed. `by` lists the editors in the order they first changed it,
// `last` the latest one, `hows` how, `first` and `at` the first and the latest
// change times. Two editors of one absolute path are a conflict; a relative
// path is none. With git's worktrees (`trees`) each file is shown relative to
// the worktree that holds it; else relative to its first editor's folder.
export function touched(
  items: RabeItem[],
  main: RabeEdit[] = [],
  cwd?: string,
  trees?: RabeWorktree[],
): Touched[] {
  const edits = editorsOf(items, main, cwd)
    .flatMap(({ editor, edits: list }) => list.map(edit => ({ editor, edit })))
    .toSorted((a, b) => a.edit.at - b.edit.at)
  const files = new Map<string, Touched>()
  for (const { editor, edit } of edits) {
    const { path, at } = edit
    const tree = trees && treeOf(path, trees)
    const key = pathKey(path)
    const file = files.get(key) ?? {
      id: `file:${path}`,
      path,
      rel: relative(path, tree ? tree.path : editor.root),
      ...(tree && { tree }),
      by: [],
      last: editor,
      edits: 0,
      at,
      first: at,
      hows: [],
      isDeleted: false,
      isConflict: false,
    }
    if (!file.by.includes(editor)) file.by.push(editor)
    const how = howOf(edit)
    if (!file.hows.includes(how)) file.hows.push(how)
    file.last = editor
    file.edits += 1
    file.at = at
    file.isDeleted = edit.change === 'delete'
    file.isConflict = file.by.length > 1 && isAbsolute(path)
    files.set(key, file)
  }

  return [...files.values()]
}

// Conflicts (two editors) first, then the latest edit first.
export function byConflict(files: Touched[]): Touched[] {
  return files.toSorted((a, b) => Number(b.isConflict) - Number(a.isConflict) || b.at - a.at)
}

type TreeRow = { name: string; branch?: string; who: string[] }

const treeName = (path: string) =>
  path.includes('/.claude/')
    ? path.slice(path.indexOf('.claude/'))
    : (path.split(/[\\/]/).filter(Boolean).at(-1) ?? path)

// The WORKTREES section: one row per worktree in use, each with who works
// there. With git (`trees`) a worktree is in use when a file in it changed
// (its editors, the main session included) or an agent runs in it (its
// `worktreePath`, else its `cwd` when it changed no file in a worktree); an
// agent's worktree git does not list keeps its row from the agent's metadata.
// Without git, rows come from agent metadata alone: each agent worktree, then
// the main tree for agents whose `cwd` is the session's (`cwd`). `unknown`
// counts agents whose tree Rabe cannot tell.
export function worktreeRows(
  items: RabeItem[],
  files: Touched[],
  trees?: RabeWorktree[],
  cwd?: string,
): { rows: TreeRow[]; unknown: number } {
  const known = trees?.length ? trees : undefined
  const rows = new Map<string, TreeRow>()
  const add = (key: string, row: Omit<TreeRow, 'who'>, title: string) => {
    const one = rows.get(key) ?? { ...row, who: [] }
    if (!one.who.includes(title)) one.who.push(title)
    rows.set(key, one)
  }
  const gitRow = (tree: RabeWorktree) => ({
    name: tree.isMain ? 'main tree' : treeName(tree.path),
    branch: tree.branch ?? (tree.isDetached ? 'detached' : 'n/a'),
  })
  for (const file of known ? files : []) {
    if (!file.tree) continue
    for (const editor of file.by) add(file.tree.path, gitRow(file.tree), editor.title)
  }
  let unknown = 0
  const agents = items.flatMap(item => (item.kind === 'agent' ? [item] : []))
  for (const agent of agents) {
    const { worktreePath, worktreeBranch, cwd: at } = agent.detail
    const own = worktreePath
      ? known?.find(tree => pathKey(tree.path) === pathKey(worktreePath))
      : undefined
    if (own) add(own.path, gitRow(own), agent.title)
    else if (worktreePath) {
      const row = { name: treeName(worktreePath), branch: worktreeBranch ?? 'n/a' }
      add(`agent ${worktreePath}`, row, agent.title)
    } else if (known && files.some(file => file.tree && file.by.some(one => one.id === agent.id))) {
    } else if (!at) unknown += 1
    else if (!known) {
      if (cwd && pathKey(at) === pathKey(cwd)) add('main', { name: 'main tree' }, agent.title)
      else unknown += 1
    } else {
      const tree = treeOf(at, known)
      if (tree) add(tree.path, gitRow(tree), agent.title)
      else unknown += 1
    }
  }
  const order = [...(known ?? []).map(tree => tree.path)]
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length)
  const keys = [...rows.keys()]
  const sorted = keys.toSorted(
    (a, b) =>
      Number(a === 'main') - Number(b === 'main') ||
      rank(a) - rank(b) ||
      keys.indexOf(a) - keys.indexOf(b),
  )

  return { rows: sorted.map(key => rows.get(key) as TreeRow), unknown }
}
