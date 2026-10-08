import type { RabeItem } from '../model'
import { facts, upcoming } from './facts'
import { duration, fit, tokens } from './format'
import {
  GROUPS,
  glyph,
  grouped,
  groupNote,
  groupOf,
  KIND_LABEL,
  matches,
  name,
  phases,
  sortItems,
  timeLabel,
  tokenSum,
  tone,
} from './lists'
import type { ClaudeTool } from './transcript'
import { canStop, type ListState, type Loaded, type View } from './view'

const TIME = 9

export function itemRow(v: View, item: RabeItem, width: number, extra = '') {
  const { Box, Button, Text } = v.ui
  const head = `${fit(item.status, 8)}${fit(KIND_LABEL[item.kind], 9)}`
  const tail = `${extra}${fit(timeLabel(item, v.now), TIME)}`
  const label = `${head}${fit(name(item), Math.max(8, width - 3 - head.length - tail.length))} ${tail}`

  return (
    <Box flexDirection="row" columnGap={1}>
      <Text color={tone(item)}>{glyph(item)}</Text>
      <Button
        key={`row:${item.id}`}
        plain
        dimColor={item.status === 'running' ? undefined : true}
        label={label.trimEnd()}
        onPress={() => v.act({ type: 'open', id: item.id })}
      />
    </Box>
  )
}

function more(v: View, key: string, label: string, onPress: () => void) {
  const { Box, Button } = v.ui

  return (
    <Box paddingLeft={2}>
      <Button key={key} plain dimColor label={label} onPress={onPress} />
    </Box>
  )
}

export function listView(v: View, st: ListState, width: number) {
  const { Box, Button, Text } = v.ui
  const visible = v.items.filter(item => matches(item, st.query))
  if (visible.length === 0) return <Text dimColor>No item matches "{st.query}".</Text>
  const room = Math.max(4, v.rows - (v.isWide ? 6 : 8))

  if (st.filter !== 'all') {
    const list = sortItems(visible.filter(item => groupOf(item) === st.filter))
    const pages = Math.max(1, Math.ceil(list.length / room))
    const page = st.page % pages
    const shown = list.slice(page * room, page * room + room)
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>Nothing here.</Text>}
        {shown.map(item => itemRow(v, item, width))}
        {pages > 1 &&
          more(
            v,
            'more',
            `… ${list.length - shown.length} more · page ${page + 1} of ${pages}`,
            () => v.act({ type: 'page', page: (page + 1) % pages }),
          )}
      </Box>
    )
  }

  const groups = grouped(visible)
  const cap = Math.max(2, Math.floor((room - groups.length) / groups.length))

  return (
    <Box flexDirection="column">
      {groups.map(group => {
        const isFolded = st.folded.includes(group.id)
        const note = groupNote(group.id, group.items)
        const rest = group.items.length - cap
        return (
          <Box flexDirection="column">
            <Button
              key={`group-${group.id}`}
              plain
              label={`${isFolded ? '▸' : '▾'} ${group.label.toUpperCase()} ${group.items.length}${note ? `  ${note}` : ''}`}
              onPress={() => v.act({ type: 'fold', group: group.id })}
            />
            {!isFolded && group.items.slice(0, cap).map(item => itemRow(v, item, width))}
            {!isFolded &&
              rest > 0 &&
              more(v, `more-${group.id}`, `… ${rest} more`, () =>
                v.act({ type: 'filter', filter: group.id }),
              )}
          </Box>
        )
      })}
    </Box>
  )
}

export function filterRow(v: View, st: ListState) {
  const { Box, Button } = v.ui
  const visible = v.items.filter(item => matches(item, st.query))
  const count = (id: string) => visible.filter(item => id === 'all' || groupOf(item) === id).length
  const filters = [{ id: 'all' as const, label: 'All' }, ...GROUPS].filter(
    one => one.id !== 'failed' || count('failed') > 0,
  )

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      {filters.map(one => (
        <Button
          key={`filter-${one.id}`}
          plain
          dimColor={one.id === st.filter ? undefined : true}
          label={`${one.id === st.filter ? '•' : ' '}${one.label} ${count(one.id)}`}
          onPress={() => v.act({ type: 'filter', filter: one.id })}
        />
      ))}
    </Box>
  )
}

export function searchField(v: View, st: ListState) {
  const { Input } = v.ui
  if (!Input) return undefined
  const set = (text: string) => v.act({ type: 'query', text })

  return (
    <Input
      key="search"
      label="search"
      placeholder="title, kind or command"
      value={st.query}
      submitLabel="filter"
      onInput={set}
      onSubmit={set}
    />
  )
}

function toolLine(tool: ClaudeTool): string {
  const mark = tool.state === 'running' ? '  ◐ running' : tool.state === 'error' ? '  ✗ error' : ''

  return `  ⎿ ${tool.name} ${tool.target}${mark}`
}

function tail(item: RabeItem, loaded: Loaded, count: number): { label: string; lines: string[] } {
  if (loaded.claude) {
    const tools = loaded.claude.turns.flatMap(turn => turn.tools)
    return { label: 'recent tools', lines: tools.slice(-count).map(toolLine) }
  }
  if (loaded.codex) {
    const lines = loaded.codex.turns.flatMap(turn => [
      `◆ ${turn.text}`,
      ...turn.commands.map(c => `  $ ${c.command}`),
    ])
    return { label: 'live output (tail)', lines: lines.slice(-count) }
  }
  if (loaded.output) return { label: 'output (tail)', lines: loaded.output.slice(-count) }
  if (item.kind === 'codex' && item.detail.prompt)
    return { label: 'prompt', lines: [item.detail.prompt] }

  return { label: '', lines: [] }
}

export function summaryView(v: View, item: RabeItem, loaded: Loaded) {
  const { Box, Text } = v.ui
  const f = facts(item, v.now, v.items)
  const { label, lines } = tail(item, loaded, Math.max(3, v.rows - f.lines.length - 8))

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold wrap="truncate">
        {f.title}
      </Text>
      <Text color={tone(item)}>{f.status}</Text>
      {f.lines.map(line => (
        <Text dimColor wrap="truncate">
          {line}
        </Text>
      ))}
      {loaded.notice && noticeLine(v, loaded)}
      {label && <Text dimColor>{label}</Text>}
      {lines.map(line => (
        <Text wrap="truncate">{line}</Text>
      ))}
    </Box>
  )
}

export function summaryLine(v: View, item: RabeItem) {
  const { Text } = v.ui
  const f = facts(item, v.now, v.items)

  return (
    <Text dimColor wrap="truncate">
      {[item.title, f.lines[0], f.status].join(' · ')}
    </Text>
  )
}

function noticeLine(v: View, loaded: Loaded) {
  const { Text } = v.ui
  const notice = loaded.notice
  if (!notice) return undefined

  return (
    <Text color={notice.level === 'Error' ? 'error' : 'warning'} wrap="wrap">
      {notice.level} {notice.text}
    </Text>
  )
}

function counts(tools: ClaudeTool[]): string {
  const by = new Map<string, number>()
  for (const tool of tools) by.set(tool.name, (by.get(tool.name) ?? 0) + 1)

  return [...by].map(([tool, n]) => `${tool} ×${n}`).join(', ')
}

function claudeBody(v: View, loaded: Loaded, keep: number) {
  const { Box, Text } = v.ui
  const log = loaded.claude
  if (!log) return <Text dimColor>Transcript n/a.</Text>
  const older = log.turns.slice(0, Math.max(0, log.turns.length - keep))
  const shown = log.turns.slice(older.length)
  const olderTools = older.flatMap(turn => turn.tools)

  return (
    <Box flexDirection="column">
      {log.brief && <Text dimColor>▸ brief</Text>}
      {log.brief && <Text wrap="wrap">{log.brief.split('\n').slice(0, 3).join(' ')}</Text>}
      {older.length > 0 && (
        <Text dimColor wrap="truncate">
          ▸ turns 1–{older.length} folded · {olderTools.length} tools · {counts(olderTools)}
        </Text>
      )}
      {shown.map((turn, i) => (
        <Box flexDirection="column">
          {turn.text && (
            <Text wrap="wrap">
              {older.length + i + 1} ● {turn.text}
            </Text>
          )}
          {turn.tools.map(tool => (
            <Text
              dimColor={tool.state === 'ok'}
              color={tool.state === 'error' ? 'error' : undefined}
              wrap="truncate"
            >
              {toolLine(tool)}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function codexBody(v: View, item: RabeItem, loaded: Loaded, keep: number) {
  const { Box, Text } = v.ui
  const log = loaded.codex
  const prompt = item.kind === 'codex' ? item.detail.prompt : undefined
  const older = log ? Math.max(0, log.turns.length - keep) : 0

  return (
    <Box flexDirection="column">
      {log && (
        <Text dimColor wrap="truncate">
          {log.model ?? 'n/a'} · effort {log.effort ?? 'n/a'} · sandbox {log.sandbox ?? 'n/a'} ·{' '}
          {log.commandCount} commands
        </Text>
      )}
      {prompt && <Text dimColor>▸ prompt</Text>}
      {prompt && <Text wrap="wrap">{prompt}</Text>}
      {!log && <Text dimColor>Session file n/a: tokens, model and commands are not known.</Text>}
      {older > 0 && <Text dimColor>▸ turns 1–{older} folded</Text>}
      {log?.turns.slice(older).map((turn, i) => (
        <Box flexDirection="column">
          {turn.reasoning && (
            <Text dimColor wrap="wrap">
              {'  thinking: '}
              {turn.reasoning}
            </Text>
          )}
          {turn.text && (
            <Text wrap="wrap">
              {older + i + 1} ◆ {turn.text}
            </Text>
          )}
          {turn.commands.map(c => (
            <Text
              color={c.state === 'error' ? 'error' : undefined}
              dimColor={c.state === 'ok'}
              wrap="truncate"
            >
              {'  $ '}
              {c.command}
              {c.state === 'running'
                ? '  ◐ running'
                : `  ${c.state === 'ok' ? '✓' : '✗'} exit ${c.exitCode ?? 'n/a'}`}
              {c.lines !== undefined ? ` · ${c.lines} lines` : ''}
            </Text>
          ))}
        </Box>
      ))}
      {log?.isComplete && log.result && <Text dimColor>result</Text>}
      {log?.isComplete && log.result && <Text wrap="wrap">{log.result}</Text>}
      <Text dimColor wrap="wrap">
        Messages, commands and tokens come from the Codex session file. Reasoning summaries appear
        when model_reasoning_summary is set in the Codex config.
      </Text>
    </Box>
  )
}

function workflowBody(v: View, item: RabeItem) {
  const { Box, Text } = v.ui
  const list = phases(v.items, item)
  const mark = { done: '✓', running: '◐', failed: '✗', waiting: '·' } as const
  const order = sortItems(list.flatMap(p => p.agents)).toSorted(
    (a, b) => (a.startedAt ?? a.seenAt) - (b.startedAt ?? b.seenAt),
  )

  return (
    <Box flexDirection="column">
      <Text wrap="wrap">
        {list.map(p => `${mark[p.state]} ${p.name}`).join(' → ') || 'phases n/a'}
      </Text>
      <Text dimColor>agents by phase · start order inside a phase</Text>
      {list.map(p => {
        const note = (['done', 'failed', 'running'] as const)
          .map(s => [p.agents.filter(a => a.status === s).length, s] as const)
          .filter(([n]) => n > 0)
          .map(([n, s]) => `${n} ${s}`)
          .join(' · ')
        return (
          <Box flexDirection="column">
            <Text bold>
              {p.name.toUpperCase()} {note || 'not started'}
            </Text>
            {p.agents.map(agent => {
              const tok = tokenSum(agent)
              return itemRow(
                v,
                agent,
                v.width,
                `#${order.indexOf(agent) + 1} ${fit(tok < 0 ? 'n/a' : tokens(tok), 6)} `,
              )
            })}
          </Box>
        )
      })}
      <Text dimColor wrap="wrap">
        Each agent's phase comes from its metadata file. Retries are not reported, so a second
        attempt shows as its own row.
      </Text>
    </Box>
  )
}

function outputBody(v: View, item: RabeItem, loaded: Loaded, keep: number) {
  const { Box, Text } = v.ui
  const all = loaded.output
  if (!all) return <Text dimColor>Output n/a.</Text>
  const shown = all.slice(-keep)
  const note =
    item.kind === 'monitor'
      ? 'Lines come from following the monitor’s output file. A monitor is one command that streams lines until it exits or times out; it has no interval.'
      : 'Output and exit code are read from Claude Code’s own task output file (tasks/<id>.output).'

  return (
    <Box flexDirection="column">
      <Text dimColor>
        output · last {shown.length} of {all.length} lines · newest last
      </Text>
      {shown.map(line => (
        <Text wrap="truncate">{line}</Text>
      ))}
      <Text dimColor wrap="wrap">
        {note}
      </Text>
    </Box>
  )
}

function cronBody(v: View, item: RabeItem) {
  const { Box, Text } = v.ui
  const runs = upcoming(item, v.now)

  return (
    <Box flexDirection="column">
      {runs.length > 0 && <Text dimColor>next runs (computed from the schedule)</Text>}
      {runs.length > 0 && <Text>{runs.join('  ')}</Text>}
      <Text dimColor wrap="wrap">
        Loops from /loop show the same way. A one-time wakeup shows a single "fires at" time instead
        of a schedule.
      </Text>
    </Box>
  )
}

function detailActions(v: View, item: RabeItem) {
  const { Box, Button } = v.ui
  const d = item.detail as Record<string, unknown>
  const command = typeof d.command === 'string' ? d.command : undefined
  const isLive = item.kind !== 'cron' && item.kind !== 'workflow'

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {isLive && (
        <Button
          key="follow"
          plain
          hotkey="f"
          label="follow"
          onPress={() => v.act({ type: 'follow' })}
        />
      )}
      {item.kind === 'agent' && item.status === 'running' && v.ui.Input && (
        <Button
          key="message-agent"
          plain
          hotkey="m"
          label="message agent"
          onPress={() => v.act({ type: 'focus', key: 'message' })}
        />
      )}
      {command && (
        <Button
          key="copy"
          plain
          hotkey="c"
          label="copy command"
          onPress={press => v.act({ type: 'copy', text: command, surface: press.surface })}
        />
      )}
      {item.kind === 'cron' && (
        <Button
          key="copy"
          plain
          hotkey="c"
          label="copy prompt"
          onPress={press =>
            v.act({ type: 'copy', text: item.detail.prompt, surface: press.surface })
          }
        />
      )}
      {item.kind === 'cron' && item.detail.scheduledFor === undefined && (
        <Button
          key="delete"
          plain
          hotkey="d"
          label="delete job"
          onPress={() => v.act({ type: 'delete', id: item.id })}
        />
      )}
      {canStop(item) && (
        <Button
          key="stop"
          plain
          hotkey={item.kind === 'workflow' ? 'g' : 'x'}
          label={item.kind === 'workflow' ? 'stop run' : 'stop'}
          onPress={() => v.act({ type: 'stop', ids: [item.id] })}
        />
      )}
    </Box>
  )
}

export function detailView(v: View, item: RabeItem, loaded: Loaded) {
  const { Box, Button, Input, Text } = v.ui
  const f = facts(item, v.now, v.items)
  const keep = Math.max(3, Math.floor((v.rows - f.lines.length - 8) / 3))
  const body =
    item.kind === 'agent'
      ? claudeBody(v, loaded, keep)
      : item.kind === 'codex'
        ? codexBody(v, item, loaded, keep)
        : item.kind === 'workflow'
          ? workflowBody(v, item)
          : item.kind === 'cron'
            ? cronBody(v, item)
            : outputBody(v, item, loaded, Math.max(4, v.rows - f.lines.length - 8))

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Button
          key="back"
          plain
          hotkey="b"
          label="‹ list"
          onPress={() => v.act({ type: 'open', id: '' })}
        />
        <Text bold wrap="truncate">
          {f.title}
        </Text>
        <Text color={tone(item)}>{f.status}</Text>
      </Box>
      {f.lines.map(line => (
        <Text dimColor wrap="truncate">
          {line}
        </Text>
      ))}
      {noticeLine(v, loaded)}
      {body}
      {detailActions(v, item)}
      {item.kind === 'agent' && item.status === 'running' && Input && (
        <Input
          key="message"
          label="message"
          placeholder="text for the agent"
          submitLabel="send"
          onSubmit={text => v.act({ type: 'message', id: item.id, text })}
        />
      )}
    </Box>
  )
}

export function listActions(v: View, st: ListState) {
  const { Box, Button } = v.ui
  const item = st.selected
  const group = item
    ? v.items.filter(one => groupOf(one) === groupOf(item) && canStop(one)).map(one => one.id)
    : []

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      {item && canStop(item) && (
        <Button
          key="stop"
          plain
          hotkey="x"
          label="stop"
          onPress={() => v.act({ type: 'stop', ids: [item.id] })}
        />
      )}
      {group.length > 1 && (
        <Button
          key="stop-group"
          plain
          hotkey="g"
          label="stop group"
          onPress={() => v.act({ type: 'stop', ids: group })}
        />
      )}
      {v.ui.Input && (
        <Button
          key="find"
          plain
          hotkey="s"
          label="search"
          onPress={() => v.act({ type: 'focus', key: 'search' })}
        />
      )}
    </Box>
  )
}

export function elapsed(item: RabeItem, now: number): string {
  return item.startedAt === undefined ? 'n/a' : duration((item.endedAt ?? now) - item.startedAt)
}
