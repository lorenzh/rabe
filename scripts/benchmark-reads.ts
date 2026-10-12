import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { byteLength, inodeOf, readChunk, readPlan, unchanged } from '../hooks/reading'
import { advanceRollout, type RolloutCursor } from '../hooks/sources/codex'
import type { RabeFileCursor } from '../types'

// Sparse history isolates warm reads without writing 10 GiB of old records.
const root = mkdtempSync(join(tmpdir(), 'rabe-read-bench-'))
const count = 200
const samples = 3
const record = `${JSON.stringify({
  type: 'response_item',
  payload: {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'x'.repeat(256) }],
  },
})}\n`
const rows: { mib: number; mode: string; milliseconds: number; bytes: number }[] = []

async function run(argv: string[]) {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  assert.equal(code, 0, stderr)
  return stdout
}

try {
  for (const mib of [1, 50]) {
    const paths = Array.from({ length: count }, (_, n) => join(root, `${n}.jsonl`))
    const cursors = new Map<string, RabeFileCursor>()
    const parsers = new Map<string, RolloutCursor>()
    for (const path of paths) {
      writeFileSync(path, '')
      truncateSync(path, mib * 1024 * 1024)
      const stat = statSync(path)
      const identity = inodeOf(await run(['ls', '-diL', '--', path]))
      cursors.set(path, {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        offset: stat.size,
        identity,
        partial: false,
      })
      parsers.set(path, advanceRollout(''))
    }
    for (const mode of ['unchanged', 'append']) {
      const durations: number[] = []
      let bytes = 0
      for (let sample = 0; sample < samples; sample++) {
        if (mode === 'append') for (const path of paths) appendFileSync(path, record)
        bytes = 0
        const start = performance.now()
        for (const path of paths) {
          const stat = statSync(path)
          const held = cursors.get(path)
          if (unchanged(stat, held) && held && (held.offset >= held.size || held.partial)) continue
          const identity = inodeOf(await run(['ls', '-diL', '--', path]))
          const stamp = { size: stat.size, mtimeMs: stat.mtimeMs, identity }
          const plan = readPlan(stamp, held, 4 * 1024 * 1024)
          if (!plan) continue
          const { offset } = plan
          const text = await run(['tail', '-c', `+${offset + 1}`, '--', path])
          bytes += byteLength(text)
          const chunk = readChunk(text, false, true)
          parsers.set(path, advanceRollout(chunk.text, parsers.get(path)))
          cursors.set(path, { ...stamp, offset: offset + chunk.bytes, partial: chunk.partial })
        }
        durations.push(performance.now() - start)
        assert.equal(bytes, mode === 'unchanged' ? 0 : count * byteLength(record))
      }
      durations.sort((a, b) => a - b)
      rows.push({ mib, mode, milliseconds: Number((durations[1] ?? 0).toFixed(1)), bytes })
    }
    for (const parser of parsers.values()) assert.equal(parser.out.steps.length, samples)
  }
  console.table(rows)
} finally {
  rmSync(root, { recursive: true, force: true })
}
