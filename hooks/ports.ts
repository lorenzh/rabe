// Only pid and parent pid are needed; process arguments and environments stay private.
export function processTree(roots: number[], text: string): Set<number> {
  const tree = new Set(roots)
  const rows = text.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    return match ? [[Number(match[1]), Number(match[2])]] : []
  })
  let changed = true
  while (changed) {
    changed = false
    for (const [pid, parent] of rows) {
      if (pid !== undefined && parent !== undefined && tree.has(parent) && !tree.has(pid)) {
        tree.add(pid)
        changed = true
      }
    }
  }
  return tree
}

export function listeningPort(text: string, tree: Set<number>): number | undefined {
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] !== 'LISTEN') continue
    const port = Number(/:(\d+)$/.exec(fields[3] ?? '')?.[1])
    const owners = [...line.matchAll(/\bpid=(\d+)/g)].map(match => Number(match[1]))
    if (port > 0 && port <= 65535 && owners.length > 0 && owners.every(pid => tree.has(pid)))
      return port
  }
  return undefined
}
