// The files a shell command line writes, guessed from its words: redirections,
// tee, sed -i, cp, mv, install, ln, touch and rm. What a program writes on its
// own (a script's open(..., 'w'), a build tool) does not show in the line.

export type ShellWrite = { path: string; isDeleted?: true }

type Word = { word: string; isDynamic: boolean }
type Tok = Word | { op: string; fd?: string }

const OPS = ['<<-', '&>>', '<<<', '&&', '||', '>>', '<<', '>|', '&>', '>&', '<&', ';;', '|&']
const WRITES = ['>', '>>', '>|', '&>', '&>>']
const READS = ['<', '<&', '>&', '<<<']
const PREFIXES = ['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'then', 'do', 'else']
const KEYWORDS = [...PREFIXES, 'if', 'elif', 'while', 'until', '!', '{']
const HEREDOC = /^[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s<>|&;()]+))/

function lex(src: string): Tok[] {
  const out: Tok[] = []
  const heredocs: { delim: string; strip: boolean }[] = []
  let word = ''
  let has = false
  let dyn = false
  let i = 0
  const flush = () => {
    if (has) out.push({ word, isDynamic: dyn })
    word = ''
    has = false
    dyn = false
  }
  // `$(…)` or `…`: kept in the word, which becomes dynamic.
  const nested = (open: string, close: string) => {
    let depth = 0
    let j = i
    for (; j < src.length; j++) {
      if (src[j] === open && (open !== close || j === i)) depth++
      else if (src[j] === close && --depth === 0) break
    }
    word += src.slice(i, j + 1)
    has = true
    dyn = true
    i = j + 1
  }
  while (i < src.length) {
    const c = src[i] as string
    if (c === '\\') {
      if (src[i + 1] !== '\n') {
        word += src[i + 1] ?? ''
        has = true
      }
      i += 2
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      const stop = end < 0 ? src.length : end
      word += src.slice(i + 1, stop)
      has = true
      i = stop + 1
    } else if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        const ch = src[i] as string
        if (ch === '\\' && '"\\$`'.includes(src[i + 1] ?? 'x')) {
          word += src[i + 1]
          i += 2
          continue
        }
        if (ch === '$' || ch === '`') dyn = true
        word += ch
        i++
      }
      has = true
      i++
    } else if (c === '$' && src[i + 1] === '(') {
      i++
      word += '$'
      nested('(', ')')
    } else if (c === '`') {
      nested('`', '`')
    } else if (c === '#' && !has) {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '\n') {
      flush()
      out.push({ op: ';' })
      i++
      for (const { delim, strip } of heredocs.splice(0)) {
        while (i < src.length) {
          const nl = src.indexOf('\n', i)
          const line = src.slice(i, nl < 0 ? src.length : nl)
          i = nl < 0 ? src.length : nl + 1
          if ((strip ? line.replace(/^\t+/, '') : line) === delim) break
        }
      }
    } else if (c === ' ' || c === '\t') {
      flush()
      i++
    } else if ('|&;()<>'.includes(c)) {
      const op = OPS.find(one => src.startsWith(one, i)) ?? c
      const fd = (c === '>' || c === '<') && has && !dyn && /^\d+$/.test(word) ? word : undefined
      if (fd) {
        word = ''
        has = false
      }
      flush()
      out.push(fd ? { op, fd } : { op })
      i += op.length
      if (op === '<<' || op === '<<-') {
        const match = HEREDOC.exec(src.slice(i))
        if (match) {
          heredocs.push({ delim: match[1] ?? match[2] ?? match[3] ?? '', strip: op === '<<-' })
          i += match[0].length
        }
      }
    } else {
      if (c === '$') dyn = true
      word += c
      has = true
      i++
    }
  }
  flush()

  return out
}

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

// `~` needs the home folder and a relative path the cwd; without them they stay.
function resolve(path: string, dir: string | undefined, home: string | undefined): string {
  if (path === '~' || path.startsWith('~/')) return home ? normalize(home + path.slice(1)) : path
  if (path.startsWith('/') || !dir) return normalize(path)

  return normalize(`${dir}/${path}`)
}

const basename = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? path

// The operands of a command and the values of its options; `valued` names the
// short options that take a value, `attached` those that take only an attached one.
function operands(args: Word[], valued: string, attached = '') {
  const files: Word[] = []
  const flags = new Set<string>()
  const values: Record<string, Word> = {}
  for (let k = 0; k < args.length; k++) {
    const arg = args[k] as Word
    const { word } = arg
    if (word === '--') {
      files.push(...args.slice(k + 1))
      break
    }
    if (arg.isDynamic || !word.startsWith('-') || word === '-') {
      files.push(arg)
      continue
    }
    if (word.startsWith('--')) {
      if (word.startsWith('--target-directory=')) {
        values.t = { word: word.slice('--target-directory='.length), isDynamic: false }
      }
      flags.add(word)
      continue
    }
    for (let n = 1; n < word.length; n++) {
      const flag = word[n] as string
      if (attached.includes(flag)) {
        flags.add(flag)
        break
      }
      if (!valued.includes(flag)) {
        flags.add(flag)
        continue
      }
      const rest = word.slice(n + 1)
      const value = rest ? { word: rest, isDynamic: false } : args[++k]
      if (value) values[flag] = value
      break
    }
  }

  return { files, flags, values }
}

// One simple command: the paths it writes go to `out`; answers the cwd after it.
function run(
  words: Word[],
  dir: string | undefined,
  home: string | undefined,
  out: Map<string, ShellWrite>,
): string | undefined {
  let start = 0
  while (
    start < words.length &&
    (KEYWORDS.includes(words[start]?.word ?? '') ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start]?.word ?? ''))
  )
    start++
  const [name, ...args] = words.slice(start)
  if (!name || name.isDynamic) return dir
  const at = (one: Word) => (one.isDynamic ? undefined : resolve(one.word, dir, home))
  const put = (path: string | undefined, isDeleted?: boolean) => {
    if (!path || path === '-' || path.startsWith('/dev/')) return
    out.delete(path)
    out.set(path, { path, ...(isDeleted && { isDeleted: true as const }) })
  }
  const command = basename(name.word)
  if (command === 'cd') {
    const target = args.find(one => !one.word.startsWith('-') || one.word === '-')
    if (!target) return home ?? dir
    return target.word === '-' ? undefined : at(target)
  }
  if (command === 'tee' || command === 'touch' || command === 'rm') {
    const { files } = operands(args, command === 'touch' ? 'dtr' : '')
    for (const file of files) put(at(file), command === 'rm')
  } else if (command === 'sed') {
    const nonEmpty = args.filter(one => one.word !== '')
    const { files, flags, values } = operands(nonEmpty, 'efl', 'i')
    if (!flags.has('i') && ![...flags].some(flag => flag.startsWith('--in-place'))) return dir
    for (const file of values.e || values.f ? files : files.slice(1)) put(at(file))
  } else if (['cp', 'mv', 'install', 'ln'].includes(command)) {
    const { files, flags, values } = operands(args, command === 'install' ? 'mogtS' : 'tS')
    if (command === 'install' && flags.has('d')) return dir
    const target = values.t
    const dest = target ?? files.at(-1)
    const sources = target ? files : files.slice(0, -1)
    if (!dest || sources.length === 0) return dir
    const intoDir = target || sources.length > 1 || dest.word.endsWith('/')
    for (const source of sources) {
      if (command === 'mv') put(at(source), true)
      if (!intoDir) continue
      const base = at(source) && basename(source.word)
      put(
        base && at({ word: `${dest.word.replace(/\/+$/, '')}/${base}`, isDynamic: dest.isDynamic }),
      )
    }
    if (!intoDir) put(at(dest))
  }

  return dir
}

export function shellWrites(command: string, cwd?: string, home?: string): ShellWrite[] {
  const out = new Map<string, ShellWrite>()
  const toks = lex(command)
  const dirs: (string | undefined)[] = []
  let dir = cwd
  let words: Word[] = []
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k] as Tok
    if ('word' in tok) {
      words.push(tok)
      continue
    }
    const next = toks[k + 1]
    const target = next && 'word' in next ? next : undefined
    if (WRITES.includes(tok.op)) {
      if (target) k++
      if (target && !target.isDynamic && (!tok.fd || tok.fd === '1')) {
        const path = resolve(target.word, dir, home)
        if (!path.startsWith('/dev/')) {
          out.delete(path)
          out.set(path, { path })
        }
      }
      continue
    }
    if (READS.includes(tok.op)) {
      if (target) k++
      continue
    }
    if (tok.op === '<<' || tok.op === '<<-') continue
    dir = run(words, dir, home, out)
    words = []
    if (tok.op === '(') dirs.push(dir)
    if (tok.op === ')') dir = dirs.length ? dirs.pop() : dir
  }
  run(words, dir, home, out)

  return [...out.values()]
}
