// Fails when the write/forget blocks of the sources drift apart.
// The engine rule forbids sharing them, so agents.ts is the reference copy.
import { readFileSync } from 'node:fs'

const files = ['agents', 'codex', 'shells', 'monitors', 'workflows', 'crons']

export function block(text: string): string {
  const start = text.indexOf('async function write(')
  const forget = text.indexOf('async function forget(', start)
  if (start < 0 || forget < 0) return ''
  const end = text.indexOf('\n}\n', forget)
  return text
    .slice(start, end + 3)
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

if (import.meta.main) {
  const read = (name: string) => block(readFileSync(`hooks/sources/${name}.ts`, 'utf8'))
  const ref = read('agents')
  const bad = ref ? files.filter(name => read(name) !== ref) : files
  if (bad.length) {
    console.error(`write/forget blocks differ from agents.ts in: ${bad.join(', ')}`)
    process.exit(1)
  }
}
