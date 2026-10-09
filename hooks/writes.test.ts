import { expect, test } from 'claude-code/testing'

import { shellWrites } from './writes'

const HOME = '/home/u'
const paths = (command: string, cwd?: string) =>
  shellWrites(command, cwd, HOME).map(one => (one.isDeleted ? `-${one.path}` : one.path))

test('a here-doc into a file under the home folder, as in issue 9', () => {
  const command = [
    'mkdir -p ~/.agents/skills/demo/references',
    "cat > ~/.agents/skills/demo/SKILL.md <<'EOF'",
    '---',
    'name: demo',
    '---',
    'Use > and >> freely here; echo x > not-a-file.md',
    'EOF',
    'cat > ~/.agents/skills/demo/references/notes.md << "END"',
    'body',
    'END',
  ].join('\n')
  expect(paths(command)).toEqual([
    '/home/u/.agents/skills/demo/SKILL.md',
    '/home/u/.agents/skills/demo/references/notes.md',
  ])
})

test('redirections: > and >> write; stderr, dups and /dev targets do not', () => {
  expect(paths('echo x > a.txt; echo y >> /tmp/b.txt')).toEqual(['a.txt', '/tmp/b.txt'])
  expect(paths('make 2> err.log >&2 2>&1')).toEqual([])
  expect(paths('bun test &> /dev/null; ls > /dev/stderr')).toEqual([])
  expect(paths('bun test &> /tmp/all.log')).toEqual(['/tmp/all.log'])
  expect(paths('echo x 1>/tmp/one >|/tmp/two')).toEqual(['/tmp/one', '/tmp/two'])
  expect(paths('cat <<<"a > b" < in.txt')).toEqual([])
  expect(paths('cat <<-EOF > /tmp/t\n\tbody > x\n\tEOF\necho done > /tmp/u')).toEqual([
    '/tmp/t',
    '/tmp/u',
  ])
})

test('quotes, escapes and comments', () => {
  expect(paths(`echo "a > b" > '/tmp/my file.md'`)).toEqual(['/tmp/my file.md'])
  expect(paths('echo a\\ b > /tmp/x\\ y')).toEqual(['/tmp/x y'])
  expect(paths('echo hi # > /tmp/no')).toEqual([])
  expect(paths('echo x > "$OUT/f"; echo y > `pwd`/g; echo z > $(mktemp)')).toEqual([])
})

test('tee, sed -i, touch', () => {
  expect(paths('ls | tee -a /tmp/a /tmp/b | tee - >/dev/null')).toEqual(['/tmp/a', '/tmp/b'])
  expect(paths("sed -i 's/a/b/' /tmp/x /tmp/y")).toEqual(['/tmp/x', '/tmp/y'])
  expect(paths("sed -i.bak -e 's/a/b/' -e 's/c/d/' /tmp/x")).toEqual(['/tmp/x'])
  expect(paths("sed -i '' 's/a/b/' /tmp/mac")).toEqual(['/tmp/mac'])
  expect(paths("sed -n 's/a/b/p' /tmp/x")).toEqual([])
  expect(paths('touch -d yesterday /tmp/t1 /tmp/t2')).toEqual(['/tmp/t1', '/tmp/t2'])
})

test('cp, mv, install and ln write their destination; mv and rm delete', () => {
  expect(paths('cp -r src/a.md /tmp/b.md')).toEqual(['/tmp/b.md'])
  expect(paths('cp a.md b.md /tmp/out')).toEqual(['/tmp/out/a.md', '/tmp/out/b.md'])
  expect(paths('cp /x/a.md /tmp/out/')).toEqual(['/tmp/out/a.md'])
  expect(paths('cp -t /tmp/out /x/a.md')).toEqual(['/tmp/out/a.md'])
  expect(paths('mv /tmp/old.md /tmp/new.md')).toEqual(['-/tmp/old.md', '/tmp/new.md'])
  expect(paths('install -m 644 bin/rabe /usr/local/bin/rabe')).toEqual(['/usr/local/bin/rabe'])
  expect(paths('install -d /tmp/dir')).toEqual([])
  expect(paths('ln -sf /opt/tool /tmp/link')).toEqual(['/tmp/link'])
  expect(paths('rm -f /tmp/gone.txt')).toEqual(['-/tmp/gone.txt'])
})

test('chains, prefixes and cd resolve relative paths against the cwd', () => {
  expect(paths('cd /tmp/w && echo x > a && cd sub; touch ../b ./c', '/repo')).toEqual([
    '/tmp/w/a',
    '/tmp/w/b',
    '/tmp/w/sub/c',
  ])
  expect(paths('echo x > out/a.md', '/repo')).toEqual(['/repo/out/a.md'])
  expect(paths('(cd /tmp && touch in) && touch out', '/repo')).toEqual(['/tmp/in', '/repo/out'])
  expect(paths('FOO=1 sudo tee /etc/x < /dev/null || nohup touch ~/y')).toEqual([
    '/etc/x',
    '/home/u/y',
  ])
  expect(paths('for f in a b; do echo x > /tmp/$f; done; if true; then touch /tmp/z; fi')).toEqual([
    '/tmp/z',
  ])
})

test('without a cwd relative paths stay relative; without a home ~ stays', () => {
  expect(paths('cd sub && echo x > a.md')).toEqual(['sub/a.md'])
  expect(shellWrites('touch ~/x').map(one => one.path)).toEqual(['~/x'])
})

test('reads, plain commands and broken input write nothing', () => {
  expect(paths('cat a.md | grep x; git status; bun test')).toEqual([])
  expect(paths("echo 'unterminated > x")).toEqual([])
  expect(paths('echo >')).toEqual([])
})

test('a path written twice is listed once, the last change winning', () => {
  expect(paths('touch /tmp/a; echo x >> /tmp/a; rm /tmp/a')).toEqual(['-/tmp/a'])
})
