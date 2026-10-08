import type { BuiltinToolResults, EngineInterface, On } from 'claude-code'

import { type EndStatus, itemId, type RabeItem } from '../model'
import { addItem, type Change, commit, endItem, updateItem } from '../registry'

type Launched = BuiltinToolResults['Workflow']

const ENDED: Record<string, EndStatus> = { completed: 'done', failed: 'failed', killed: 'stopped' }

export function phaseNames(script: string): string[] | undefined {
  const list = /\bphases\s*:\s*\[([\s\S]*?)\]/.exec(script)?.[1]
  if (list === undefined) return undefined
  const titles = [...list.matchAll(/\btitle\s*:\s*(['"`])(.*?)\1/g)].map(match => match[2] ?? '')
  if (titles.length > 0) return titles

  return [...list.matchAll(/(['"`])(.*?)\1/g)].map(match => match[2] ?? '')
}

export function taskNotification(text: string): { taskId: string; status: EndStatus } | undefined {
  const taskId = /<task-id>(.*?)<\/task-id>/.exec(text)?.[1]
  const status = /<status>(.*?)<\/status>/.exec(text)?.[1]
  if (!taskId || !status) return undefined

  return { taskId, status: ENDED[status] ?? 'done' }
}

async function write($: Pick<EngineInterface, 'state'>, change: Change): Promise<void> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = commit(value, change)
    if (next === undefined) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
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
  const script = await $.fs.read(result.scriptPath).catch(() => undefined)
  const phases = typeof script === 'string' ? phaseNames(script) : undefined
  if (phases) await write($, items => updateItem(items, id, { detail: { phases } }))
}

async function notified($: EngineInterface, text: string): Promise<void> {
  const note = taskNotification(text)
  if (!note) return
  const now = await $.clock.now()
  const isRun = (item: RabeItem) => item.kind === 'workflow' && item.detail.taskId === note.taskId
  await write($, items => {
    const run = items.find(isRun)

    return run ? endItem(items, run.id, note.status, now) : items
  })
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
