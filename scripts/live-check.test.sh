#!/usr/bin/env bash
# Checks live-check.sh: its arguments, and its run against a fake tmux.
# It never starts the real tmux or Claude Code.
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
check 'timeout reaches the plan' 0 'timeout: 30$' --dry-run --timeout 30
check 'timeout must be a number' 2 '--timeout' --timeout soon

# A fake tmux: its pane is a loop that starts the shells the seed prompt names,
# as Claude Code would. Each seed also starts a shell with the same duration
# outside the pane, as a second run would; cleanup must leave that one alone.
real_sleep=$(command -v sleep)
fake=$(mktemp -d)
trap 'rm -rf "$fake"' EXIT
mkdir "$fake/bin"
cat >"$fake/bin/tmux" <<'EOF'
#!/usr/bin/env bash
shift 2
cmd=$1
shift
case $cmd in
  has-session) exit 1 ;;
  new-session)
    [ "${FAKE_NEW:-}" = fail ] && exit 1
    nohup bash -c 'while :; do
      if [ -f "$0/spawn" ]; then
        for d in $(cat "$0/spawn"); do
          (exec -a sleep "$1" "$d") &
          echo $! >>"$0/seeded"
        done
        rm "$0/spawn"
      fi
      "$1" 0.1
    done' "$FAKE" "$REAL_SLEEP" >/dev/null 2>&1 &
    echo $! >"$FAKE/pane" ;;
  display-message) cat "$FAKE/pane" ;;
  send-keys)
    shift 2
    if [ "$1" = -l ]; then
      printf '%s\n' "$2" >>"$FAKE/screen"
      ds=$(grep -o 'sleep [0-9]*' <<<"$2" | cut -d' ' -f2 | tr '\n' ' ')
      if [ -n "$ds" ]; then
        set -- $ds
        (exec -a sleep "$REAL_SLEEP" "$1") >/dev/null 2>&1 &
        echo $! >"$FAKE/foreign"
        [ "${FAKE_SHELLS:-}" = none ] || echo "$ds" >"$FAKE/spawn"
      fi
    else
      printf '%s\n' "$1" >>"$FAKE/keys"
      # The focus ring walks FAKE_ROWS rows and FAKE_STOPS other stops (tabs,
      # controls) and wraps, as the engine does when the list fits. The marker
      # moves only when the ring lands on a row.
      if [ "$1" = Up ] && [ -n "${FAKE_ROWS:-}" ] && [ "${FAKE_UP:-}" != ignore ]; then
        read -r ring sel 2>/dev/null <"$FAKE/ring" || { ring=$FAKE_RING; sel=$FAKE_RING; }
        ring=$(((ring - 1 + FAKE_ROWS + FAKE_STOPS) % (FAKE_ROWS + FAKE_STOPS)))
        [ "$ring" -lt "$FAKE_ROWS" ] && sel=$ring
        echo "$ring $sel" >"$FAKE/ring"
      fi
    fi ;;
  capture-pane)
    [ "${FAKE_CAP:-}" = fail ] && exit 1
    cat "$FAKE/screen" 2>/dev/null
    printf '%s\n' "${FAKE_SCREEN:-}"
    if [ -n "${FAKE_ROWS:-}" ]; then
      read -r ring sel 2>/dev/null <"$FAKE/ring" || sel=$FAKE_RING
      echo "transcript │▾ SHELLS $FAKE_ROWS running"
      for i in $(seq 0 $((FAKE_ROWS - 1))); do
        [ "$i" = "$sel" ] && m=▌ || m=' '
        echo "           │$m▶ row $i"
      done
    fi ;;
  kill-server) kill "$(cat "$FAKE/pane")" 2>/dev/null ;;
esac
exit 0
EOF
printf '#!/bin/sh\nexec "$REAL_SLEEP" 0.02\n' >"$fake/bin/sleep"
chmod +x "$fake/bin/tmux" "$fake/bin/sleep"

alive() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null) && [[ $s != Z* ]]; }
dead() { local i; for i in 1 2 3 4 5 6 7 8 9 10; do alive "$1" || return 0; "$real_sleep" 0.1; done; return 1; }

# Runs `check` against the fake tmux. Leading NAME=VALUE words set the fake's
# environment; FAKE names its folder, which then holds pane, foreign and keys.
faked() {
  local vars=()
  while [[ $1 == *=* ]]; do vars+=("$1"); shift; done
  export FAKE=$fake/run
  rm -rf "$FAKE" "$fake/tmp"
  mkdir -p "$FAKE" "$fake/tmp"
  (
    export PATH="$fake/bin:$PATH" REAL_SLEEP=$real_sleep TMPDIR=$fake/tmp CLAUDE=true
    for v in "${vars[@]}"; do export "${v?}"; done
    check "$@"
    exit $failed
  ) || failed=1
}
stop() { local f; for f in pane foreign seeded; do [ -f "$FAKE/$f" ] && kill $(cat "$FAKE/$f") 2>/dev/null; done; }
expect() { # name, condition...
  local name=$1
  shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; failed=1; fi
}

faked FAKE_NEW=fail 'a failed session start is a setup error' 2 'could not start' --shells 0
stop
faked FAKE_CAP=fail 'a failed capture is a setup error' 2 'could not capture' --shells 0
stop
faked FAKE_SHELLS=none 'the seed waits for the shells, not the prompt text' 2 'did not start' \
  --shells 2 --timeout 20
stop
faked 'the seed passes once the shells run' 0 'round 1: captured' --shells 2 --timeout 50
all_dead() {
  local p
  [ -s "$FAKE/seeded" ] || return 1
  for p in $(cat "$FAKE/seeded"); do dead "$p" || return 1; done
}
expect 'cleanup stops the seeded shells' all_dead
expect 'cleanup leaves a shell of another run alone' alive "$(cat "$FAKE/foreign")"
stop
faked FAKE_SCREEN='b: back' 'rounds run with a detail open' 0 'round 2: captured' --shells 0 --repeat 2
expect 'each round leaves the detail and goes to the first tab' \
  test "$(grep -c '^b$' "$FAKE/keys"):$(grep -c '^1$' "$FAKE/keys")" = 2:2
stop
# 22 Up presses on 4 rows and 3 other stops would wrap onto row 1.
faked FAKE_ROWS=4 FAKE_STOPS=3 FAKE_RING=2 'each round stops on the first row' 0 'round 2: pass' \
  --shells 2 --timeout 50 --repeat 2 --expect '│▌▶ row 0$'
expect 'the reset stops pressing once the first row shows' \
  test "$(grep -c '^Up$' "$FAKE/keys")" = 2
stop
faked FAKE_ROWS=4 FAKE_STOPS=3 FAKE_RING=2 FAKE_UP=ignore 'a first row that never shows is a setup error' 2 \
  'could not select the first row' --shells 0
stop

exit $failed
