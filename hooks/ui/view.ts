import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RenderSurface,
  TextProps,
} from 'claude-code'

import type { RabeFilter, RabeTab } from '../../types'
import type { RabeItem } from '../model'
import type { CodexLog } from './rollout'
import type { ClaudeLog } from './transcript'

export type Ui = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
}

export type Action =
  | { type: 'tab'; tab: RabeTab }
  | { type: 'filter'; filter: RabeFilter }
  | { type: 'page'; page: number }
  | { type: 'fold'; group: string }
  | { type: 'open'; id: string }
  | { type: 'query'; text: string }
  | { type: 'focus'; key: string }
  | { type: 'follow' }
  | { type: 'stop'; ids: string[] }
  | { type: 'delete'; id: string }
  | { type: 'copy'; text: string; surface: RenderSurface }
  | { type: 'message'; id: string; text: string }

export type View = {
  ui: Ui
  act: (action: Action) => void
  items: RabeItem[]
  now: number
  width: number
  rows: number
  isWide: boolean
  isFocused: boolean
}

export type ListState = {
  filter: RabeFilter
  query: string
  page: number
  folded: string[]
  selected?: RabeItem
}

export type Notice = { level: 'Error' | 'Warning'; text: string }

export type Loaded = {
  claude?: ClaudeLog
  codex?: CodexLog
  output?: string[]
  notice?: Notice
}

export function canStop(item: RabeItem): boolean {
  if (item.status !== 'running') return false
  if (item.kind === 'agent') return true
  if (item.kind === 'shell' || item.kind === 'monitor' || item.kind === 'workflow') {
    return item.detail.taskId !== undefined
  }

  return false
}

export function taskIdOf(item: RabeItem): string | undefined {
  if (item.kind === 'agent') return item.detail.agentId
  if (item.kind === 'shell' || item.kind === 'monitor' || item.kind === 'workflow') {
    return item.detail.taskId
  }

  return undefined
}
