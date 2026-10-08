import { expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'rabe',
  props: { title: 'Rabe', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: {}, view: {} },
} as const

test('the pane shows an empty state on every surface', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'rabe', surface, ...PANE } as never)
    expect(await ui.find({ type: 'Text', text: 'Nothing runs in the background.' })).toBeDefined()
    await ui.unmount()
  }
})
