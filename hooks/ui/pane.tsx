import type { On } from 'claude-code'

import type { RabeTab } from '../../types'

const PANE = 'rabe'

const TABS: { tab: RabeTab; label: string }[] = [
  { tab: 'items', label: 'Items' },
  { tab: 'cost', label: 'Cost' },
  { tab: 'effects', label: 'Effects' },
  { tab: 'timeline', label: 'Timeline' },
]

export function pane(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rabe',
      description:
        'Show background work: agents, Codex jobs, shells, monitors, cron jobs and workflows',
    })

    return next(e)
  })

  on('command.run', { command: 'rabe' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Rabe' })

    return { text: 'Rabe opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const { value: tab = 'items' } = await $.state.get({ plugin: 'rabe', key: 'tab' })

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {TABS.map(one => (
            <Button
              key={`tab-${one.tab}`}
              label={one.tab === 'items' ? `${one.label} ${items.length}` : one.label}
              variant={one.tab === tab ? 'primary' : 'secondary'}
              onPress={() => $.state.set({ plugin: 'rabe', key: 'tab' }, one.tab)}
            />
          ))}
        </Box>
        {items.length === 0 ? (
          <Text dimColor>Nothing runs in the background.</Text>
        ) : tab === 'items' ? (
          items.map(item => (
            <Text>
              {item.status} {item.kind} {item.title}
            </Text>
          ))
        ) : (
          <Text dimColor>Not built yet.</Text>
        )}
        <Text dimColor>tab to select · esc close</Text>
      </Box>
    )
  })
}
