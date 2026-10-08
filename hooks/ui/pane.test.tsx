import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../model'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'rabe',
  component: 'Pane',
  requestId: 'rabe',
  props: {
    title: 'Rabe',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: {},
    view: {},
  },
} as const

const shell: RabeItem = {
  id: 'shell:bg_1',
  kind: 'shell',
  title: 'bun test --watch',
  status: 'running',
  seenAt: 1000,
  detail: { command: 'bun test --watch' },
}

function holdItems(on: On, items: RabeItem[]) {
  on('state.get', async (_$, e, next) =>
    e.plugin === 'rabe' && e.key === 'items' ? { value: { value: items, version: 1 } } : next(e),
  )
}

test('the pane shows the tab row and the empty state on every surface', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    for (const label of ['Items 0', 'Cost', 'Effects', 'Timeline']) {
      expect(await ui.find({ type: 'Button', text: label })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'Nothing runs in the background.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'tab to select' })).toBeDefined()
    await ui.unmount()
  }
})

test('the items tab lists items with a status word on every surface', async ($, on) => {
  holdItems(on, [shell])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    expect(await ui.find({ type: 'Button', text: 'Items 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'running shell bun test --watch' })).toBeDefined()
    await ui.unmount()
  }
})

test('a tab button switches the tab on every surface', async ($, on) => {
  holdItems(on, [shell])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ type: 'Text', text: 'Not built yet.' })).toBeDefined()
    await ui.press({ key: 'tab-items' })
    expect(await ui.find({ type: 'Text', text: 'running shell' })).toBeDefined()
    await ui.unmount()
  }
})
