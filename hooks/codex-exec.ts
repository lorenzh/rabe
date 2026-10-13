import { lex, type Tok, type Word } from './shell-words'

export type CodexExec = { resultPath?: string; isDetached: boolean }

const isWord = (tok: Tok | undefined): tok is Word => tok !== undefined && 'text' in tok
const STARTS = /^(nohup|setsid|exec|command|time|env)$/
const ENDS = new Set([';', '&&', '||', '|', '&', 'stop'])
const SEPARATORS = new Set([';', '&&', '||', '|', '|&', '&', '(', '\n'])
const ENV_ARG = /^(-[uC]|--unset|--chdir)$/
// env runs no command after these, or splits a string Rabe does not follow.
const ENV_NONE = /^(--help|--version|--split-string|-[^-]*S)/

// The index of the first `codex exec` in command position: after the line
// start or a separator, only unquoted assignments and start words before it;
// after `env` also its options and quoted assignments; `env --help` and
// the like are none. One pass, so long lines stay fast.
function commandAt(toks: Tok[]): number {
  let command = true
  let env = false
  let options = false
  let skip = false
  for (const [i, tok] of toks.entries()) {
    if (!isWord(tok)) {
      command = SEPARATORS.has(tok.op)
      env = false
      options = false
      skip = false
      continue
    }
    if (!command) continue
    if (skip) {
      skip = false
      continue
    }
    const next = toks[i + 1]
    if (/(^|\/)codex$/.test(tok.text) && isWord(next) && next.text === 'exec') return i
    if (/^[A-Za-z_]\w*=/.test(env ? tok.text : tok.raw)) {
      options = false
      continue
    }
    if (options && tok.text.startsWith('-')) {
      if (ENV_NONE.test(tok.text)) return -1
      options = tok.text !== '--'
      skip = ENV_ARG.test(tok.text)
    } else if (STARTS.test(tok.text)) {
      env = tok.text === 'env'
      options = env
    } else command = false
  }
  return -1
}

// A `codex exec` call in a command line: the absolute file named by `-o`, and
// whether a `&` ends it, which leaves it running once the call returns. Only
// a command word counts, so `echo codex exec` and the companion are none.
export function codexExec(command: string, home?: string): CodexExec | undefined {
  const toks = lex(command, home)
  if (!toks) return undefined
  const at = commandAt(toks)
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
