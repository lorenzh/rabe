import { lex, type Tok, type Word } from './shell-words'

export type CodexExec = {
  resultPath?: string
  isDetached: boolean
  model?: string
  effort?: string
  sandbox?: string
  // The `-C` / `--cd` directory.
  dir?: string
  // An inline `CODEX_HOME=` before the call: the rollouts are not under `~/.codex`.
  hasCodexHome?: boolean
}

const isWord = (tok: Tok | undefined): tok is Word => tok !== undefined && 'text' in tok
const STARTS = /^(nohup|setsid|exec|command|time|env)$/
const ENDS = new Set([';', '&&', '||', '|', '|&', '&', ')', '\n', 'stop'])
const SEPARATORS = new Set([';', '&&', '||', '|', '|&', '&', '(', '\n'])
// The env options a launch may use; any other one (`--null`, `-S`, `--help`,
// ...) makes the line none, since env may then run no command. Conservative.
const ENV_FLAG = /^(-i|--ignore-environment|--unset=.+|--chdir=.+)$/
const ENV_ARG = /^(-[uC]|--unset|--chdir)$/

// The index of the first `codex exec` in command position: after the line
// start or a separator, only unquoted assignments and start words before it;
// after `env` also the allowed options and quoted assignments; any other
// env option makes the line none. One pass, so long lines stay fast.
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
      skip = ENV_ARG.test(tok.text)
      if (!skip && tok.text !== '--' && !ENV_FLAG.test(tok.text)) return -1
      options = tok.text !== '--'
    } else if (STARTS.test(tok.text)) {
      env = tok.text === 'env'
      options = env
    } else command = false
  }
  return -1
}

const MODEL = /^[A-Za-z0-9][\w.:-]*$/
const EFFORT = /^[a-z]+$/
const SANDBOX = /^[a-z][a-z-]*$/

// The value of a flag: `--name=value`, or the next word for `-s`/`--name`.
// Only a word without expansion counts. `long` forms may use `=`.
function flagValue(args: Tok[], names: RegExp, long: string): string | undefined {
  let found: string | undefined
  args.forEach((tok, i) => {
    if (!isWord(tok) || !tok.known) return
    const eq = tok.text.startsWith(`${long}=`) ? tok.text.slice(long.length + 1) : undefined
    if (eq !== undefined) {
      found = eq
      return
    }
    const next = args[i + 1]
    if (names.test(tok.text) && isWord(next) && next.known) found = next.text
    else if (names.test(tok.text)) found = undefined
  })

  return found
}

const allowed = (value: string | undefined, rule: RegExp) =>
  value !== undefined && rule.test(value) ? value : undefined

// The effort of `-c model_reasoning_effort=X` (also `--config`), TOML quotes removed.
function effortOf(args: Tok[]): string | undefined {
  let found: string | undefined
  args.forEach((tok, i) => {
    if (!isWord(tok) || !tok.known) return
    const next = args[i + 1]
    const config = /^--config=(.*)$/.exec(tok.text)?.[1]
    const word =
      config ??
      (/^(-c|--config)$/.test(tok.text) && isWord(next) && next.known ? next.text : undefined)
    const match = word && /^model_reasoning_effort=(.*)$/.exec(word)
    if (match) found = match[1]?.replace(/^(["'])(.*)\1$/, '$2')
  })

  return found
}

// A `codex exec` call in a command line: the absolute file named by `-o`,
// whether a `&` ends it, which leaves it running once the call returns, and
// its model, effort, sandbox and directory flags. Only a command word counts,
// so `echo codex exec` and the companion are none. A word with expansion, or a
// value that fails its allow-list, gives `undefined` for that field. A `-p`
// profile may set the model, so the model is then not known.

export function codexExec(command: string, home?: string): CodexExec | undefined {
  const toks = lex(command, home)
  if (!toks) return undefined
  const at = commandAt(toks)
  if (at < 0) return undefined
  const rest = toks.slice(at + 2)
  const end = rest.findIndex(tok => !isWord(tok) && ENDS.has(tok.op))
  const args = end < 0 ? rest : rest.slice(0, end)
  let resultPath: string | undefined
  const hasProfile = args.some(tok => isWord(tok) && /^(-p|--profile|--profile=.*)$/.test(tok.text))
  const model = hasProfile
    ? undefined
    : allowed(flagValue(args, /^(-m|--model)$/, '--model'), MODEL)
  const effort = allowed(effortOf(args), EFFORT)
  const sandbox = allowed(flagValue(args, /^(-s|--sandbox)$/, '--sandbox'), SANDBOX)
  const dirValue = flagValue(args, /^(-C|--cd)$/, '--cd')
  const dir = dirValue?.startsWith('/') ? dirValue : undefined
  let hasCodexHome = false
  for (let i = at - 1; i >= 0; i--) {
    const tok = toks[i]
    if (!tok) continue
    if (!isWord(tok)) {
      if (SEPARATORS.has(tok.op)) break
      continue
    }
    if (/^CODEX_HOME=/.test(tok.raw) || /^CODEX_HOME=/.test(tok.text)) hasCodexHome = true
  }
  args.forEach((tok, i) => {
    if (!isWord(tok)) return
    const value = tok.known ? /^--output-last-message=(.+)$/.exec(tok.text)?.[1] : undefined
    const word = value ?? (/^(-o|--output-last-message)$/.test(tok.text) ? args[i + 1] : undefined)
    const path =
      typeof word === 'string' ? word : isWord(word) && word.known ? word.text : undefined
    if (path?.startsWith('/')) resultPath = path
  })
  // A `&` right after the call, or after the `)` of a group around it (past
  // redirects and further `)`), detaches it. Inside a group the other ends
  // and newlines do not leave it, so the scan goes on to its `)`.
  let depth = 0
  for (const tok of toks.slice(0, at)) {
    if (!isWord(tok) && tok.op === '(') depth++
    else if (!isWord(tok) && tok.op === ')') depth = Math.max(0, depth - 1)
  }
  let nested = 0
  let closed = true
  let isDetached = false
  for (const tok of end < 0 ? [] : rest.slice(end)) {
    if (isWord(tok)) continue
    if (tok.op === '(') {
      nested++
      closed = false
    } else if (tok.op === ')') {
      closed = nested === 0 && depth > 0
      if (closed) depth--
      else nested = Math.max(0, nested - 1)
    } else if (ENDS.has(tok.op)) {
      if (tok.op === '&' && closed) isDetached = true
      if (isDetached || depth === 0) break
      closed = false
    }
  }

  return {
    ...(resultPath && { resultPath }),
    isDetached,
    ...(model && { model }),
    ...(effort && { effort }),
    ...(sandbox && { sandbox }),
    ...(dir && { dir }),
    ...(hasCodexHome && { hasCodexHome }),
  }
}
