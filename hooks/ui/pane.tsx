import type { EngineInterface, On } from 'claude-code'

import type { RabeTab } from '../../types'
import type { RabeItem } from '../model'
import {
  detailView,
  filterRow,
  listActions,
  listView,
  searchField,
  summaryLine,
  summaryView,
} from './items'
import { KIND_LABEL } from './lists'
import { parseCodex } from './rollout'
import { costTab, effectsTab, timelineTab } from './tabs'
import { parseClaude } from './transcript'
import { type Action, type Loaded, type Notice, taskIdOf, type Ui, type View } from './view'

const PANE = 'rabe'
const MAX_READ = 4 * 1024 * 1024
const TAIL_LINES = 400

const TABS: { tab: RabeTab; label: string; hotkey: string }[] = [
  { tab: 'items', label: 'Items', hotkey: '1' },
  { tab: 'cost', label: 'Cost', hotkey: '2' },
  { tab: 'effects', label: 'Effects', hotkey: '3' },
  { tab: 'timeline', label: 'Timeline', hotkey: '4' },
]

async function tick($: EngineInterface): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  if (items.some(item => item.status === 'running')) $.ui.invalidate('ui.render')
}

async function readText(
  $: EngineInterface,
  path: string,
): Promise<{ text?: string; notice?: Notice }> {
  try {
    const stat = await $.fs.stat(path)
    if (stat.size <= MAX_READ) return { text: await $.fs.read(path) }
    const run = await $.process.run(['tail', '-n', String(TAIL_LINES), path])
    if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `tail exit ${run.exitCode}`)
    return {
      text: run.stdout,
      notice: {
        level: 'Warning',
        text: `The file is over 4 MiB. Showing the last ${TAIL_LINES} lines only.`,
      },
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { notice: { level: 'Error', text: `Could not read ${path}: ${reason}` } }
  }
}

async function load($: EngineInterface, item: RabeItem): Promise<Loaded> {
  const d = item.detail as Record<string, unknown>
  const path = [d.transcriptPath, d.sessionPath, d.outputPath].find(p => typeof p === 'string')
  if (typeof path !== 'string') return {}
  const { text, notice } = await readText($, path)
  if (text === undefined) return { notice }
  try {
    if (item.kind === 'agent') return { claude: parseClaude(text), notice }
    if (item.kind === 'codex') return { codex: parseCodex(text), notice }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { notice: { level: 'Error', text: `Could not parse ${path}: ${reason}` } }
  }

  return { output: text.split('\n').filter(line => line.trim() !== ''), notice }
}

async function stop($: EngineInterface, ids: string[]): Promise<void> {
  const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
  const targets = items.filter(item => ids.includes(item.id))
  const one = targets.length === 1 ? targets[0] : undefined
  if (one) $.ui.toast(`Stopping ${KIND_LABEL[one.kind]} ${one.title}…`)
  let stopped = 0
  let ended = 0
  let refused: string | undefined
  for (const item of targets) {
    const task = taskIdOf(item)
    if (item.status !== 'running' || !task) {
      ended += 1
      continue
    }
    try {
      const result = await $.tool.call({ tool: 'TaskStop', task_id: task })
      if (result.deny) refused = result.deny
      else if (result.isError) refused = result.text ?? 'n/a'
      else stopped += 1
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error)
    }
  }
  if (one && refused) $.ui.toast(`Stop refused: ${refused}`)
  else if (one) $.ui.toast(ended ? `${one.title} had already finished` : `Stopped ${one.title}`)
  else {
    const done = ended ? `; ${ended} had already finished` : ''
    const no = refused ? `; refused: ${refused}` : ''
    $.ui.toast(`Stopped ${stopped} of ${targets.length}${done}${no}`)
  }
}

async function act($: EngineInterface, action: Action): Promise<void> {
  switch (action.type) {
    case 'tab':
      await $.state.set({ plugin: 'rabe', key: 'tab' }, action.tab)
      return
    case 'filter':
      await $.state.set({ plugin: 'rabe', key: 'filter' }, action.filter)
      await $.state.set({ plugin: 'rabe', key: 'page' }, 0)
      return
    case 'page':
      await $.state.set({ plugin: 'rabe', key: 'page' }, action.page)
      return
    case 'fold': {
      const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
      const next = folded.includes(action.group)
        ? folded.filter(group => group !== action.group)
        : [...folded, action.group]
      await $.state.set({ plugin: 'rabe', key: 'folded' }, next)
      return
    }
    case 'open':
      if (action.id) {
        await $.state.set({ plugin: 'rabe', key: 'selected' }, action.id)
        await $.state.set({ plugin: 'rabe', key: 'tab' }, 'items')
      }
      await $.state.set({ plugin: 'rabe', key: 'open' }, action.id)
      return
    case 'query':
      await $.state.set({ plugin: 'rabe', key: 'query' }, action.text)
      await $.state.set({ plugin: 'rabe', key: 'page' }, 0)
      return
    case 'focus':
      await $.ui.focus({ requestId: PANE, key: action.key })
      return
    case 'follow':
      await $.ui.scroll({ in: PANE, to: 'end' })
      return
    case 'stop':
      await stop($, action.ids)
      return
    case 'delete': {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const item = items.find(one => one.id === action.id)
      if (item?.kind !== 'cron' || item.detail.scheduledFor !== undefined) return
      const result = await $.tool.call({ tool: 'CronDelete', id: item.detail.jobId })
      const reason = result.deny ?? (result.isError ? (result.text ?? 'n/a') : undefined)
      $.ui.toast(reason ? `Delete refused: ${reason}` : `Deleted cron ${item.title}`)
      return
    }
    case 'copy': {
      const result = await $.ui.copy({ text: action.text, surface: action.surface })
      $.ui.toast(result.isCopied ? `Copied: ${action.text}` : `Copy failed: ${result.reason}`)
      return
    }
    case 'message': {
      const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
      const item = items.find(one => one.id === action.id)
      if (item?.kind !== 'agent' || !action.text.trim()) return
      const sent = await $.session.send({ to: { agentId: item.detail.agentId }, text: action.text })
      $.ui.toast(
        sent.isDelivered
          ? `Message sent to claude ${item.title}`
          : `Message not sent: ${sent.reason}`,
      )
      return
    }
  }
}

export function pane(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rabe',
      description:
        'Show background work: agents, Codex jobs, shells, monitors, cron jobs and workflows',
    })
    $.clock.every(1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'rabe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Rabe' })
    $.clock.after(1500, () => void $.ui.open({ id: PANE, title: 'Rabe', focus: true }))

    return { text: 'Rabe opened.' }
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element?.startsWith('row:')) {
      await $.state.set({ plugin: 'rabe', key: 'selected' }, e.element.slice(4))
    }

    return next(e)
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const { value: tab = 'items' } = await $.state.get({ plugin: 'rabe', key: 'tab' })
    const { value: filter = 'all' } = await $.state.get({ plugin: 'rabe', key: 'filter' })
    const { value: query = '' } = await $.state.get({ plugin: 'rabe', key: 'query' })
    const { value: page = 0 } = await $.state.get({ plugin: 'rabe', key: 'page' })
    const { value: folded = [] } = await $.state.get({ plugin: 'rabe', key: 'folded' })
    const { value: selected = '' } = await $.state.get({ plugin: 'rabe', key: 'selected' })
    const { value: open = '' } = await $.state.get({ plugin: 'rabe', key: 'open' })
    const width = e.props.bodyColumns
    const v: View = {
      ui,
      act: action => void act($, action),
      items,
      now: await $.clock.now(),
      width,
      rows: e.props.scroll?.bodyRows || 24,
      isWide: e.props.placement === 'dock' && width >= 100,
      isFocused: e.props.isFocused,
    }
    const openItem = tab === 'items' ? items.find(item => item.id === open) : undefined
    const selectedItem = items.find(item => item.id === selected)
    const shown = openItem ?? (v.isWide && tab === 'items' ? selectedItem : undefined)
    const loaded = shown ? await load($, shown) : {}
    const st = { filter, query, page, folded, selected: selectedItem }
    const listWidth = v.isWide ? Math.min(72, Math.floor(width * 0.5)) : width
    const hint = !v.isFocused
      ? 'tab to select · esc close'
      : openItem
        ? 'tab move · enter open · b back · esc close'
        : 'tab move · enter open · esc close'

    let body: ReturnType<typeof Box>
    if (items.length === 0) body = <Text dimColor>Nothing runs in the background.</Text>
    else if (tab === 'cost') body = costTab(v)
    else if (tab === 'effects') body = effectsTab(v)
    else if (tab === 'timeline') body = timelineTab(v)
    else if (openItem) body = detailView(v, openItem, loaded)
    else {
      const list = (
        <Box flexDirection="column" width={v.isWide ? listWidth : undefined} flexShrink={0}>
          {filterRow(v, st)}
          {searchField(v, st)}
          {listView(v, st, listWidth)}
          {!v.isWide && selectedItem && summaryLine(v, selectedItem)}
          {listActions(v, st)}
        </Box>
      )
      body =
        v.isWide && selectedItem ? (
          <Box flexDirection="row" columnGap={2}>
            {list}
            {summaryView(v, selectedItem, loaded)}
          </Box>
        ) : (
          list
        )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {TABS.map(one => (
            <Button
              key={`tab-${one.tab}`}
              hotkey={one.hotkey}
              label={one.tab === 'items' ? `${one.label} ${items.length}` : one.label}
              variant={one.tab === tab ? 'primary' : 'secondary'}
              onPress={() => v.act({ type: 'tab', tab: one.tab })}
            />
          ))}
        </Box>
        {body}
        <Text dimColor>{hint}</Text>
      </Box>
    )
  })
}
