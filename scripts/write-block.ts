// Pure: the test imports this file, and the test sandbox allows no node:fs.
export function block(text: string): string {
  const start = text.indexOf('async function write(')
  const forget = text.indexOf('async function forget(', start)
  if (start < 0 || forget < 0) return ''
  const end = text.indexOf('\n}\n', forget)
  return stripComments(text.slice(start, end + 3))
}

// Strings and templates match first, so a `//` inside one stays.
// Regex literals are not handled; the blocks hold none.
export function stripComments(code: string): string {
  return code
    .replace(
      /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      m => (m[0] === '/' ? '' : m),
    )
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    .join('\n')
}
