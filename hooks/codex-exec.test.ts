import { expect, test } from 'claude-code/testing'
import { codexExec } from './codex-exec'

test('a command without codex exec is none', () => {
  expect(codexExec('ls -la')).toBeUndefined()
  expect(codexExec('node codex-companion.mjs task "x"')).toBeUndefined()
  expect(codexExec('echo codex exec')).toBeUndefined()
})

test('a foreground codex exec has no detached flag', () => {
  expect(codexExec('codex exec -m gpt-5.5 -o /tmp/r.txt - < /tmp/b.md')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: false,
  })
})

test('a codex exec run with nohup and & is detached', () => {
  expect(
    codexExec(
      'cd /x && setsid nohup codex exec -s read-only --output-last-message /tmp/r.txt - < b > l 2>&1 &',
    ),
  ).toEqual({ resultPath: '/tmp/r.txt', isDetached: true })
  expect(codexExec('nohup codex exec --output-last-message=/tmp/r.txt - &')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: true,
  })
})

test('a detached run without a result file has none', () => {
  expect(codexExec('codex exec x &')).toEqual({ isDetached: true })
})

test('the home folder expands in a result path', () => {
  expect(codexExec('codex exec -o ~/r.txt x &', '/home/me')?.resultPath).toBe('/home/me/r.txt')
})

test('an expanded --output-last-message= path is no result path', () => {
  expect(codexExec('codex exec --output-last-message="/tmp/$RESULT" x &')).toEqual({
    isDetached: true,
  })
  expect(codexExec('codex exec --output-last-message "/tmp/$RESULT" x &')).toEqual({
    isDetached: true,
  })
  expect(codexExec('codex exec -o "/tmp/$RESULT" x &')).toEqual({ isDetached: true })
})

test('codex as an argument of another command is none', () => {
  expect(codexExec('printf "value=" codex exec -o /tmp/fake.txt x &')).toBeUndefined()
  expect(codexExec('echo a=1 codex exec -o /tmp/fake.txt x &')).toBeUndefined()
  expect(codexExec('echo codex exec -o /tmp/fake.txt x &')).toBeUndefined()
})

test('assignments and start words before codex keep it a command', () => {
  const run = { resultPath: '/tmp/r.txt', isDetached: true }
  expect(codexExec('A=1 codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec('env A=1 codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec('cd /x && A=1 B=2 nohup codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec('true; setsid codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec('ls\nnohup codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec('(nohup codex exec -o /tmp/r.txt x &)')?.resultPath).toBe('/tmp/r.txt')
})
