import { expect, test } from 'claude-code/testing'

import { type Grid, grid, safe, write } from './cells/grid'
import { render } from './render'

const PROBE = {
  surface: 'terminal',
  plugin: 'rabe',
  component: 'AbovePrompt',
  requestId: 'probe',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 512,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

let shown: Grid = grid(1, 1)

// The engine refuses a whole Raster for one bad cell and names it; each
// refused character is noted and the rest drawn again, so all are listed.
test('the engine takes every character safe lets through in a Raster', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) =>
    render($.ui.resolve(e), e.surface, { nodes: [{ chart: shown }], buttons: [] }, () => {}),
  )
  let rest: string[] = []
  for (let code = 0x21; code <= 0xffff; code++) {
    const ch = String.fromCharCode(code)
    if (safe(ch) === ch) rest.push(ch)
  }
  expect(rest.length).toBeGreaterThan(1000)
  const refused: string[] = []
  for (;;) {
    shown = grid(512, Math.ceil(rest.length / 512))
    rest.forEach((ch, i) => {
      write(shown, i % 512, Math.floor(i / 512), ch)
    })
    try {
      const ui = await $.ui.mount(PROBE as never)
      await ui.unmount()
      break
    } catch (error) {
      const code = /holds U\+([0-9A-F]+)/.exec(String(error))?.[1]
      if (!code) throw error
      refused.push(code)
      rest = rest.filter(ch => ch !== String.fromCharCode(Number.parseInt(code, 16)))
    }
  }
  expect(refused).toEqual([])
})
