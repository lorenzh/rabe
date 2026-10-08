import type { RabeTokens } from '../model'
import { parseLines, type ToolState } from './transcript'

export type CodexCommand = { command: string; state: ToolState; exitCode?: number; lines?: number }
export type CodexTurn = { text: string; reasoning?: string; commands: CodexCommand[] }
export type CodexLog = {
  model?: string
  effort?: string
  sandbox?: string
  tokens?: RabeTokens
  commandCount: number
  isComplete: boolean
  result?: string
  turns: CodexTurn[]
}

type Payload = {
  type?: string
  role?: string
  content?: unknown
  summary?: unknown
  call_id?: string
  model?: string
  effort?: string
  sandbox_policy?: { type?: string }
  input?: string
  item?: {
    type?: string
    command?: string[] | string
    exit_code?: number
    aggregated_output?: string
  }
  info?: {
    total_token_usage?: {
      input_tokens?: number
      output_tokens?: number
      cached_input_tokens?: number
    }
  }
  last_agent_message?: string
}

function scriptCommand(input = ''): string {
  const match = /cmd:"((?:[^"\\]|\\.)*)"/.exec(input)
  if (!match) return 'command'
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1] ?? 'command'
  }
}

function texts(parts: unknown): string[] {
  return (Array.isArray(parts) ? parts : []).flatMap(part =>
    typeof part?.text === 'string' ? [part.text] : [],
  )
}

export function parseCodex(text: string): CodexLog {
  const log: CodexLog = { commandCount: 0, isComplete: false, turns: [] }
  const pending = new Map<string, string>()
  let reasoning: string | undefined
  const turn = () => {
    if (log.turns.length === 0) log.turns.push({ text: '', commands: [] })
    return log.turns.at(-1) as CodexTurn
  }
  for (const record of parseLines<{ type?: string; payload?: Payload }>(text)) {
    const type = record.type
    const p: Payload = record.payload && typeof record.payload === 'object' ? record.payload : {}
    if (type === 'turn_context') {
      log.model = p.model ?? log.model
      log.effort = p.effort ?? log.effort
      log.sandbox = p.sandbox_policy?.type ?? log.sandbox
    } else if (p.type === 'message' && p.role === 'assistant') {
      log.turns.push({
        text: texts(p.content).join(''),
        ...(reasoning && { reasoning }),
        commands: [],
      })
      reasoning = undefined
    } else if (p.type === 'reasoning') {
      reasoning = texts(p.summary).join('\n') || reasoning
    } else if (p.type === 'custom_tool_call') {
      pending.set(String(p.call_id), scriptCommand(p.input))
    } else if (p.type === 'custom_tool_call_output') {
      pending.delete(String(p.call_id))
    } else if (p.type === 'item_completed' && p.item?.type === 'CommandExecution') {
      const { command, exit_code: exitCode, aggregated_output: output = '' } = p.item
      const line = (Array.isArray(command) ? command.at(-1) : command) ?? 'command'
      const call = [...pending].find(([, one]) => one === line)?.[0]
      if (call !== undefined) pending.delete(call)
      turn().commands.push({
        command: line,
        state: exitCode === 0 ? 'ok' : 'error',
        exitCode,
        lines: output.split('\n').filter(Boolean).length,
      })
      log.commandCount += 1
    } else if (p.type === 'token_count' && p.info?.total_token_usage) {
      const usage = p.info.total_token_usage
      log.tokens = {
        input: usage.input_tokens ?? 0,
        output: usage.output_tokens ?? 0,
        cached: usage.cached_input_tokens,
      }
    } else if (p.type === 'task_complete') {
      log.isComplete = true
      log.result = p.last_agent_message
    }
  }
  if (!log.isComplete) {
    for (const command of pending.values()) {
      turn().commands.push({ command, state: 'running' })
      log.commandCount += 1
    }
  }

  return log
}
