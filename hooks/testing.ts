import type { On } from 'claude-code'

import { byteLength } from './reading'

export type Held = Record<string, { value: unknown; version: number }>

// The test's `$` has no state noun: tests answer `$.state` from memory and read
// what the plugin wrote from the returned record, keyed `plugin.key`.
export function memoryState(on: On): Held {
  const held: Held = {}
  on('state.get', async (_$, e) => ({
    value: held[`${e.plugin}.${e.key}`] ?? { value: undefined, version: 0 },
  }))
  on('state.set', async (_$, e) => {
    const name = `${e.plugin}.${e.key}`
    const version = held[name]?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false as const, version } }
    }
    held[name] = { value: e.value, version: version + 1 }

    return { value: { isSet: true as const, version: version + 1 } }
  })

  return held
}

export function files(on: On, held: Record<string, string>, log?: string[]): void {
  on('fs.stat', async (_$, e, next) => {
    const isFile = e.path in held
    const isDir = Object.keys(held).some(path => path.startsWith(`${e.path}/`))
    return isFile || isDir
      ? {
          value: {
            kind: isFile ? ('file' as const) : ('dir' as const),
            size: byteLength(held[e.path] ?? ''),
            mtimeMs: 0,
            isLink: false,
            ...(e.resolve && { realPath: e.path }),
          },
        }
      : next(e)
  })
  on('fs.read', { path: /^/ }, async (_$, e, next) => {
    if (!(e.path in held)) return next(e)
    log?.push(`read ${e.path}`)
    return { value: held[e.path] ?? '' }
  })
  on('process.run', { argv: ['ls', 'tail'] }, async (_$, e, next) => {
    const path = e.argv.at(-1) ?? ''
    const text = held[path]
    if (text === undefined) return next(e)
    if (e.argv[0] === 'ls')
      return { value: { exitCode: 0, stdout: '1 file\n', stderr: '' } } as never
    if (e.argv[0] !== 'tail') return next(e)
    log?.push(`tail ${e.argv[2]} ${path}`)
    const offset = Number(String(e.argv[2]).slice(1)) - 1
    let bytes = 0
    let stdout = ''
    for (const char of text) {
      if (bytes >= offset) stdout += char
      bytes += byteLength(char)
    }
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } } as never
  })
}

export function core(on: On): void {
  on('prompt.submit', async (_$, e) => ({ text: e.text, context: e.context }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('classic.Stop', async () => ({}))
}

// One ended shell over the cap and a recorded diff for it and for the next:
// the first write that caps the list evicts shell:old0 and only its diffs go.
export function overCap(max: number): { items: unknown[]; diffs: Record<string, unknown[]> } {
  const diff = (path: string) => [{ path, at: 1, lines: ['+x'], added: 1, removed: 0, hunks: 1 }]

  return {
    items: Array.from({ length: max + 1 }, (_, n) => ({
      id: `shell:old${n}`,
      kind: 'shell',
      title: `old${n}`,
      status: 'done',
      seenAt: 10 + n,
      endedAt: 10 + n,
      detail: { command: `old${n}` },
    })),
    diffs: { 'shell:old0': diff('/a'), 'shell:old1': diff('/b') },
  }
}
