import { lex, type Tok, type Word } from './shell-words'

export type CodexExec = { resultPath?: string; isDetached: boolean }

const isWord = (tok: Tok | undefined): tok is Word => tok !== undefined && 'text' in tok
const STARTS = /^(nohup|setsid|exec|command|time|env)$/
const ENDS = new Set([';', '&&', '||', '|', '&', 'stop'])
const SEPARATORS = new Set([';', '&&', '||', '|', '|&', '&', '(', '\n'])

// The words before `codex` back to the line start or a separator are only
// unquoted assignments and start words, so `codex` is the command word.
function inCommandPosition(toks: Tok[], at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const tok = toks[i] as Tok
    if (!isWord(tok)) return SEPARATORS.has(tok.op)
    if (!/^[A-Za-z_]\w*=/.test(tok.raw) && !STARTS.test(tok.text)) return false
  }
  return true
}

// A `codex exec` call in a command line: the absolute file named by `-o`, and
// whether a `&` ends it, which leaves it running once the call returns. Only
// a command word counts, so `echo codex exec` and the companion are none.
export function codexExec(command: string, home?: string): CodexExec | undefined {
  const toks = lex(command, home)
  if (!toks) return undefined
  const at = toks.findIndex((tok, i) => {
    const next = toks[i + 1]
    return (
      isWord(tok) &&
      /(^|\/)codex$/.test(tok.text) &&
      isWord(next) &&
      next.text === 'exec' &&
      inCommandPosition(toks, i)
    )
  })
  if (at < 0) return undefined
  const rest = toks.slice(at + 2)
  const end = rest.findIndex(tok => !isWord(tok) && ENDS.has(tok.op))
  const args = end < 0 ? rest : rest.slice(0, end)
  let resultPath: string | undefined
  args.forEach((tok, i) => {
    if (!isWord(tok)) return
    const value = tok.known ? /^--output-last-message=(.+)$/.exec(tok.text)?.[1] : undefined
    const word = value ?? (/^(-o|--output-last-message)$/.test(tok.text) ? args[i + 1] : undefined)
    const path =
      typeof word === 'string' ? word : isWord(word) && word.known ? word.text : undefined
    if (path?.startsWith('/')) resultPath = path
  })
  const stop = end < 0 ? undefined : rest[end]

  return {
    ...(resultPath && { resultPath }),
    isDetached: stop !== undefined && 'op' in stop && stop.op === '&',
  }
}
