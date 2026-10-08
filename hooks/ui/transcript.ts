export type ToolState = 'running' | 'ok' | 'error'
export type ClaudeTool = { name: string; target: string; state: ToolState }
export type ClaudeTurn = { text: string; tools: ClaudeTool[] }
export type ClaudeLog = { brief?: string; toolCount: number; turns: ClaudeTurn[] }

type Block = {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  is_error?: boolean
}
type Line = { type?: string; message?: { id?: string; content?: string | Block[] } }

export function parseLines<T>(text: string): T[] {
  const out: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {}
  }

  return out
}

export function firstLine(value: unknown): string {
  return typeof value === 'string' ? (value.split('\n')[0] ?? '') : ''
}

function target(input: Record<string, unknown> = {}): string {
  const value =
    input.file_path ??
    input.command ??
    input.pattern ??
    input.description ??
    input.url ??
    input.prompt

  return firstLine(value)
}

export function parseClaude(text: string): ClaudeLog {
  const log: ClaudeLog = { toolCount: 0, turns: [] }
  const byId = new Map<string, ClaudeTool>()
  for (const line of parseLines<Line>(text)) {
    const content = line.message?.content
    if (line.type === 'user') {
      if (log.brief === undefined && log.turns.length === 0) {
        const brief =
          typeof content === 'string' ? content : content?.find(b => b.type === 'text')?.text
        if (brief) log.brief = brief
      }
      for (const block of Array.isArray(content) ? content : []) {
        const tool = block.type === 'tool_result' ? byId.get(block.tool_use_id ?? '') : undefined
        if (tool) tool.state = block.is_error ? 'error' : 'ok'
      }
    }
    if (line.type !== 'assistant' || !Array.isArray(content)) continue
    const words = content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text)
      .join(' ')
    const tools = content.filter(b => b.type === 'tool_use')
    if (!words && tools.length === 0) continue
    let turn = log.turns.at(-1)
    if (words || !turn) {
      turn = { text: words, tools: [] }
      log.turns.push(turn)
    }
    for (const block of tools) {
      const tool: ClaudeTool = {
        name: block.name ?? 'tool',
        target: target(block.input),
        state: 'running',
      }
      byId.set(block.id ?? '', tool)
      turn.tools.push(tool)
      log.toolCount += 1
    }
  }

  return log
}
