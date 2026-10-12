// text: the value after quote removal. known: no expansion. single: one word
// after expansion. split: an unquoted expansion whose fields can be anything.
// lead: the first character when it is literal and cannot expand ('' if not).
export type Word = {
  text: string
  raw: string
  known: boolean
  single: boolean
  split: boolean
  lead: string
}
type Op = { op: string }
export type Tok = Word | Op

const OPS = [
  ';;&',
  '<<<',
  '<<-',
  '&>>',
  '&&',
  '||',
  ';;',
  ';&',
  '|&',
  '>>',
  '>|',
  '>&',
  '<&',
].concat(['<>', '<<', '&>', '|', '&', ';', '(', ')', '<', '>'])
const META = ' \t\n|&;()<>'

const PARAM = /[A-Za-z0-9_@*#?$!-]/
const MAX_DEPTH = 64

// Index after the `$(…)`, `${…}`, `` `…` ``, `<(…)` or `>(…)` that starts at i; -1 if it does not end.
function skipExpansion(src: string, i: number, depth: number): number {
  if (depth > MAX_DEPTH) return -1
  if (src[i] === '`') {
    for (let j = i + 1; j < src.length; j++) {
      if (src[j] === '\\') j++
      else if (src[j] === '`') return j + 1
    }
    return -1
  }
  const [open, close] = src[i + 1] === '{' ? ['{', '}'] : ['(', ')']
  let level = 1
  for (let j = i + 2; j < src.length; ) {
    const c = src[j]
    if (c === '\\') j += 2
    else if (c === "'") {
      j = src.indexOf("'", j + 1) + 1
      if (j === 0) return -1
    } else if (c === '$' && src[j + 1] === "'") {
      j = skipAnsi(src, j + 2)
      if (j < 0) return -1
    } else if (c === '"') {
      j = skipDouble(src, j + 1, depth + 1)
      if (j < 0) return -1
    } else if (c === '`' || (c === '$' && (src[j + 1] === '(' || src[j + 1] === '{'))) {
      j = skipExpansion(src, j, depth + 1)
      if (j < 0) return -1
    } else if (c === '#' && close === ')' && ' \t\n;(|&'.includes(src[j - 1] as string)) {
      j = src.indexOf('\n', j)
      if (j < 0) return -1
    } else {
      if (c === open) level++
      else if (c === close && --level === 0) return j + 1
      j++
    }
  }
  return -1
}

function skipDouble(src: string, j: number, depth: number): number {
  if (depth > MAX_DEPTH) return -1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') j += 2
    else if (c === '"') return j + 1
    else if (c === '`' || (c === '$' && (src[j + 1] === '(' || src[j + 1] === '{'))) {
      j = skipExpansion(src, j, depth + 1)
      if (j < 0) return -1
    } else j++
  }
  return -1
}

function skipAnsi(src: string, j: number): number {
  for (; j < src.length; j++) {
    if (src[j] === '\\') j++
    else if (src[j] === "'") return j + 1
  }
  return -1
}

// A top-level expansion; one that holds a here-doc or a case may end at the wrong `)`.
function expansion(src: string, i: number): number {
  const end = skipExpansion(src, i, 0)
  return end < 0 || /<<|\bcase\b/.test(src.slice(i, end)) ? -1 : end
}

// One word from i with bash quote removal; undefined when a quote or expansion does not end.
function readWord(
  src: string,
  start: number,
  home?: string,
): { word: Word; end: number } | undefined {
  let text = ''
  let known = true
  let single = true
  let split = false
  let lead: string | undefined
  const lit = (value: string) => {
    if (lead === undefined && value) lead = value[0]
    text += value
  }
  const dyn = (raw: string, kind: 'one' | 'many' | 'split') => {
    lead ??= ''
    known = false
    if (kind !== 'one') single = false
    if (kind === 'split') split = true
    text += raw
  }
  const param = (j: number) => {
    let end = j + 2
    if (/[A-Za-z_]/.test(src[j + 1] as string)) while (/\w/.test(src[end] ?? '')) end++
    return end
  }
  let i = start
  while (i < src.length && !META.includes(src[i] as string)) {
    const c = src[i] as string
    const next = src[i + 1] ?? ''
    if (c === '\\') {
      if (next !== '\n') lit(next)
      i += 2
    } else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      if (end < 0) return
      lit(src.slice(i + 1, end))
      i = end + 1
    } else if (c === '$' && next === "'") {
      const end = skipAnsi(src, i + 2)
      if (end < 0) return
      const body = src.slice(i + 2, end - 1)
      if (body.includes('\\')) dyn(body, 'one')
      else lit(body)
      i = end
    } else if (c === '$' && next === '"') {
      dyn('', 'one')
      i++
    } else if (c === '"') {
      i++
      for (;;) {
        const d = src[i]
        if (d === undefined) return
        if (d === '"') break
        if (d === '\\' && '$`"\\\n'.includes(src[i + 1] ?? 'x')) {
          if (src[i + 1] !== '\n') lit(src[i + 1] as string)
          i += 2
        } else if (d === '`' || (d === '$' && (src[i + 1] === '(' || src[i + 1] === '{'))) {
          const end = expansion(src, i)
          if (end < 0) return
          dyn(src.slice(i, end), src.slice(i, end).includes('[@]') ? 'split' : 'one')
          i = end
        } else if (d === '$' && PARAM.test(src[i + 1] ?? '')) {
          const end = param(i)
          dyn(src.slice(i, end), src[i + 1] === '@' ? 'split' : 'one')
          i = end
        } else {
          lit(d)
          i++
        }
      }
      i++
    } else if (c === '`' || (c === '$' && (next === '(' || next === '{'))) {
      const end = expansion(src, i)
      if (end < 0) return
      dyn(src.slice(i, end), 'split')
      i = end
    } else if (c === '$' && PARAM.test(next)) {
      const end = param(i)
      dyn(src.slice(i, end), 'split')
      i = end
    } else if (c === '~' && i === start && home && next === '/') {
      lit(home)
      i++
    } else if (c === '~' && i === start) {
      lit('~')
      known = false
      i++
    } else if ('*?[{}'.includes(c)) {
      dyn(c, 'many')
      i++
    } else {
      lit(c)
      i++
    }
  }
  const word = { text, raw: src.slice(start, i), known, single, split, lead: lead ?? '' }
  return { word, end: i }
}

// Words and operators; here-doc bodies and comments dropped. An unterminated
// here-doc cuts the list at its start and ends it with a `stop`.
export function lex(src: string, home?: string): Tok[] | undefined {
  const toks: Tok[] = []
  const docs: { delim: string; strip: boolean; at: number }[] = []
  const cut = (at: number) => {
    toks.length = at
    toks.push({ op: 'stop' })
    return toks
  }
  let i = 0
  while (i < src.length) {
    const c = src[i] as string
    if (c === ' ' || c === '\t') i++
    else if (c === '\\' && src[i + 1] === '\n') i += 2
    else if (c === '#') i = src.includes('\n', i) ? src.indexOf('\n', i) : src.length
    else if (c === '\n') {
      toks.push({ op: '\n' })
      i++
      for (const doc of docs.splice(0)) {
        let found = false
        while (i < src.length && !found) {
          const nl = src.indexOf('\n', i)
          const line = src.slice(i, nl < 0 ? src.length : nl)
          i = nl < 0 ? src.length : nl + 1
          found = (doc.strip ? line.replace(/^\t+/, '') : line) === doc.delim
        }
        if (!found) return cut(doc.at)
      }
    } else if ((c === '<' || c === '>') && src[i + 1] === '(') {
      let end = expansion(src, i)
      if (end < 0) return
      const rest = META.includes(src[end] ?? ' ') ? undefined : readWord(src, end, home)
      end = rest ? rest.end : end
      const raw = src.slice(i, end)
      toks.push({ text: raw, raw, known: false, single: true, split: false, lead: '' })
      i = end
    } else if (META.includes(c)) {
      const op = OPS.find(one => src.startsWith(one, i)) as string
      toks.push({ op })
      i += op.length
      if (op === '<<' || op === '<<-') {
        while (src[i] === ' ' || src[i] === '\t') i++
        const delim = META.includes(src[i] ?? ' ') ? undefined : readWord(src, i)
        if (!delim?.word.known || !delim.word.text) return
        docs.push({ delim: delim.word.text, strip: op === '<<-', at: toks.length - 1 })
        i = delim.end
      }
    } else {
      const read = readWord(src, i, home)
      if (!read) return
      i = read.end
      // A number right before `<` or `>` names a file descriptor, not an argument.
      if (!/^\d+$/.test(read.word.raw) || !'<>'.includes(src[i] ?? ' ')) toks.push(read.word)
    }
  }

  return docs[0] ? cut(docs[0].at) : toks
}
