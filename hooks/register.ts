import type { EngineInterface, On, RenderSurface } from 'claude-code'

const VERSION = '0.0.1'

// ponytail: module memory, not $.state: the validator cannot declare state for a plugin name with a
// hyphen, and the probe needs no reload safety (a reload resets these, and the answer then says so).
const p: {
  startedAt?: number
  surface?: RenderSurface | null
  isInteractive?: boolean
  attached: RenderSurface[]
  renders: Partial<Record<RenderSurface, number>>
} = { attached: [], renders: {} }

// Feature detection by a call that never throws; the engine refuses `$.ui` read as a value.
async function works(call: () => Promise<unknown>): Promise<string> {
  try {
    await call()
    return 'yes'
  } catch {
    return 'call failed'
  }
}

async function answer($: EngineInterface): Promise<{ text: string }> {
  try {
    const surfaces = await $.session.surfaces().catch(() => undefined)
    const renders = Object.entries(p.renders)
      .map(([s, n]) => `${s}=${n}`)
      .join(', ')
    const ui = await works(() => $.ui.panes())
    const proc = await works(() => $.process.run(['true']))
    const root = $.plugin.root?.split(/[\\/]/).filter(Boolean).pop() ?? 'n/a'
    return {
      text: [
        `version ${VERSION}`,
        `session.start fired: ${p.startedAt ? 'yes' : 'no'}`,
        `session.start surface: ${p.surface === undefined ? 'n/a' : String(p.surface)}`,
        `session.start isInteractive: ${p.isInteractive === undefined ? 'n/a' : String(p.isInteractive)}`,
        `session surfaces now: ${surfaces ? surfaces.join(', ') || 'none' : 'n/a'}`,
        `session.attach seen: ${p.attached.join(', ') || 'none'}`,
        `ui.render AbovePrompt calls: ${renders || 'none'}`,
        `$.ui.panes(): ${ui}, $.process.run(['true']): ${proc}`,
        `plugin root folder: ${root}`,
      ].join('\n'),
    }
  } catch (err) {
    return { text: `rabe-probe ${VERSION}: answer failed (${err instanceof Error ? err.name : typeof err})` }
  }
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    try {
      Object.assign(p, { startedAt: Date.now(), surface: e.surface, isInteractive: e.isInteractive })
      await $.command.register({ name: 'probe', description: 'Rabe probe: what the mod engine sees', immediate: true })
      await $.command.register({ name: 'probe-plain', description: 'Rabe probe, second command', immediate: true })
    } catch {}
    return next(e)
  })

  on('session.attach', { surface: /^/ }, async ($, e, next) => {
    p.attached.push(e.surface)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    try {
      const n = (p.renders[e.surface] ?? 0) + 1
      p.renders[e.surface] = n
      const { Text } = $.ui.resolve(e)
      return Text({ children: `probe: render ${n} on ${e.surface}` })
    } catch {
      return next(e)
    }
  })

  on('command.run', { command: 'probe' }, async $ => answer($))
  on('command.run', { command: 'probe-plain' }, async $ => answer($))
}
