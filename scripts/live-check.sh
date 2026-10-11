#!/usr/bin/env bash
# Live check of Rabe in a real Claude Code session, driven through tmux.
# See docs/testing.md.
set -u
# The pane is found by character column, which needs a UTF-8 locale.
case ${LC_ALL:-${LC_CTYPE:-${LANG:-}}} in
  *[Uu][Tt][Ff]*8*) ;;
  *) export LC_ALL=C.UTF-8 ;;
esac

usage() {
  cat <<'EOF'
Usage: scripts/live-check.sh [options]

Starts Claude Code with Rabe in a fresh temporary folder, on its own tmux
socket. Asks Claude to start background shells, opens /rabe, sends keys,
saves each screen and removes everything again. Each round starts from the
list: it leaves an open detail, goes to the first tab and the first row.

Options:
  --name NAME        tmux socket and session name (default rabe-live)
  --plugin-dir DIR   the Rabe checkout to load (default this repo)
  --shells N         background shells to seed, 0 for none (default 3)
  --timeout SECONDS  wait this long for the seeded shells (default 90)
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
timeout=90
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
    --name | --plugin-dir | --shells | --timeout | --keys | --gap | --repeat | --expect | --size)
      [ $# -ge 2 ] || fail "$1 needs a value" ;;
    *) fail "unknown option: $1 (see --help)" ;;
  esac
  case $1 in
    --name) name=$2 ;;
    --plugin-dir) plugin=$2 ;;
    --shells) shells=$2 ;;
    --timeout) timeout=$2 ;;
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
[[ $timeout =~ ^[0-9]+$ ]] && [ "$timeout" -ge 1 ] || fail "--timeout takes a whole number from 1"
[[ $repeat =~ ^[0-9]+$ ]] && [ "$repeat" -ge 1 ] || fail "--repeat takes a whole number from 1"
[[ $gap =~ ^[0-9]*\.?[0-9]+$ ]] || fail "--gap takes seconds, such as 0.05"
[[ $size =~ ^([0-9]+)x([0-9]+)$ ]] || fail "--size takes COLSxROWS, such as 120x40"
cols=${BASH_REMATCH[1]}
rows=${BASH_REMATCH[2]}
plugin=$(cd "$plugin" && pwd)

if [ $dry = 1 ]; then
  printf '%s\n' "socket: $name" "plugin: $plugin" "shells: $shells" \
    "timeout: $timeout" "keys: $keys" \
    "gap: $gap" "repeat: $repeat" "expect: $expect" "size: ${cols}x$rows" "keep: $keep"
  exit 0
fi

claude=${CLAUDE:-claude}
command -v tmux >/dev/null || fail "tmux is not installed"
command -v "$claude" >/dev/null || fail "$claude is not on PATH"
# Any session on the socket belongs to someone else, and cleanup must not end it.
tmux -L "$name" list-sessions >/dev/null 2>&1 && fail "tmux socket $name is in use; pick another --name"

dir=$(mktemp -d "${TMPDIR:-/tmp}/rabe-live.XXXXXX")
out=$dir/captures
mkdir -p "$out"
base=$((3600 + RANDOM))
root=
started=0

descendants() {
  local c
  for c in $(pgrep -P "$1"); do
    echo "$c"
    descendants "$c"
  done
}

# Stops only what this run's Claude Code started, never a match by name.
cleanup() {
  if [ $keep = 1 ]; then
    echo "kept: $dir (tmux -L $name attach -t $name)"
    return
  fi
  local pids=
  [ -n "$root" ] && pids=$(descendants "$root")
  [ $started = 1 ] && tmux -L "$name" kill-session -t "=$name" 2>/dev/null
  [ -n "$pids" ] && kill $pids 2>/dev/null
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

# Separate arguments run without a shell, so no path is parsed as shell code.
tmux -L "$name" new-session -d -s "$name" -x "$cols" -y "$rows" -c "$dir" \
  "$claude" --plugin-dir "$plugin" --allowedTools 'Bash(sleep:*)' ||
  fail "could not start the tmux session"
started=1
root=$(tmux -L "$name" display-message -p -t "$name" '#{pane_pid}')
[[ $root =~ ^[0-9]+$ ]] && [ "$root" -gt 1 ] || { root= && fail "could not find the Claude Code process"; }

# Counts the seeded shells that run under this run's Claude Code. The prompt
# shows the same command text, so the screen cannot tell.
seeded() {
  local pids
  pids=$(descendants "$root" | paste -sd, -)
  [ -n "$pids" ] || { echo 0; return; }
  ps -o args= -p "$pids" | grep -Ecx "(.*/)?sleep ($durations)"
}

# Reads the Rabe pane's own lines into `view`. The pane is the text right of
# the longest vertical run of │: the border of the docked pane, or the left
# edge of the inline box under ╭, which has one more column of padding.
# Transcript text beside or above the pane never counts.
look() {
  local screen line c i run best=0 col=-1 at=0 pad=0
  local -a lines
  screen=$(cap) || fail "could not capture the screen in round $r"
  mapfile -t lines <<<"$screen"
  view=()
  for i in "${!lines[@]}"; do
    line=${lines[i]}
    for ((c = 0; c < ${#line}; c++)); do
      [ "${line:c:1}" = │ ] || continue
      [ "$i" -gt 0 ] && [ "${lines[i - 1]:c:1}" = │ ] && continue
      for ((run = i + 1; run < ${#lines[@]}; run++)); do
        [ "${lines[run]:c:1}" = │ ] || break
      done
      [ $((run - i)) -gt $best ] && best=$((run - i)) col=$c at=$i
    done
  done
  [ $col -ge 0 ] || return 0
  [ "$at" -gt 0 ] && [ "${lines[at - 1]:col:1}" = ╭ ] && pad=1
  for ((i = at; i < at + best; i++)); do view+=("${lines[i]:col+1+pad}"); done
}
# A line of the pane starts with this text.
shows() {
  local line
  for line in "${view[@]}"; do [[ $line == "$1"* ]] && return 0; done
  return 1
}
# The list has rows: a group header or the selected row's marker ▌ shows. A
# long list can scroll its header away.
has_list() { shows ▾ || shows ▌; }
# The pane shows its tab row, its empty state or its list.
opened() { shows ' 1: I' || shows ' Nothing runs in the background' || has_list; }
# The first row of the list is selected: below the tab row, the marker ▌ is on
# the row under the first open group header, or in SHELLS and MONITORS under
# the agent heading that comes first (its rows are indented). A long list
# scrolls the pane, and then a later group's header can be the first one on
# screen, so the tab row must show above it.
first_selected() {
  local i row tabs=0
  for i in "${!view[@]}"; do
    [[ ${view[i]} == ' 1: I'* ]] && tabs=1
    [[ ${view[i]} == ▾* ]] || continue
    [ $tabs = 1 ] || return 1
    row=${view[i + 1]:-}
    if [[ ${view[i]} =~ ^▾\ (SHELLS|MONITORS) && ${view[i + 2]:-} =~ ^(▌|\ )\ \ [^\ ] ]]; then
      row=${view[i + 2]}
    fi
    [[ $row == ▌* ]]
    return
  done
  return 1
}

# A fresh folder asks for trust first; the prompt box follows.
if wait_for 'trust' 15; then k Enter; fi
sleep 5

if [ "$shells" -gt 0 ]; then
  cmds=
  durations=
  for i in $(seq 1 "$shells"); do
    cmds="$cmds sleep $((base + i)),"
    durations="$durations|$((base + i))"
  done
  durations=${durations#|}
  k -l "Start each of these commands as its own background Bash call (run_in_background), then stop without waiting:${cmds%,}"
  k Enter
  for i in $(seq 1 "$timeout"); do
    [ "$(seeded)" -ge "$shells" ] && break
    sleep 1
  done
  [ "$(seeded)" -ge "$shells" ] || fail "the $shells shells did not start within $timeout s"
  # Rabe adds the rows from the tool results, just after the shells start.
  sleep 3
fi

failed=0
for r in $(seq 1 "$repeat"); do
  k C-u
  k -l /rabe
  k Enter
  sleep 2
  for i in $(seq 1 15); do look; opened && break; sleep 1; done
  opened || fail "Rabe did not open in round $r"
  # /rabe keeps the open detail, the tab and the selection of the last round.
  if printf '%s\n' "${view[@]}" | grep -Eq 'b:? back'; then
    k b
    sleep 0.5
  fi
  k 1
  sleep 0.5
  # The arrows wrap where the list fits, so a fixed count of Up presses can end
  # on any row: press Up until the first row shows the marker. A long list
  # scrolls instead and needs Up until the tab row shows, so allow more
  # presses than the seeded rows.
  look
  if has_list; then
    for i in $(seq 1 $((shells + 100))); do
      look
      first_selected && break
      k Up
      sleep 0.3
    done
    look
    first_selected || fail "could not select the first row in round $r"
  fi
  sleep 1
  for key in $keys; do k "$key"; sleep "$gap"; done
  sleep 1
  cap >"$out/round-$r.txt" || fail "could not capture the screen in round $r"
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
