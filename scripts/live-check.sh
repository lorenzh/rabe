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
  --expect REGEX     the Rabe pane in each capture must match this extended regex
  --sequences LIST   run named key sequences instead of --keys, one PASS or FAIL
                     each over all rounds: comma-separated names, or fixed
                     (ring-*), pending (issues not fixed yet) or all. Needs
                     --shells 3 or more; it seeds spare shells for the
                     sequences that stop or remove one. See docs/testing.md.
  --model NAME       start Claude Code with this model (a cheap one will do)
  --size COLSxROWS   terminal size (default 120x40)
  --keep             keep the folder, the captures and the tmux session
  --dry-run          print the plan and stop
  -h, --help         show this help

Environment: CLAUDE names the Claude Code binary (default claude).
Sequences: ring-2 ring-3 ring-4 (fixed: tab key, 1, Down Down lands on the
third row), search-esc, search-enter, click-stop, tab-selection,
remove-neighbour, search-keys, back-cost, back-timeline, reopen (fixed); no
sequence is pending.
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
sequences=
model=
keep=0
dry=0

while [ $# -gt 0 ]; do
  case $1 in
    -h | --help) usage; exit 0 ;;
    --keep) keep=1; shift; continue ;;
    --dry-run) dry=1; shift; continue ;;
    --name | --plugin-dir | --shells | --timeout | --keys | --gap | --repeat | --expect | --size | --sequences | --model)
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
    --sequences) sequences=$2 ;;
    --model) model=$2 ;;
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

# Key sequences. FIXED ones must pass on main; PENDING ones belong to issues
# that are not fixed yet and may FAIL: the script reports them.
FIXED="ring-2 ring-3 ring-4 search-keys search-esc search-enter click-stop tab-selection remove-neighbour back-cost back-timeline reopen"
PENDING=""
seqs=()
if [ -n "$sequences" ]; then
  [ -z "$keys" ] && [ -z "$expect" ] || fail "--sequences replaces --keys and --expect"
  [ "$shells" -ge 3 ] || fail "--sequences needs --shells 3 or more"
  for w in ${sequences//,/ }; do
    case $w in
      fixed) seqs+=($FIXED) ;;
      pending) seqs+=($PENDING) ;;
      all) seqs+=($FIXED $PENDING) ;;
      *) [[ " $FIXED $PENDING " == *" $w "* ]] || fail "unknown sequence: $w (see --help)"
         seqs+=("$w") ;;
    esac
  done
fi
mapfile -t seqs < <(printf '%s\n' "${seqs[@]}" | awk 'NF && !seen[$0]++')
[ -z "$sequences" ] || [ ${#seqs[@]} -gt 0 ] || fail "--sequences $sequences names no sequence: none is pending"
# Sequences that stop or remove a shell each take a spare one per round. The
# Cost tab lists agents and jobs only, so back-cost seeds one subagent.
allowed='Bash(sleep:*)'
agent=
[[ " ${seqs[*]} " == *" back-cost "* ]] && { agent=1; allowed="$allowed,Agent"; }
seed=$shells
for w in "${seqs[@]}"; do
  case $w in click-stop | remove-neighbour) seed=$((seed + repeat)) ;; esac
done

if [ $dry = 1 ]; then
  printf '%s\n' "socket: $name" "plugin: $plugin" "shells: $shells" \
    "timeout: $timeout" "keys: $keys" \
    "gap: $gap" "repeat: $repeat" "expect: $expect" "size: ${cols}x$rows" "keep: $keep" \
    "sequences: ${seqs[*]}" "seed: $seed" "model: $model"
  exit 0
fi

claude=${CLAUDE:-claude}
# tmux starts it in the scratch folder, so a relative path would not be found.
[[ $claude == */* && $claude != /* ]] && claude=$PWD/$claude
command -v tmux >/dev/null || fail "tmux is not installed"
if [[ $claude == */* ]]; then
  [ -x "$claude" ] && [ ! -d "$claude" ] || fail "$claude was not found or is not executable"
else
  command -v "$claude" >/dev/null || fail "$claude is not on PATH"
fi
# Any session on the socket belongs to someone else, and cleanup must not end it.
tmux -L "$name" list-sessions >/dev/null 2>&1 && fail "tmux socket $name is in use; pick another --name"

dir=$(mktemp -d "${TMPDIR:-/tmp}/rabe-live.XXXXXX") && [ -d "$dir" ] || fail "could not create a temp folder"
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
  "$claude" --plugin-dir "$plugin" --allowedTools "$allowed" ${model:+--model "$model"} ||
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

# The East Asian Width W code points from U+2300 to U+2BFF: emoji such as ✅
# and ⏰ that a terminal draws two cells wide.
wide="8986 8987 9001 9002 9193 9194 9195 9196 9200 9203 9725 9726 9748 9749 9800 9801 9802 9803 9804 9805 9806 9807 9808 9809 9810 9811 9855 9875 9889 9898 9899 9917 9918 9924 9925 9934 9940 9962 9970 9971 9973 9978 9981 9989 9994 9995 10024 10060 10062 10067 10068 10069 10071 10133 10134 10135 10160 10175 11035 11036 11088 11093"
# Reads the Rabe pane's own lines into `view`, from the screen given or a new
# capture. The pane is the text right of the longest vertical run of │ at one
# terminal cell column, inside its frame: docked, the run ends on the rule of
# the prompt box at column 0; inline, ╭ is above it and ╰ below. The inline
# box has one more column of padding. Transcript text never counts.
look() {
  local screen line i j c cell cp end run best=0 col=-1 at=0 pad=0 inset=0
  local -a lines
  local -A bar=() corner=()
  top=0 left=0
  if [ $# -gt 0 ]; then screen=$1; else screen=$(cap) || fail "could not capture the screen in round $r"; fi
  mapfile -t lines <<<"$screen"
  view=()
  for i in "${!lines[@]}"; do
    line=${lines[i]}
    [[ $line == *[│╭╰]* ]] || continue
    cell=0
    for ((j = 0; j < ${#line}; j++)); do
      c=${line:j:1}
      case $c in
        │) bar[$i,$cell]=$j ;;
        ╭ | ╰) corner[$i,$cell]=$c ;;
      esac
      # ponytail: a short wcwidth table (combining 0; CJK, emoji and the
      # East Asian Width W symbols below U+2E80 2); a rarer zero-width or wide
      # character beside the pane can still shift it.
      printf -v cp %d "'$c"
      if ((cp < 0x300)); then
        cell=$((cell + 1))
      elif ((cp >= 0x2300 && cp <= 0x2bff)) && [[ " $wide " == *" $cp "* ]]; then
        cell=$((cell + 2))
      elif ((cp <= 0x36f || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) ||
        (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x20d0 && cp <= 0x20ff) ||
        (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xfe20 && cp <= 0xfe2f))); then
        :
      elif (((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) ||
        cp == 0x1f004 || cp == 0x1f0cf || cp == 0x1f18e || (cp >= 0x1f191 && cp <= 0x1f19a) ||
        (cp >= 0x1f200 && cp <= 0x1f2ff) ||
        (cp >= 0x20000 && cp <= 0x3fffd))); then
        cell=$((cell + 2))
      else
        cell=$((cell + 1))
      fi
    done
  done
  for c in "${!bar[@]}"; do
    i=${c%,*} cell=${c#*,}
    [ -n "${bar[$((i - 1)),$cell]:-}" ] && continue
    for ((end = i + 1; end < ${#lines[@]}; end++)); do
      [ -n "${bar[$end,$cell]:-}" ] || break
    done
    run=$((end - i))
    if [ "${corner[$((i - 1)),$cell]:-}" = ╭ ] && [ "${corner[$end,$cell]:-}" = ╰ ]; then
      pad=1
    elif [[ ${lines[end]:-} == ─* ]]; then
      pad=0
    else
      continue
    fi
    if [ $run -gt $best ] || { [ $run = $best ] && [ $((i * 1000 + cell)) -lt $((at * 1000 + col)) ]; }; then
      best=$run col=$cell at=$i
      inset=$pad
    fi
  done
  [ $col -ge 0 ] || return 0
  top=$at left=$((col + 1 + inset))
  for ((i = at; i < at + best; i++)); do view+=("${lines[i]:${bar[$i,$col]}+1+inset}"); done
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

if [ "$seed" -gt 0 ]; then
  cmds=
  # The search sequences need a row that matches what they type: the first
  # shell carries a comment with "zebra nap", so "zeb" leaves a row (#219).
  tag=
  [[ " ${seqs[*]} " == *" search-keys "* || " ${seqs[*]} " == *" search-esc "* ]] && tag="# zebra nap"
  durations=
  for i in $(seq 1 "$seed"); do
    cmds="$cmds sleep $((base + i))${tag:+ $tag},"
    tag=
    durations="$durations|$((base + i))"
  done
  durations=${durations#|}
  prompt="Start each of these commands as its own background Bash call (run_in_background), then stop without waiting:${cmds%,}"
  [ -n "$agent" ] && prompt="$prompt. Also start one background subagent with the Agent tool that only replies ok."
  k -l "$prompt"
  k Enter
  for i in $(seq 1 "$timeout"); do
    [ "$(seeded)" -ge "$seed" ] && break
    sleep 1
  done
  [ "$(seeded)" -ge "$seed" ] || fail "the $seed shells did not start within $timeout s"
  # Rabe adds the rows from the tool results, just after the shells start.
  sleep 3
fi

# Opens /rabe and starts from the list: the open detail left, the first tab,
# the first row selected. Leaves the pane in `view`.
start_round() {
  local i
  local try
  for try in 1 2; do
    k C-u
    k -l /rabe
    k Enter
    sleep 2
    for i in $(seq 1 15); do look; opened && break; sleep 1; done
    opened && break
  done
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
}

# --- Key sequences. Each runs after start_round, returns 0 for a pass and
# sets `why` for a fail. They read the pane only (`view`), and the processes of
# this run's shells where a shell must stop.
keys() { local x; for x; do k "$x"; sleep "$gap"; done; }
snap() { sleep 0.7; look; }
pane_has() { printf '%s\n' "${view[@]}" | grep -Eq -- "$1"; }
# Every row of the list whatever its kind, below the search field: lrows
# (indexes in view) and lsel (position of the marked one, -1 for none).
listscan() {
  local i in=0
  lrows=() lsel=-1
  for i in "${!view[@]}"; do
    if [[ ${view[i]} == search* ]]; then in=1; continue; fi
    [ $in = 1 ] || continue
    [[ ${view[i]} =~ ^\ (↑↓|esc|tab\ to) ]] && break
    [[ ${view[i]} == [▾▸]* ]] && continue
    [[ ${view[i]} =~ ^(▌|\ )\ {0,2}[^\ ]\  ]] || continue
    [[ ${view[i]} == ▌* ]] && lsel=${#lrows[@]}
    lrows+=("$i")
  done
}
# The tab under the rule's thick part, 0 when none shows.
active_tab() {
  local i t
  for i in "${!view[@]}"; do
    [[ ${view[i]} == ' 1: '* && ${view[i + 1]:-} == *━* ]] || continue
    t=${view[i + 1]%%━*}
    echo "${view[i]:${#t}:1}"
    return
  done
  echo 0
}
# Waits until the tab bar marks tab $1: a key sent before the tab's drawing
# would give up its landing on the marked row.
on_tab() {
  local i
  for i in $(seq 1 25); do
    look
    [ "$(active_tab)" = "$1" ] && return 0
    sleep 0.2
  done
  why="tab $1 is not marked 5 s after its key"
  return 1
}
# Durations of this run's seeded shells that still run, highest first.
running() {
  local pids
  pids=$(descendants "$root" | paste -sd, -)
  [ -n "$pids" ] || return 0
  ps -o args= -p "$pids" | grep -Eo "sleep ($durations)\$" | cut -d' ' -f2 | sort -rn
}
# A left click on a row of the pane, by its index in `view`.
click() {
  local x=$((left + 4)) y=$((top + $1 + 1))
  k -l "$(printf '\033[<0;%d;%dM\033[<0;%d;%dm' "$x" "$y" "$x" "$y")"
  sleep 0.5
}
# The duration of the seeded shell a row shows, empty for any other row.
shellof() { [[ $1 =~ sleep\ ($durations)($|[^0-9]) ]] && echo "${BASH_REMATCH[1]}"; }
# What a row is called across screens: its shell's duration, or its text
# without digits (a timer ticks).
ident() {
  local d
  d=$(shellof "$1")
  if [ -n "$d" ]; then echo "$d"; else tr -d 0-9 <<<"${1:1}" | tr -s ' '; fi
}
# A row without its Timeline or Cost bar (#233). A title that fills its column
# leaves one space before the bar, so the cut at the first double space may
# keep it: drop a trailing run of bar glyphs (hooks/ui/cells/grid.ts) too. A
# glyph inside the title stays, so titles that differ after it stay apart.
rowtitle() { local r=${1:1}; r=${r%%  *}; echo "${1:0:1}$(sed -E 's/( ?[█▏▎▍▌▋▊▉◂])+$//' <<<"$r")"; }
# Clicks the last row that shows a running seeded shell (▶) other than the
# marked one, and sets `clicked` to its duration.
click_running() {
  local i last=-1 d
  look
  listscan
  clicked=
  for i in "${!lrows[@]}"; do
    [ "$i" = "$lsel" ] && continue
    [[ ${view[lrows[i]]} =~ ^(▌|\ )\ {0,2}▶\  ]] || continue
    d=$(shellof "${view[lrows[i]]}")
    [ -n "$d" ] && { last=${lrows[i]}; clicked=$d; }
  done
  [ "$last" -ge 0 ] || { why="no running seeded shell besides the marked row is on screen"; return 1; }
  click "$last"
}
# $2, the clicked shell, stops within 8 s, and no other one: the count of
# running shells drops from $1 by one.
stopped() {
  local i now n
  for i in $(seq 1 16); do
    now=$(running)
    n=$(grep -c . <<<"$now")
    grep -qx "$2" <<<"$now" || break
    sleep 0.5
  done
  if [ "$n" != $(($1 - 1)) ] || grep -qx "$2" <<<"$now"; then
    why="x on the clicked sleep $2: $1 shells ran, $n run after, running: $(tr '\n' ' ' <<<"$now")"
    return 1
  fi
}

# The seeded shell on the marked row, empty for none.
marked() { [ "$lsel" -ge 0 ] && shellof "${view[lrows[lsel]]}"; }
seq_ring() { # tab key
  local from a b c mid end
  listscan
  from=$lsel
  [ "$from" -ge 0 ] || { why="no row is selected at the start"; return 1; }
  a=$(shellof "${view[lrows[from]]}")
  b=$(shellof "${view[lrows[from + 1]]:-}")
  c=$(shellof "${view[lrows[from + 2]]:-}")
  # Each tab key waits for its tab: after 1 the marker must move back from
  # tab $1, so a stale Items marker is never taken for the landing.
  keys "$1"
  on_tab "$1" || return 1
  keys 1
  on_tab 1 || return 1
  keys Down
  snap
  listscan
  mid=$(marked)
  keys Down
  snap
  listscan
  end=$(marked)
  if [ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ]; then
    # Three shells in a row: each Down lands on the next one.
    [ "$mid" = "$b" ] ||
      { why="after $1 1 Down the marker is on ${mid:+sleep }${mid:-no shell}, from sleep $a (wanted sleep $b)"; return 1; }
    [ "$end" = "$c" ] ||
      { why="after $1 1 Down Down the marker is on ${end:+sleep }${end:-no shell} (wanted sleep $c)"; return 1; }
  else
    # A group header between two groups takes one Down.
    { [ "$lsel" -gt "$from" ] && [ "$lsel" -le $((from + 2)) ]; } ||
      { why="after $1 1 Down Down the marker is on row $lsel, from row $from (wanted the next rows)"; return 1; }
  fi
}
seq_click_stop() {
  local before
  before=$(running | wc -l)
  click_running || return 1
  # The ring follows the click: Enter presses the ring's row, the clicked one.
  keys Enter
  snap
  { pane_has 'b:? back' && pane_has "sleep $clicked"; } ||
    { why="Enter after the click did not open sleep $clicked: the ring stayed on the old row"; return 1; }
  k b
  k x
  stopped "$before" "$clicked"
}
seq_search_keys() {
  local all
  look
  listscan
  all=${#lrows[@]}
  keys s z e b
  snap
  pane_has 'search:? +zeb' || { why="the field does not read zeb"; return 1; }
  # Backspace back to rows: the field keeps the focus, so typing goes on in it.
  # zeb matches the command of the seeded "zebra nap" row: a lost Backspace (#180) leaves text.
  listscan
  # The row title is Claude's description, not the comment: one row is left.
  { [ "${#lrows[@]}" -ge 1 ] && [ "${#lrows[@]}" -lt "$all" ]; } ||
    { why="zeb left ${#lrows[@]} of $all rows before the Backspaces: no row matches it"; return 1; }
  keys BSpace BSpace BSpace
  snap
  listscan
  # A Backspace that lost its change handler leaves the filter: the rows stay narrowed.
  [ "${#lrows[@]}" = "$all" ] || { why="after Backspace to empty the list shows ${#lrows[@]} rows, not $all: the filter stayed (#213)"; return 1; }
  keys l e
  snap
  pane_has 'search:? +le([^e]|$)' || { why="after Backspace to the rows the field does not read le: the focus left it"; return 1; }
}
seq_search_esc() {
  keys s z e
  snap
  pane_has 'search:? +ze([^e]|$)' || { why="the field does not read ze before Esc"; return 1; }
  keys Escape e
  snap
  opened || { why="Esc closed the pane"; return 1; }
  # The field keeps its text, so an e after Esc that left it changes nothing.
  pane_has 'search:? +ze([^e]|$)' || { why="after Esc and e the field does not read ze: the focus stayed in it"; return 1; }
}
seq_search_enter() {
  local want
  want=$(running | tail -1)
  [ -n "$want" ] || { why="no seeded shell runs"; return 1; }
  keys s
  k -l "$want"
  sleep "$gap"
  k Enter
  snap
  listscan
  { [ "${#lrows[@]}" = 1 ] && [ "$lsel" = 0 ]; } ||
    { why="sleep $want left ${#lrows[@]} rows, the marker on row $lsel"; return 1; }
  # Focus on the match: Enter opens it. A button under the focus does not.
  keys Enter
  snap
  pane_has 'b:? back' || { why="Enter after the filter opened no detail"; return 1; }
  k b
}
seq_tab_selection() {
  local before after
  keys Down
  snap
  listscan
  before=$lsel
  [ "$before" -ge 0 ] || { why="no row is selected after Down"; return 1; }
  keys 2
  sleep 0.7
  keys 1
  snap
  listscan
  after=$lsel
  [ "$before" = "$after" ] || { why="row $before was selected, back on row $after"; return 1; }
}
# The seeded shell the detail beside the list names, empty for none. At 120
# columns an ended row cuts its title before the duration; the detail does not.
detailof() {
  local line
  for line in "${view[@]}"; do
    [[ $line =~ [▶■]\ shell\ ·\ .*sleep\ ($durations)($|[^0-9]) ]] && { echo "${BASH_REMATCH[1]}"; return; }
  done
}
seq_remove_neighbour() {
  local before i at n now want wantat from
  before=$(running | wc -l)
  click_running || return 1
  k x
  stopped "$before" "$clicked" || return 1
  # The row is ended once Claude Code reports the stop; a click opened its
  # detail, which has no r.
  sleep 3
  look
  if pane_has 'b:? back'; then
    k b
    sleep 0.7
  fi
  # The end gives r a target the person did not choose, which disarms the
  # pane (Arming in docs/architecture/focus-order.md): the person moves the
  # ring off the row and back before r.
  keys Up Down
  snap
  listscan
  at=$lsel
  now=$(marked)
  [ "$at" -ge 0 ] && [ "${now:-$(detailof)}" = "$clicked" ] ||
    { why="the marked row is not sleep $clicked after the stop and Up Down"; return 1; }
  # The neighbour is the next row, the previous one only when the removed row
  # was the last; the list keeps its order while the pane is open.
  n=${#lrows[@]}
  [ "$n" -ge 2 ] || { why="the list has $n rows, r needs a neighbour"; return 1; }
  if [ $((at + 1)) -lt "$n" ]; then wantat=$at from=$((at + 1)); else wantat=$((at - 1)) from=$((at - 1)); fi
  want=$(shellof "${view[lrows[from]]}")
  k r
  snap
  listscan
  for i in "${!lrows[@]}"; do
    [ "$(shellof "${view[lrows[i]]}")" = "$clicked" ] && { why="r left the row of sleep $clicked"; return 1; }
  done
  [ "$(detailof)" != "$clicked" ] || { why="r left sleep $clicked in the detail"; return 1; }
  [ "${#lrows[@]}" = $((n - 1)) ] || { why="r left ${#lrows[@]} of $n rows"; return 1; }
  [ "$lsel" = "$wantat" ] || { why="after r on row $at of $n the marker is on row $lsel, not $wantat"; return 1; }
  # A neighbour whose title shows its shell is checked by name too.
  now=$(marked)
  [ -z "$want" ] || [ "${now:-$(detailof)}" = "$want" ] ||
    { why="after r on sleep $clicked the marker is on '${now:-$(detailof)}', not on sleep $want"; return 1; }
}
# Esc and /rabe again (#188): Enter presses the row that was marked, so the
# detail it opens is the second row's, not the tab's first stop.
seq_reopen() {
  local i before row
  keys Down
  snap
  listscan
  before=$lsel
  [ "$before" -ge 0 ] || { why="no row is marked after Down"; return 1; }
  row=$(ident "${view[lrows[before]]}")
  k Escape
  sleep 1
  reopen_pane || { why="/rabe did not open the pane again"; return 1; }
  sleep 1
  snap
  listscan
  [ "$lsel" = "$before" ] || { why="row $before was marked, the reopened pane marks row $lsel"; return 1; }
  keys Enter
  snap
  pane_has 'b:? back' || { why="Enter after the reopen opened no detail: the ring is not on the row"; return 1; }
  pane_has "${row%% *}" || { why="the detail is not the one of '$row'"; return 1; }
  k b
}
seq_back() { # tab key
  local i
  k "$1"
  # The subagent of the seed may still run: the Cost tab lists it once it has.
  if [ "$1" = 2 ]; then
    for i in $(seq 1 40); do
      look
      pane_has 'No agent or Codex job yet' || break
      sleep 1
    done
  fi
  keys Enter
  snap
  # Enter may land on a control of the tab; a click opens the marked row.
  if ! pane_has 'b:? back'; then
    for i in "${!view[@]}"; do
      [[ ${view[i]} == ▌* ]] && { click "$i"; break; }
    done
    snap
  fi
  pane_has 'b:? back' || { why="no detail opened on tab $1"; return 1; }
  keys b
  snap
  ! pane_has 'b:? back' || { why="b left the detail open"; return 1; }
  [ "$(active_tab)" = "$1" ] || { why="b went back to tab $(active_tab), not $1"; return 1; }
  # One press: the ring is on the row the detail came from, so Enter opens it
  # again; the marked row is the one that was opened (#185). Only the title
  # counts: a Timeline bar grows while the row stays the same.
  local marked
  for i in "${!view[@]}"; do
    [[ ${view[i]} == ▌* ]] && { marked=$(ident "$(rowtitle "${view[i]}")"); break; }
  done
  keys Enter
  snap
  pane_has 'b:? back' || { why="Enter after b opened no detail: the ring is not on the row"; return 1; }
  keys b
  snap
  for i in "${!view[@]}"; do
    [[ ${view[i]} == ▌* ]] && { [ "$(ident "$(rowtitle "${view[i]}")")" = "$marked" ] && return 0; break; }
  done
  why="b did not keep the marked row '$marked'"
  return 1
}
# Esc only while the pane shows: in the prompt, a second Esc opens a menu.
close_pane() {
  look
  opened && k Escape
  sleep 1
}
# The search keeps its text over rounds, and Esc may have closed the pane
# with the text still set (#187): reopen it and empty the field.
clear_search() {
  local i j
  # Esc first: a field that lost keys (#180) is wedged until it is left, and
  # Esc closes the pane when no field has the focus (#187), so reopen it.
  for j in 1 2 3; do
    look
    if opened; then k Escape; sleep 0.7; fi
    reopen_pane || return 0
    k s
    sleep 0.5
    for i in $(seq 1 16); do k BSpace; sleep 0.1; done
    sleep 0.3
    look
    pane_has 's:? search "' || break
  done
  k Escape
  sleep 0.5
}
# Types /rabe unless the pane shows; returns 1 when it never shows.
reopen_pane() {
  local i
  look
  opened && return 0
  k C-u
  k -l /rabe
  k Enter
  sleep 2
  for i in $(seq 1 10); do look; opened && return 0; sleep 1; done
  return 1
}
run_seq() {
  case $1 in
    ring-*) seq_ring "${1#ring-}" ;;
    click-stop) seq_click_stop ;;
    search-keys) seq_search_keys ;;
    search-esc) seq_search_esc ;;
    search-enter) seq_search_enter ;;
    tab-selection) seq_tab_selection ;;
    remove-neighbour) seq_remove_neighbour ;;
    reopen) seq_reopen ;;
    back-cost) seq_back 2 ;;
    back-timeline) seq_back 4 ;;
  esac
}

failed=0
if [ ${#seqs[@]} -gt 0 ]; then
  declare -A passes=()
  for r in $(seq 1 "$repeat"); do
    for w in "${seqs[@]}"; do
      start_round
      why=
      if run_seq "$w"; then
        passes[$w]=$((${passes[$w]:-0} + 1))
        echo "round $r: $w: pass"
      else
        echo "round $r: $w: fail: $why"
        look
        printf '%s\n' "${view[@]}" | sed 's/^/  | /'
      fi
      case $w in search-*) clear_search ;; esac
      close_pane
    done
  done
  for w in "${seqs[@]}"; do
    if [ "${passes[$w]:-0}" = "$repeat" ]; then
      echo "PASS $w ${passes[$w]}/$repeat"
    else
      echo "FAIL $w ${passes[$w]:-0}/$repeat"
      failed=1
    fi
  done
  exit $failed
fi

for r in $(seq 1 "$repeat"); do
  start_round
  for key in $keys; do k "$key"; sleep "$gap"; done
  sleep 1
  cap >"$out/round-$r.txt" || fail "could not capture the screen in round $r"
  look "$(cat "$out/round-$r.txt")"
  if [ -z "$expect" ]; then
    echo "round $r: captured"
  elif printf '%s\n' "${view[@]}" | grep -Eq -- "$expect"; then
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
