import type { BuiltinToolResults, EngineInterface, On } from 'claude-code'

import { itemId } from '../model'
import { addItem, type Change, commit, endItem, prune, updateItem } from '../registry'
import { endStatus, parseNotifications } from '../tasks'

type Launched = BuiltinToolResults['Workflow']

export function phaseNames(script: string): string[] | undefined {
  // ponytail: a `}` inside an object entry's string still ends that entry.
  const list =
    /\bphases\s*:\s*\[\s*((?:(?:'[^']*'|"[^"]*"|`[^`]*`|\{[^}]*\})\s*(?:,\s*)?)*)\]/.exec(
      script,
    )?.[1]
  if (list === undefined) return undefined

  return [...list.matchAll(/\{[^}]*\}|(['"`])(.*?)\1/g)].flatMap(([whole, quote, text]) => {
    if (quote) return [text ?? '']
    const title = /\btitle\s*:\s*(['"`])(.*?)\1/.exec(whole)?.[2]
    return title === undefined ? [] : [title]
  })
}

async function write($: Pick<EngineInterface, 'state'>, change: Change): Promise<void> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = commit(value, change)
    if (next === undefined) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next.items, {
      ifVersion: version,
    })
    if (isSet) return forget($, next.dropped)
  }
}

// Drops the lines and turns of the items a write dropped.
async function forget($: Pick<EngineInterface, 'state'>, dropped: string[]): Promise<void> {
  if (dropped.length === 0) return
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) break
    const lines = await $.state.set({ plugin: 'rabe', key: 'lines' }, next, { ifVersion: version })
    if (lines.isSet) break
  }
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'turns' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) return
    const turns = await $.state.set({ plugin: 'rabe', key: 'turns' }, next, { ifVersion: version })
    if (turns.isSet) return
  }
}

async function readScript($: EngineInterface, path: string): Promise<string | undefined> {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = config ? undefined : await $.env.get('HOME')
  const claude = config || (home && `${home}/.claude`)
  if (!claude) return undefined
  const prefix = `${claude.replace(/\/+$/, '')}/projects/`
  if (!path.startsWith(prefix) || /[\\\p{Cc}\p{Cf}]/u.test(path)) return undefined
  const parts = path.slice(prefix.length).split('/')
  if (
    parts.length !== 5 ||
    parts[0] !== (await $.session.root()).replace(/[^a-zA-Z0-9]/g, '-') ||
    parts.some(part => !part || part === '.' || part === '..') ||
    parts[1] !== (await $.session.id()) ||
    parts[2] !== 'workflows' ||
    parts[3] !== 'scripts'
  )
    return undefined
  const folder = path.slice(0, path.lastIndexOf('/'))
  const root = await $.fs.stat(folder, { resolve: true })
  const stat = await $.fs.stat(path, { resolve: true })
  if (!root.realPath || stat.realPath !== `${root.realPath}/${parts[4]}` || stat.kind !== 'file')
    return undefined

  return String(await $.fs.read(stat.realPath))
}

async function launched($: EngineInterface, result: Launched, name?: string): Promise<void> {
  const runId = result.runId
  if (!runId) return
  const id = itemId('workflow', runId)
  const now = await $.clock.now()
  await write($, items =>
    addItem(
      items,
      {
        id,
        kind: 'workflow',
        title: result.workflowName ?? name ?? 'workflow',
        status: 'running',
        startedAt: now,
        endedAt: undefined,
        detail: {
          runId,
          taskId: result.taskId,
          scriptPath: result.scriptPath,
          transcriptDir: result.transcriptDir,
        },
      },
      now,
    ),
  )
  if (!result.scriptPath) return
  const script = await readScript($, result.scriptPath).catch(() => undefined)
  const phases = typeof script === 'string' ? phaseNames(script) : undefined
  if (phases) await write($, items => updateItem(items, id, { detail: { phases } }))
}

async function notified($: EngineInterface, text: string): Promise<void> {
  const notes = parseNotifications(text).filter(note => note.status)
  if (notes.length === 0) return
  const now = await $.clock.now()
  await write($, items =>
    notes.reduce((list, note) => {
      const run = list.find(item => item.kind === 'workflow' && item.detail.taskId === note.taskId)
      return run ? endItem(list, run.id, endStatus(note.status), now) : list
    }, items),
  )
}

export function workflows(on: On): void {
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const answer = await next(e)
    if (answer.result && !answer.isError) await launched($, answer.result as Launched, e.name)

    return answer
  }).catch((_$, e, next) => next(e))

  on('prompt.submit', { origin: { kind: 'task-notification' } }, async ($, e, next) => {
    await notified($, e.text)

    return next(e)
  }).catch((_$, e, next) => next(e))
}
