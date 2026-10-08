import { clockTime, fit, tokens, usd } from './format'
import { elapsed } from './items'
import {
  bar,
  byTokens,
  cost,
  glyph,
  KIND_LABEL,
  tokenSum,
  tone,
  totals,
  tree,
  worktrees,
} from './lists'
import type { View } from './view'

export function costTab(v: View) {
  const { Box, Button, Text } = v.ui
  const sum = totals(v.items)
  const running = v.items.filter(item => item.status === 'running').length
  const list = byTokens(v.items)
  const room = Math.max(3, v.rows - 9)
  const nameWidth = Math.max(12, v.width - 34)

  return (
    <Box flexDirection="column">
      <Text bold>session total {sum.usd === undefined ? 'cost n/a' : `≈ ${usd(sum.usd)}`}</Text>
      <Text dimColor wrap="wrap">
        tokens {tokens(sum.tokens)} · claude agents {cost(sum.claude)} · codex {cost(sum.codex)}
        {sum.unknown ? ` · ${sum.unknown} n/a` : ''} · running now {running}
      </Text>
      <Text dimColor>by worker · sorted by tokens</Text>
      <Text dimColor>{`  ${fit('NAME', nameWidth)} ${fit('TOKENS', 8)}${fit('COST', 8)}TIME`}</Text>
      {list.slice(0, room).map(item => {
        const tok = tokenSum(item)
        const label = `${fit(`${KIND_LABEL[item.kind]} ${item.title}`, nameWidth)} ${fit(tok < 0 ? 'n/a' : tokens(tok), 8)}${fit(cost(item.costUsd), 8)}${elapsed(item, v.now)}`
        return (
          <Box flexDirection="row" columnGap={1}>
            <Text color={tone(item)}>{glyph(item)}</Text>
            <Button
              key={`row:${item.id}`}
              plain
              dimColor={item.status === 'running' ? undefined : true}
              label={label}
              onPress={() => v.act({ type: 'open', id: item.id })}
            />
          </Box>
        )
      })}
      {list.length > room && <Text dimColor> … {list.length - room} more</Text>}
      {list.length === 0 && <Text dimColor>No agent or Codex job yet.</Text>}
      <Text dimColor wrap="wrap">
        Tokens come from Claude Code's per-request usage and the Codex session files; n/a where a
        session file is gone. Input counts cached tokens for both. Rabe has no price table yet, so
        cost shows n/a.
      </Text>
    </Box>
  )
}

export function effectsTab(v: View) {
  const { Box, Button, Text } = v.ui
  const trees = worktrees(v.items)
  const agents = v.items.filter(item => item.kind === 'agent')
  const plain = agents.flatMap(item =>
    item.kind === 'agent' && !item.detail.worktreePath ? [item] : [],
  )
  const shared = plain.filter(item => item.detail.cwd).length
  const unknown = plain.length - shared
  const ports = v.items.filter(
    item => item.kind === 'shell' && item.status === 'running' && item.detail.port !== undefined,
  )

  return (
    <Box flexDirection="column">
      <Text bold>WORKTREES {trees.length}</Text>
      {trees.flatMap(wt =>
        wt.items.map(item => (
          <Text wrap="truncate">
            {fit(wt.name, 14)} {wt.branch} · claude {item.title} {glyph(item)} {item.status}
          </Text>
        )),
      )}
      {shared > 0 && (
        <Text wrap="truncate">
          {fit('main', 14)} {shared} {shared === 1 ? 'agent shares' : 'agents share'} the main tree
        </Text>
      )}
      {unknown > 0 && (
        <Text dimColor wrap="truncate">
          {fit('n/a', 14)} {unknown} {unknown === 1 ? 'agent' : 'agents'}: tree n/a
        </Text>
      )}
      {agents.length === 0 && <Text dimColor>No agents yet.</Text>}
      <Text dimColor>from agent metadata · running agents included</Text>
      <Text bold>PORTS {ports.length}</Text>
      {ports.map(item => {
        const port = item.kind === 'shell' ? item.detail.port : undefined
        const ssh = `ssh -L ${port}:localhost:${port} <your-host>`
        return (
          <Box flexDirection="column">
            <Text wrap="truncate">
              :{port} {item.title}
            </Text>
            <Box paddingLeft={2}>
              <Button
                key={`port-${port}`}
                plain
                dimColor
                label={`${ssh}  (enter copies)`}
                onPress={press => v.act({ type: 'copy', text: ssh, surface: press.surface })}
              />
            </Box>
          </Box>
        )
      })}
      {ports.length === 0 && <Text dimColor>No open port found.</Text>}
      <Text dimColor>found in shell output · may miss some</Text>
    </Box>
  )
}

export function timelineTab(v: View) {
  const { Box, Text } = v.ui
  const list = v.items
    .filter(item => item.kind !== 'cron')
    .toSorted((a, b) => (a.startedAt ?? a.seenAt) - (b.startedAt ?? b.seenAt))
  const start = Math.min(v.now - 60_000, ...list.map(item => item.startedAt ?? item.seenAt))
  const labelWidth = Math.min(28, Math.floor(v.width / 3))
  const barWidth = Math.max(10, v.width - labelWidth - 1)
  const room = Math.max(3, Math.floor((v.rows - 8) / 2))
  const lines = tree(v.items)

  return (
    <Box flexDirection="column">
      <Text bold>WHEN DID THINGS RUN?</Text>
      <Text dimColor>one bar per item, this session</Text>
      <Text
        dimColor
      >{`${' '.repeat(labelWidth + 1)}${fit(clockTime(start).slice(0, 5), barWidth - 3)}now`}</Text>
      {list.slice(-room).map(item => (
        <Box flexDirection="row" columnGap={1}>
          <Text wrap="truncate">{fit(`${glyph(item)} ${item.title}`, labelWidth)}</Text>
          <Text color={tone(item)}>
            {bar(item.startedAt ?? item.seenAt, item.endedAt ?? v.now, start, v.now, barWidth)}
          </Text>
        </Box>
      ))}
      {list.length > room && <Text dimColor>… {list.length - room} earlier</Text>}
      <Text bold>WHO STARTED WHAT?</Text>
      <Text dimColor>agents and the work they started</Text>
      <Text>main session</Text>
      {lines.slice(0, room).map(line => (
        <Text wrap="truncate">
          {line.prefix}
          {glyph(line.item)} {KIND_LABEL[line.item.kind]} {line.item.title}
        </Text>
      ))}
      {lines.length > room && <Text dimColor>… {lines.length - room} more</Text>}
    </Box>
  )
}
