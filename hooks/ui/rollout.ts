import type { RabeTokens } from '../model'
import { parseLines, type ToolState } from './transcript'

export type CodexCommand = { command: string; state: ToolState; exitCode?: number; lines?: number }
export type CodexTurn = { text: string; commands: CodexCommand[] }
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
  content?: { text?: string }[]
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

export function parseCodex(text: string): CodexLog {
  const log: CodexLog = { commandCount: 0, isComplete: false, turns: [] }
  let pending: string | undefined
  const turn = () => {
    if (log.turns.length === 0) log.turns.push({ text: '', commands: [] })
    return log.turns.at(-1) as CodexTurn
  }
  for (const { type, payload: p = {} } of parseLines<{ type?: string; payload?: Payload }>(text)) {
    if (type === 'turn_context') {
      log.model = p.model ?? log.model
      log.effort = p.effort ?? log.effort
      log.sandbox = p.sandbox_policy?.type ?? log.sandbox
    } else if (p.type === 'message' && p.role === 'assistant') {
      log.turns.push({ text: (p.content ?? []).map(c => c.text ?? '').join(''), commands: [] })
    } else if (p.type === 'custom_tool_call') {
      pending = scriptCommand(p.input)
    } else if (p.type === 'custom_tool_call_output') {
      pending = undefined
    } else if (p.type === 'item_completed' && p.item?.type === 'CommandExecution') {
      const { command, exit_code: exitCode, aggregated_output: output = '' } = p.item
      turn().commands.push({
        command: (Array.isArray(command) ? command.at(-1) : command) ?? 'command',
        state: exitCode === 0 ? 'ok' : 'error',
        exitCode,
        lines: output.split('\n').filter(Boolean).length,
      })
      log.commandCount += 1
      pending = undefined
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
  if (pending !== undefined && !log.isComplete) {
    turn().commands.push({ command: pending, state: 'running' })
    log.commandCount += 1
  }

  return log
}
