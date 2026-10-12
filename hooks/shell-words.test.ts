import { expect, test } from 'claude-code/testing'
import { lex } from './shell-words'

test('shell words omit heredoc contents and preserve quoted literal paths', () => {
  const toks = lex("cat <<EOF\ntouch hidden\nEOF\ntouch 'a b'")
  expect(toks?.filter(one => !('op' in one)).map(one => ('text' in one ? one.text : ''))).toEqual([
    'cat',
    'touch',
    'a b',
  ])
  expect(lex("touch 'unfinished")).toBe(undefined)
})
