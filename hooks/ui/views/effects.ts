import { fit, grid } from '../cells/grid'
import { C, tone } from '../cells/palette'
import { glyph, worktrees } from '../lists'
import type { Drawn, View, ViewButton } from '../view'
import { draw, type Line } from './lines'

const dim = { fg: C.dim }

// The Effects tab: worktrees of agents, then ports of running shells with the
// ssh command to reach them; a Button copies each command.
export const effectsView: View = (model, size): Drawn => {
  const g = grid(size.columns, size.rows)
  const trees = worktrees(model.items)
  const agents = model.items.flatMap(item => (item.kind === 'agent' ? [item] : []))
  const plain = agents.filter(item => !item.detail.worktreePath)
  const shared = plain.filter(item => item.detail.cwd).length
  const unknown = plain.length - shared
  const ports = model.items.flatMap(item =>
    item.kind === 'shell' && item.status === 'running' && item.detail.port !== undefined
      ? [{ item, port: item.detail.port }]
      : [],
  )
  const lines: Line[] = [{ spans: [[`WORKTREES ${trees.length}`, { fg: C.orange }]] }]
  for (const wt of trees) {
    for (const item of wt.items) {
      lines.push({
        spans: [
          [`${fit(wt.name, 14)} ${wt.branch} · `],
          [`${glyph(item)} `, { fg: tone(item) }],
          [`${item.title} ${item.status}`],
        ],
      })
    }
  }
  const say = (text: string, style = {}) => lines.push({ spans: [[text, style]] })
  if (shared)
    say(
      `${fit('main', 14)} ${shared} ${shared === 1 ? 'agent shares' : 'agents share'} the main tree`,
    )
  if (unknown)
    say(`${fit('n/a', 14)} ${unknown} ${unknown === 1 ? 'agent' : 'agents'}: tree n/a`, dim)
  if (agents.length === 0) say('No agents yet.', dim)
  lines.push({ spans: [] })
  say(`PORTS ${ports.length}`, { fg: C.yellow })
  for (const { item, port } of ports) {
    lines.push({ spans: [[`:${port} `, { fg: C.blue }], [item.title]] })
    say(`  ssh -L ${port}:localhost:${port} <your-host>`, dim)
  }
  if (ports.length === 0) say('No open port found.', dim)
  draw(g, 0, 0, size.columns, lines.slice(0, size.rows))
  const buttons: ViewButton[] = ports.map(({ port }, i) => ({
    key: `port-${port}`,
    label: i === 0 ? `c: copy ssh :${port}` : `copy ssh :${port}`,
    ...(i === 0 && { hotkey: 'c' }),
    action: { type: 'copy', text: `ssh -L ${port}:localhost:${port} <your-host>` },
  }))

  return { grid: g, buttons }
}
