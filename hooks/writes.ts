import type { FsStat } from 'claude-code'
import { lex, type Tok, type Word } from './shell-words'

// The files a shell command line may write or delete, read from its words: file
// redirections and a fixed table of commands. Candidates only: the caller
// checks each on disk.

type ShellWrite = { path: string; isDeleted?: true }

const REDIRECTS = new Set(['<', '>', '>>', '>|', '&>', '&>>', '>&', '<&', '<>', '<<', '<<-', '<<<'])
const WRITES = new Set(['>', '>>', '>|', '&>', '&>>'])
const STOPS = new Set(
  ['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'for', 'do', 'done', 'case', 'esac']
    .concat(['select', 'function', 'coproc', '{', '}', '[[', ']]', '!', '[', 'test', 'exit'])
    .concat(['return', 'exec', 'eval', 'source', '.', 'break', 'continue']),
)
const ASSIGN = /^[A-Za-z_]\w*\+?=/

function normalize(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..' && parts.length && parts.at(-1) !== '..') parts.pop()
    else if (seg !== '..' || !isAbsolute) parts.push(seg)
  }

  return (isAbsolute ? '/' : '') + (parts.join('/') || (isAbsolute ? '' : '.'))
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? path
const literal = (text: string): Word => ({
  text,
  raw: text,
  known: true,
  single: true,
  split: false,
  lead: text[0] ?? '',
})

// Short options in `flags` take no value, in `values` one, in `optional` an
// attached one only. Long options map to a key, with `=` for a value and `?`
// for an attached one only.
type Spec = { flags: string; values?: string; optional?: string; long?: Record<string, string> }

const SPECS: Record<string, Spec> = {
  rm: {
    flags: 'frRvd',
    long: { force: '-', recursive: '-', verbose: '-', dir: '-', 'one-file-system': '-' },
  },
  touch: {
    flags: 'acmhf',
    values: 'dtr',
    long: { date: '-=', reference: '-=', time: '-=', 'no-create': '-', 'no-dereference': '-' },
  },
  tee: { flags: 'aip', long: { append: '-', 'ignore-interrupts': '-', 'output-error': '-?' } },
  sed: {
    flags: 'nErsuz',
    values: 'efl',
    optional: 'i',
    long: {
      expression: 'e=',
      file: 'f=',
      'in-place': 'i?',
      quiet: '-',
      silent: '-',
      'regexp-extended': '-',
      separate: '-',
      unbuffered: '-',
      'null-data': '-',
      'line-length': '-=',
      posix: '-',
      'follow-symlinks': '-',
    },
  },
  cp: {
    flags: 'adfHlLPprRsTvxb',
    values: 'tS',
    long: {
      archive: '-',
      force: '-',
      link: '-',
      dereference: '-',
      'no-dereference': '-',
      preserve: '-?',
      'no-preserve': '-=',
      recursive: '-',
      'remove-destination': '-',
      'symbolic-link': '-',
      'target-directory': 't=',
      'no-target-directory': 'T',
      verbose: '-',
      'one-file-system': '-',
      suffix: '-=',
      backup: '-?',
      sparse: '-=',
      reflink: '-?',
      'strip-trailing-slashes': '-',
    },
  },
  mv: {
    flags: 'fvbT',
    values: 'tS',
    long: {
      force: '-',
      verbose: '-',
      'target-directory': 't=',
      'no-target-directory': 'T',
      suffix: '-=',
      backup: '-?',
      'strip-trailing-slashes': '-',
    },
  },
  install: {
    flags: 'bcCDpsvTd',
    values: 'mogtS',
    long: {
      mode: '-=',
      owner: '-=',
      group: '-=',
      'target-directory': 't=',
      'no-target-directory': 'T',
      directory: 'd',
      compare: '-',
      'preserve-timestamps': '-',
      strip: '-',
      verbose: '-',
      suffix: '-=',
      backup: '-?',
    },
  },
  ln: {
    flags: 'sfnvbrTLP',
    values: 'tS',
    long: {
      symbolic: '-',
      force: '-',
      'no-dereference': '-',
      verbose: '-',
      relative: '-',
      logical: '-',
      physical: '-',
      'target-directory': 't=',
      'no-target-directory': 'T',
      suffix: '-=',
      backup: '-?',
    },
  },
}

// Options and operands; undefined when an option is unknown or a word could
// turn into one.
function options(args: Word[], spec: Spec) {
  const opts = new Map<string, Word | true>()
  const files: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const arg = args[k] as Word
    if (arg.split) return
    if (arg.text === '--' && arg.known) {
      const rest = args.slice(k + 1)
      if (rest.some(one => one.split)) return
      files.push(...rest)
      break
    }
    if (arg.lead !== '-' || arg.text === '-') {
      if (arg.lead === '' && !(arg.known && arg.text === '')) return
      files.push(arg)
      continue
    }
    if (!arg.known) return
    if (arg.text.startsWith('--')) {
      const eq = arg.text.indexOf('=')
      const name = arg.text.slice(2, eq < 0 ? undefined : eq)
      const [key = '', kind = ''] = spec.long?.[name] ?? ''
      if (!key) return
      if (kind === '=') {
        const value = eq < 0 ? args[++k] : literal(arg.text.slice(eq + 1))
        if (!value?.single) return
        opts.set(key, value)
      } else if (kind === '?' || eq < 0) opts.set(key, true)
      else return
      continue
    }
    for (let n = 1; n < arg.text.length; n++) {
      const flag = arg.text[n] as string
      if (spec.optional?.includes(flag)) {
        opts.set(flag, true)
        break
      }
      if (spec.values?.includes(flag)) {
        const rest = arg.text.slice(n + 1)
        const value = rest ? literal(rest) : args[++k]
        if (!value?.single) return
        opts.set(flag, value)
        break
      }
      if (!spec.flags.includes(flag)) return
      opts.set(flag, true)
    }
  }

  return { opts, files }
}

type Target = [word: Word | undefined, isDeleted?: boolean]

// The files a command from the table writes, or none when its words leave doubt.
function targets(name: string, args: Word[]): Target[] {
  const spec = SPECS[name]
  if (!spec) return []
  const empty = args.findIndex(one => one.raw === '-i')
  const bsd = name === 'sed' && empty >= 0 && args[empty + 1]?.known && args[empty + 1]?.text === ''
  const parsed = options(bsd ? args.filter((_, n) => n !== empty + 1) : args, spec)
  if (!parsed) return []
  const { opts, files } = parsed
  if (name === 'rm') return files.map(one => [one, true])
  if (name === 'touch' || name === 'tee') return files.map(one => [one])
  if (name === 'sed') {
    if (!opts.has('i') || files.some(one => !one.single)) return []
    return (opts.has('e') || opts.has('f') ? files : files.slice(1)).map(one => [one])
  }
  if (files.some(one => !one.single) || (name === 'install' && opts.has('d'))) return []
  const dir = opts.get('t')
  const dest = dir === true ? undefined : (dir ?? files.at(-1))
  const sources = dir ? files : files.slice(0, -1)
  const whole = opts.has('T')
  if (!dest || !sources.length || (whole && (dir || sources.length > 1))) return []
  const into = !whole && (dir || sources.length > 1 || dest.text.endsWith('/'))
  // `cp a b` writes `b`, or `b/a` when `b` is a folder: both are candidates.
  const out: Target[] = into ? [] : [[dest]]
  for (const source of sources) {
    if (name === 'mv') out.push([source, true])
    const base = basename(source.text)
    if (whole || !source.known || !dest.known || /^\.{0,2}$/.test(base)) continue
    out.push([literal(`${dest.text.replace(/\/+$/, '')}/${base}`)])
  }

  return out
}

// A simple command after the redirections are taken out and the known
// prefixes unwrapped; 'stop' for a construct that can change what runs.
type Simple = { writes: Word[]; name?: string; args: Word[]; isLast?: true }

function simple(segment: Tok[]): Simple | 'stop' {
  const writes: Word[] = []
  const words: Word[] = []
  for (let k = 0; k < segment.length; k++) {
    const tok = segment[k] as Tok
    if (!('op' in tok)) words.push(tok)
    else if (tok.op !== '<<' && tok.op !== '<<-') {
      const target = segment[++k]
      if (!target || 'op' in target) return 'stop'
      if (WRITES.has(tok.op)) writes.push(target)
    }
  }
  let k = 0
  while (ASSIGN.test(words[k]?.raw ?? '')) k++
  for (;;) {
    const word = words[k]
    if (!word) return { writes, args: [] }
    if (STOPS.has(word.raw)) return 'stop'
    if (!word.known) return { writes, args: [], isLast: true }
    const raw = (n: number) => words[k + n]?.raw ?? ''
    const name = word.text
    k++
    if (name === 'builtin' || name === 'nohup') continue
    if (name === 'command' || name === 'time') {
      if (raw(0) === '-p') k++
    } else if (name === 'nice') {
      if (raw(0) === '-n') k += 2
      else if (/^(-n?\d+|--adjustment=\d+)$/.test(raw(0))) k++
    } else if (name === 'env') {
      while (/^(-i|-|--ignore-environment)$/.test(raw(0)) || ASSIGN.test(raw(0))) k++
    } else if (name === 'sudo') {
      while (raw(0).startsWith('-')) {
        if (!/^(-[EHnSkP]+|--)$/.test(raw(0))) return { writes, args: [] }
        k++
        if (raw(-1) === '--') break
      }
    } else if (name === 'rtk' && raw(0) === 'proxy') k++
    else {
      const command = /^(\/usr)?\/bin\/[^/]+$/.test(name) ? basename(name) : name
      return { writes, name: command, args: words.slice(k) }
    }
  }
}

type Run = { dir?: string; isLost: boolean; hasCd: boolean; home?: string; pending: ShellWrite[] }

function place(run: Run, text: string): string | undefined {
  if (text.startsWith('/')) return normalize(text)
  if (run.isLost) return
  return normalize(run.dir ? `${run.dir}/${text}` : text)
}

function put(run: Run, word: Word | undefined, isDeleted?: boolean) {
  if (!word?.known || word.text === '' || word.text === '-') return
  const path = place(run, word.text)
  if (!path || path === '/dev' || path.startsWith('/dev/')) return
  run.pending.push({ path, ...(isDeleted && { isDeleted: true as const }) })
}

// One pipeline; false when the rest of the line may not run as written.
function pipeline(run: Run, segments: Tok[][], isSure: boolean, isOrBranch: boolean): boolean {
  const commands = segments.map(simple)
  if (commands.some(one => one === 'stop')) return false
  const isPiped = commands.length > 1
  for (const command of commands as Simple[]) {
    for (const word of command.writes) put(run, word)
    const { name, args } = command
    if (name === 'cd' && !isPiped) {
      run.hasCd = true
      const target = args.length ? args[0] : run.home ? literal(run.home) : undefined
      const dir =
        args.length < 2 && target?.known && !target.text.startsWith('-') && place(run, target.text)
      run.dir = dir || run.dir
      run.isLost = !dir || !isSure || isOrBranch
    } else if (name === 'pushd' || name === 'popd') {
      if (!isPiped) run.isLost = true
    } else if (name && (!isPiped || name === 'tee')) {
      for (const [word, isDeleted] of targets(name, args)) put(run, word, isDeleted)
    }
  }

  return !commands.some(one => (one as Simple).isLast)
}

export function shellWrites(command: string, cwd?: string, home?: string): ShellWrite[] {
  try {
    // ponytail: a HOME assignment anywhere drops every `~`, not only the later ones
    return parse(command, cwd, /\bHOME=/.test(command) ? undefined : home)
  } catch {
    return []
  }
}

function parse(command: string, cwd?: string, home?: string): ShellWrite[] {
  const out = new Map<string, ShellWrite>()
  const toks = lex(command, home)
  if (!toks) return []
  const run: Run = { dir: cwd, isLost: false, hasCd: false, home, pending: [] }
  const commit = () => {
    for (const write of run.pending.splice(0)) {
      out.delete(write.path)
      out.set(write.path, write)
    }
  }
  let segments: Tok[][] = [[]]
  let isOrBranch = false
  let needsCommand = false
  for (let k = 0; k <= toks.length; k++) {
    const tok = toks[k] ?? { op: '\n' }
    const op = 'op' in tok ? tok.op : undefined
    if (op === undefined || REDIRECTS.has(op)) {
      segments.at(-1)?.push(tok)
      needsCommand = false
      continue
    }
    if (op === '\n' && needsCommand) continue
    if (op === '|' || op === '|&') {
      segments.push([])
      needsCommand = true
      continue
    }
    const isList = op === '&&' || op === ';' || op === '\n'
    const goes = (isList || op === '||') && pipeline(run, segments, op === '&&', isOrBranch)
    segments = [[]]
    if (goes && (isList || op === '||')) {
      needsCommand = op === '&&' || op === '||'
      if (op === '||') {
        isOrBranch = true
        if (run.hasCd) run.isLost = true
      } else if (op !== '&&') {
        commit()
        isOrBranch = false
        run.hasCd = false
      }
      continue
    }
    // A later `&` may put this whole list in the background.
    if (op !== '&' && !toks.slice(k + 1).some(one => 'op' in one && one.op === '&')) commit()
    break
  }

  return [...out.values()]
}

// What a path held: its stat, 'none' when it is not there, undefined when unknown.
export type Seen = Pick<FsStat, 'kind' | 'size' | 'mtimeMs'> | 'none' | undefined

// How a path changed between two looks: a file that is new or has another
// mtime or size is written; a path that is gone is deleted.
export function changed(before: Seen, after: Seen): 'write' | 'delete' | undefined {
  if (!before || !after) return
  if (after === 'none') return before === 'none' ? undefined : 'delete'
  if (after.kind !== 'file') return
  if (before === 'none' || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
    return 'write'
  }
}
