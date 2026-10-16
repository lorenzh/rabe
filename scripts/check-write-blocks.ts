// Fails when the write/forget blocks of the sources drift apart.
// The engine rule forbids sharing them, so agents.ts is the reference copy.
import { readFileSync } from 'node:fs'
import { block } from './write-block'

const files = ['agents', 'codex', 'shells', 'monitors', 'workflows', 'crons']

if (import.meta.main) {
  const read = (name: string) => block(readFileSync(`hooks/sources/${name}.ts`, 'utf8'))
  const ref = read('agents')
  const bad = ref ? files.filter(name => read(name) !== ref) : files
  if (bad.length) {
    console.error(`write/forget blocks differ from agents.ts in: ${bad.join(', ')}`)
    process.exit(1)
  }
}
