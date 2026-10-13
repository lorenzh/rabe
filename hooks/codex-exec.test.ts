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

test('env with options and quoted assignments before codex keeps it a command', () => {
  const run = { resultPath: '/tmp/r.txt', isDetached: true }
  expect(codexExec('env -i A=1 codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec('env "A=1" codex exec -o /tmp/r.txt x &')).toEqual(run)
  expect(codexExec("env -u HOME -C /x -- 'A=1' codex exec -o /tmp/r.txt x &")).toEqual(run)
  expect(codexExec('printf "value=" codex exec -o /tmp/r.txt x &')).toBeUndefined()
  expect(codexExec('"A=1" codex exec -o /tmp/r.txt x &')).toBeUndefined()
})

test('long runs of assignments, env words and quotes stay fast', () => {
  for (const unit of ['A=1 ', 'env ', '"A=1" ', 'codex exec ', "env -u 'x' "]) {
    const line = `${unit.repeat(Math.ceil(100_000 / unit.length))}codex exec -o /tmp/r.txt x &`
    codexExec(line) // warm-up: the first call also pays for compiling the lexer
    const started = Date.now()
    codexExec(line)
    expect(Date.now() - started).toBeLessThan(200)
  }
})

test('env options that run no command, or that Rabe cannot follow, are no launch', () => {
  expect(codexExec('env --help codex exec -o /tmp/never.txt x &')).toBeUndefined()
  expect(codexExec('env --version codex exec -o /tmp/never.txt x &')).toBeUndefined()
  expect(codexExec("env -S 'A=1 codex' exec -o /tmp/never.txt x &")).toBeUndefined()
  expect(codexExec('env --split-string=x codex exec -o /tmp/never.txt x &')).toBeUndefined()
  expect(codexExec('env -- codex exec -o /tmp/r.txt x &')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: true,
  })
  expect(codexExec('env -- --help codex exec -o /tmp/r.txt x &')).toBeUndefined()
})

test('after env only the allowed options keep a launch', () => {
  const run = { resultPath: '/tmp/r.txt', isDetached: true }
  for (const line of [
    'env -i A=1 codex exec -o /tmp/r.txt x &',
    'env --ignore-environment codex exec -o /tmp/r.txt x &',
    'env -u A codex exec -o /tmp/r.txt x &',
    'env --unset A --unset=B codex exec -o /tmp/r.txt x &',
    'env -C /x --chdir /y --chdir=/z codex exec -o /tmp/r.txt x &',
    'env -- codex exec -o /tmp/r.txt x &',
    'nohup env A=1 codex exec -o /tmp/r.txt x &',
    'A=1 env B=2 codex exec -o /tmp/r.txt x &',
  ]) {
    expect(codexExec(line)).toEqual(run)
  }
  for (const line of [
    'env --null codex exec -o /tmp/never.txt x &',
    'env -0 codex exec -o /tmp/never.txt x &',
    'env -v codex exec -o /tmp/never.txt x &',
    'env --debug codex exec -o /tmp/never.txt x &',
    'env --help codex exec -o /tmp/never.txt x &',
    'env --version codex exec -o /tmp/never.txt x &',
    "env -S 'A=1 codex' exec -o /tmp/never.txt x &",
    'env -P /bin codex exec -o /tmp/never.txt x &',
    'env -iu A codex exec -o /tmp/never.txt x &',
    'env --unknown codex exec -o /tmp/never.txt x &',
  ]) {
    expect(codexExec(line)).toBeUndefined()
  }
})

test('a newline ends the codex exec command', () => {
  expect(codexExec('codex exec x\necho -o /tmp/fake.txt &')).toEqual({ isDetached: false })
  expect(codexExec('codex exec -o /tmp/r.txt x\necho y &')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: false,
  })
})

test('|& ends the codex exec command', () => {
  expect(codexExec('codex exec x |& cat -o /tmp/fake.txt &')).toEqual({ isDetached: false })
  expect(codexExec('codex exec -o /tmp/r.txt x |& tee l')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: false,
  })
})

test('a closing ) ends the codex exec command and a & after it detaches', () => {
  expect(codexExec('(codex exec x); echo -o /tmp/fake.txt &')).toEqual({ isDetached: false })
  expect(codexExec('(codex exec -o /tmp/r.txt x) &')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: true,
  })
  expect(codexExec('(codex exec -o /tmp/r.txt x)')).toEqual({
    resultPath: '/tmp/r.txt',
    isDetached: false,
  })
})
