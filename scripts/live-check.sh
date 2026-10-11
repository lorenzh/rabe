#!/usr/bin/env bash
# Live check of Rabe in a real Claude Code session, driven through tmux.
# See docs/testing.md.
set -u

usage() {
  cat <<'EOF'
Usage: scripts/live-check.sh [options]

Starts Claude Code with Rabe in a fresh temporary folder, on its own tmux
socket. Asks Claude to start background shells, opens /rabe, sends keys,
saves each screen and removes everything again.

Options:
  --name NAME        tmux socket and session name (default rabe-live)
  --plugin-dir DIR   the Rabe checkout to load (default this repo)
  --shells N         background shells to seed, 0 for none (default 3)
  --keys "K ..."     tmux key names to send after /rabe opens (default none)
  --gap SECONDS      pause between two keys (default 0.3)
  --repeat N         rounds of open, keys, capture, close (default 1)
  --expect REGEX     each capture must match this extended regex
  --size COLSxROWS   terminal size (default 120x40)
  --keep             keep the folder, the captures and the tmux session
  --dry-run          print the plan and stop
  -h, --help         show this help

Environment: CLAUDE names the Claude Code binary (default claude).
Exit codes: 0 all rounds passed, 1 a round failed, 2 usage or setup error.
EOF
}

fail() { echo "live-check: $*" >&2; exit 2; }

name=rabe-live
plugin=$(cd "$(dirname "$0")/.." && pwd)
shells=3
keys=
gap=0.3
repeat=1
expect=
size=120x40
keep=0
dry=0

while [ $# -gt 0 ]; do
  case $1 in
    -h | --help) usage; exit 0 ;;
    --keep) keep=1; shift; continue ;;
    --dry-run) dry=1; shift; continue ;;
    --name | --plugin-dir | --shells | --keys | --gap | --repeat | --expect | --size)
      [ $# -ge 2 ] || fail "$1 needs a value" ;;
    *) fail "unknown option: $1 (see --help)" ;;
  esac
  case $1 in
    --name) name=$2 ;;
    --plugin-dir) plugin=$2 ;;
    --shells) shells=$2 ;;
    --keys) keys=$2 ;;
    --gap) gap=$2 ;;
    --repeat) repeat=$2 ;;
    --expect) expect=$2 ;;
    --size) size=$2 ;;
  esac
  shift 2
done

[[ $name =~ ^[A-Za-z0-9_-]+$ ]] || fail "--name takes letters, digits, - and _ only"
[ -d "$plugin" ] || fail "--plugin-dir $plugin is not a folder"
[[ $shells =~ ^[0-9]+$ ]] || fail "--shells takes a whole number"
[[ $repeat =~ ^[0-9]+$ ]] && [ "$repeat" -ge 1 ] || fail "--repeat takes a whole number from 1"
[[ $gap =~ ^[0-9]*\.?[0-9]+$ ]] || fail "--gap takes seconds, such as 0.05"
[[ $size =~ ^([0-9]+)x([0-9]+)$ ]] || fail "--size takes COLSxROWS, such as 120x40"
cols=${BASH_REMATCH[1]}
rows=${BASH_REMATCH[2]}
plugin=$(cd "$plugin" && pwd)

if [ $dry = 1 ]; then
  printf '%s\n' "socket: $name" "plugin: $plugin" "shells: $shells" "keys: $keys" \
    "gap: $gap" "repeat: $repeat" "expect: $expect" "size: ${cols}x$rows" "keep: $keep"
  exit 0
fi

claude=${CLAUDE:-claude}
command -v tmux >/dev/null || fail "tmux is not installed"
command -v "$claude" >/dev/null || fail "$claude is not on PATH"
tmux -L "$name" has-session -t "$name" 2>/dev/null && fail "tmux socket $name is in use; pick another --name"

dir=$(mktemp -d "${TMPDIR:-/tmp}/rabe-live.XXXXXX")
out=$dir/captures
mkdir -p "$out"
# Unique durations, so cleanup stops only the shells this run started.
base=$((3600 + RANDOM))

cleanup() {
  if [ $keep = 1 ]; then
    echo "kept: $dir (tmux -L $name attach -t $name)"
    return
  fi
  tmux -L "$name" kill-server 2>/dev/null
  for i in $(seq 1 "$shells"); do pkill -f "^sleep $((base + i))\$" 2>/dev/null; done
  rm -rf "$dir"
}
trap cleanup EXIT

k() { tmux -L "$name" send-keys -t "$name" "$@"; }
cap() { tmux -L "$name" capture-pane -p -t "$name"; }
wait_for() { # regex, seconds
  local i
  for i in $(seq 1 "$2"); do cap | grep -Eq -- "$1" && return 0; sleep 1; done
  return 1
}

tmux -L "$name" new-session -d -s "$name" -x "$cols" -y "$rows" -c "$dir" \
  "$claude --plugin-dir '$plugin' --allowedTools 'Bash(sleep:*)'"

# A fresh folder asks for trust first; the prompt box follows.
if wait_for 'trust' 15; then k Enter; fi
sleep 5

if [ "$shells" -gt 0 ]; then
  cmds=
  for i in $(seq 1 "$shells"); do cmds="$cmds sleep $((base + i)),"; done
  k -l "Start each of these commands as its own background Bash call (run_in_background), then stop without waiting:${cmds%,}"
  k Enter
  wait_for "sleep $((base + shells))" 90 || echo "live-check: the shells did not show within 90 s" >&2
  sleep 3
fi

failed=0
for r in $(seq 1 "$repeat"); do
  k C-u
  k -l /rabe
  k Enter
  sleep 2
  for key in $keys; do k "$key"; sleep "$gap"; done
  sleep 1
  cap >"$out/round-$r.txt"
  if [ -z "$expect" ]; then
    echo "round $r: captured"
  elif grep -Eq -- "$expect" "$out/round-$r.txt"; then
    echo "round $r: pass"
  else
    echo "round $r: fail"
    sed 's/^/  | /' "$out/round-$r.txt"
    failed=1
  fi
  k Escape
  sleep 1
done

exit $failed
