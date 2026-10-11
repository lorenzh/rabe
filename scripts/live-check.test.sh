#!/usr/bin/env bash
# Checks the argument handling of live-check.sh. It never starts tmux or Claude Code.
set -u
script="$(dirname "$0")/live-check.sh"
failed=0

check() { # name, wanted exit code, wanted output regex, args...
  local name=$1 code=$2 want=$3 out got
  shift 3
  out=$(bash "$script" "$@" 2>&1)
  got=$?
  if [ "$got" != "$code" ] || ! grep -Eq -- "$want" <<<"$out"; then
    echo "FAIL $name: exit $got, output:"
    sed 's/^/  /' <<<"$out"
    failed=1
  else
    echo "ok   $name"
  fi
}

check 'help exits 0 with usage' 0 '^Usage: ' --help
check 'dry run shows the defaults' 0 'socket: rabe-live.*' --dry-run
check 'dry run shows three shells by default' 0 'shells: 3$' --dry-run
check 'dry run shows the plugin dir as the repo' 0 "plugin: $(cd "$(dirname "$0")/.." && pwd)\$" --dry-run
check 'options reach the plan' 0 'keys: Down Down Enter$' --dry-run --name t1 --keys 'Down Down Enter' --gap 0.05 --repeat 4 --shells 0
check 'repeat reaches the plan' 0 'repeat: 4$' --dry-run --repeat 4
check 'expect reaches the plan' 0 'expect: ▶ sleep$' --dry-run --expect '▶ sleep'
check 'size reaches the plan' 0 'size: 160x50$' --dry-run --size 160x50
check 'an unknown option fails' 2 'unknown option: --nope' --nope
check 'a missing value fails' 2 'needs a value' --keys
check 'shells must be a number' 2 '--shells' --shells many
check 'repeat must be at least 1' 2 '--repeat' --repeat 0
check 'gap must be a number' 2 '--gap' --gap soon
check 'size must be COLSxROWS' 2 '--size' --size big
check 'name must be a plain word' 2 '--name' --name 'a b'
check 'plugin dir must exist' 2 '--plugin-dir' --plugin-dir /nonexistent/rabe

exit $failed
