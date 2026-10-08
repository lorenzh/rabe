import type { On } from 'claude-code'

import { render } from './render'
import { NO_SELECTION } from './view'
import { bandView } from './views/band'

export function band(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    if (!items.some(item => item.status === 'running')) return next(e)
    const model = { items, turns: {}, lines: {}, now: await $.clock.now() }
    const size = {
      columns: e.props.bodyColumns,
      rows: e.props.maxRows,
      surface: e.surface,
      hasInput: false,
    }

    return render($.ui.resolve(e), e.surface, bandView(model, size, NO_SELECTION), () => {}, 'band')
  })
}
