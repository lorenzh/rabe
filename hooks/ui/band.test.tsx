import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../model'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'rabe',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
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

test('the band draws nothing while nothing runs on every surface', async ($, on) => {
  holdItems(on, [{ ...shell, status: 'done', endedAt: 2000 }])
  on('ui.render', { component: 'AbovePrompt' }, async () => ({
    type: 'Box',
    props: { key: 'engine' },
  }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...BAND } as never)
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('the band counts running items on every surface', async ($, on) => {
  holdItems(on, [shell])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: '1 running' })).toBeDefined()
    await ui.unmount()
  }
})
