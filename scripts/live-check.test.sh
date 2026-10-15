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

check 'sequences reach the plan' 0 'sequences: ring-2 search-keys$' --dry-run --sequences ring-2,search-keys
check 'fixed names the sequences of fixed issues' 0 'sequences: ring-2 ring-3 ring-4 search-keys search-esc search-enter click-stop tab-selection remove-neighbour back-cost back-timeline reopen$' --dry-run --sequences fixed
check 'pending without an open issue is a usage error' 2 'none is pending' --dry-run --sequences pending
check 'pending beside a name runs that name' 0 'sequences: ring-2$' --dry-run --sequences pending,ring-2
check 'an unknown sequence fails' 2 'unknown sequence: nope' --sequences nope
check 'sequences and --keys exclude each other' 2 '--sequences' --sequences ring-2 --keys Down
check 'sequences and --expect exclude each other' 2 '--sequences' --sequences ring-2 --expect x
check 'sequences need three shells' 2 '--shells' --sequences ring-2 --shells 2
check 'a destructive sequence seeds one spare per round' 0 'seed: 7$' --dry-run --sequences click-stop,remove-neighbour --repeat 2

# A fake tmux: its pane is a loop that starts the shells the seed prompt names,
# as Claude Code would. Each seed also starts a shell with the same duration
# outside the pane, as a second run would; cleanup must leave that one alone.
real_sleep=$(command -v sleep)
fake=$(mktemp -d) && [ -d "$fake" ] || { echo "could not create a temp folder" >&2; exit 2; }
trap 'rm -rf "$fake"' EXIT
mkdir "$fake/bin"
cat >"$fake/bin/tmux" <<'EOF'
#!/usr/bin/env bash
shift 2
cmd=$1
shift
# The rows that show: FAKE_LIST rows minus removed ones (gone) and, after a
# submitted search, those whose duration differs from it. `vis` holds their
# ids in list order; the ring and the marker count positions in `vis`.
visible() {
  local id total g f
  mapfile -t durs < <(cat "$FAKE/durs" 2>/dev/null | tr ' ' '\n')
  total=$(tr ' ' '\n' <<<"${FAKE_LIST:-}" | grep -Ec '^[ri]$')
  g=" $(cat "$FAKE/gone" 2>/dev/null | tr '\n' ' ') "
  f=$(cat "$FAKE/filter" 2>/dev/null)
  vis=()
  for ((id = 0; id < total; id++)); do
    [[ $g == *" $id "* ]] && continue
    # The seeded "zebra nap" row (the first) also matches letters of its title.
    if [ -n "$f" ] && [ "${durs[id]:-}" != "$f" ]; then
      { [ "$id" = 0 ] && [ -e "$FAKE/zebra" ] && [[ "zebra nap" == *"$f"* ]]; } || continue
    fi
    vis+=("$id")
  done
  rows=${#vis[@]}
}
case $cmd in
  has-session) exit 1 ;;
  # FAKE_BUSY: the socket already serves a session of someone else.
  list-sessions) [ "${FAKE_BUSY:-}" = 1 ] && { echo 'work: 1 windows'; exit 0; }; exit 1 ;;
  new-session)
    printf '%s\n' "$@" >"$FAKE/argv"
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
      # A left click: the row at that screen line is marked (FAKE_CLICK=ignore
      # leaves the marker where it was, the bug of #186).
      if [[ $2 =~ $'\033'\[\<0\;[0-9]+\;([0-9]+)M ]]; then
        pos=$(awk -v l=$((BASH_REMATCH[1] - 1)) '$1 == l { print $2 }' "$FAKE/rowmap" 2>/dev/null)
        if [ -n "$pos" ] && [ "${FAKE_CLICK:-}" != ignore ]; then echo "$pos $pos" >"$FAKE/ring"; fi
        exit 0
      fi
      [[ $2 == *'# zebra nap'* ]] && : >"$FAKE/zebra"
      [ "$2" = /rabe ] && rm -f "$FAKE/closed" "$FAKE/field" "$FAKE/opened" "$FAKE/detail"
      field=0 text=
      read -r field text 2>/dev/null <"$FAKE/field"
      [ "$field" = 1 ] && echo "1 $text$2" >"$FAKE/field"
      printf '%s\n' "$2" >>"$FAKE/screen"
      ds=$(grep -o 'sleep [0-9]*' <<<"$2" | cut -d' ' -f2 | tr '\n' ' ')
      if [ -n "$ds" ]; then
        echo "$ds" >"$FAKE/durs"
        set -- $ds
        (exec -a sleep "$REAL_SLEEP" "$1") >/dev/null 2>&1 &
        echo $! >"$FAKE/foreign"
        [ "${FAKE_SHELLS:-}" = none ] || echo "$ds" >"$FAKE/spawn"
      fi
    else
      printf '%s\n' "$1" >>"$FAKE/keys"
      # FAKE_LIST is the list, word by word: H:NAME a group header, F:TITLE an
      # agent heading, r a row, i a row indented under the heading.
      # The focus ring walks the rows and FAKE_STOPS other stops (tabs,
      # controls) and wraps, as the engine does when the list fits. The marker
      # moves only when the ring lands on a row.
      # FAKE_TABKEY=ok lands a tab key on the marked row, =stop on a stop (the
      # bug of #174); FAKE_TABRESET=1 also loses the selection (#188).
      # FAKE_TABLATE=N draws a tab key's tab and lands its ring only N captures
      # later; until then the ring sits off the rows, and another key in the
      # pane gives the landing up (the tab still changes).
      # The search field: s focuses it, letters fill it, Escape leaves it
      # (FAKE_ESC=close closes the pane instead, #187), FAKE_FIELD=eat loses
      # the second letter (#180).
      # Enter in the field submits the search: the list keeps the rows of that
      # duration, the first one marked (FAKE_ENTER=nofilter filters nothing).
      # Enter on the list opens the detail (FAKE_ENTER=nodetail does not), b
      # closes it (FAKE_BACK=items also goes to the first tab, #185). x stops
      # the marked shell and r removes it once it ended (FAKE_REMOVE=reset
      # marks the first row after, =keep removes nothing, #188). FAKE_ARM=1:
      # the row's end disarms r until an arrow moves the ring, as in Rabe.
      field=0 text=
      read -r field text 2>/dev/null <"$FAKE/field"
      if [[ $1 == [1-4] ]] && [ "$field" != 1 ]; then
        if [ -n "${FAKE_TABLATE:-}" ]; then echo "$1 $FAKE_TABLATE" >"$FAKE/late"; else echo "$1" >"$FAKE/tab"; fi
      elif [ -e "$FAKE/late" ]; then
        read -r t _ <"$FAKE/late"
        echo "$t" >"$FAKE/tab"
        rm -f "$FAKE/late"
      fi
      if [ "$field" = 1 ] && [ ${#1} = 1 ]; then
        { [ "${FAKE_FIELD:-}" = eat ] && [ ${#text} = 1 ]; } || text+=$1
        echo "1 $text" >"$FAKE/field"
        echo "$text" >"$FAKE/filter"
      elif [ "$field" = 1 ] && [ "$1" = Escape ]; then
        if [ "${FAKE_ESC:-}" = close ]; then
          : >"$FAKE/closed"
        elif [ "${FAKE_ESC:-}" != ignore ]; then
          echo "0 $text" >"$FAKE/field"
        fi
      elif [ "$field" = 1 ] && [ "$1" = Enter ]; then
        [ "${FAKE_ENTER:-}" = nofilter ] || echo "$text" >"$FAKE/filter"
        echo "0 $text" >"$FAKE/field"
        echo "0 0" >"$FAKE/ring"
      elif [ "$field" = 1 ] && [ "$1" = BSpace ]; then
        # FAKE_BACKSPACE=lost drops a Backspace while the text matches the
        # seeded "zebra nap" row, the bug of #180 and #213.
        if [ "${FAKE_BACKSPACE:-}" = lost ] && [ -e "$FAKE/zebra" ] && [[ "zebra nap" == *"$text"* ]]; then
          exit 0
        fi
        text=${text%?}
        # FAKE_BACKSPACE=blur drops the focus when the field empties and the
        # rows return (#180).
        if [ -z "$text" ] && [ "${FAKE_BACKSPACE:-}" = blur ]; then
          echo "0 $text" >"$FAKE/field"
        else
          echo "1 $text" >"$FAKE/field"
        fi
        # FAKE_BACKSPACE=stale drops the change handler of the last
        # Backspace: the field empties and the filter keeps the last letter.
        if [ -n "$text" ]; then
          echo "$text" >"$FAKE/filter"
        elif [ "${FAKE_BACKSPACE:-}" != stale ]; then
          rm -f "$FAKE/filter"
        fi
      elif [ "$1" = s ]; then
        echo "1 " >"$FAKE/field"
      elif [ "$1" = b ]; then
        rm -f "$FAKE/detail"
        [ "${FAKE_BACK:-}" = items ] && echo 1 >"$FAKE/tab"
        # FAKE_BACK=other returns to the next row: a wrong return selection.
        if [ "${FAKE_BACK:-}" = other ]; then
          read -r ring sel <"$FAKE/ring" && echo "$ring $(((sel + 1) % 4))" >"$FAKE/ring"
        fi
      elif [ -n "${FAKE_LIST:-}" ]; then
        visible
        read -r ring sel 2>/dev/null <"$FAKE/ring" || { ring=$FAKE_RING; sel=$FAKE_RING; }
        [[ $1 == Up || $1 == Down ]] && rm -f "$FAKE/disarmed"
        case $1 in
          Up)
            [ "${FAKE_UP:-}" = ignore ] && exit 0
            # With FAKE_SCROLL the list is longer than the pane: Up stops on the
            # first row, and one more Up scrolls the tab row into view (ring -1).
            if [ -n "${FAKE_SCROLL:-}" ]; then
              ring=$((ring > 0 ? ring - 1 : -1))
            else
              ring=$(((ring - 1 + rows + FAKE_STOPS) % (rows + FAKE_STOPS)))
            fi ;;
          Down) ring=$(((ring + 1) % (rows + FAKE_STOPS))) ;;
          Enter)
            [ "${FAKE_ENTER:-}" = nodetail ] || { [ -e "$FAKE/opened" ] && : >"$FAKE/detail"; }
            exit 0 ;;
          x)
            id=${vis[sel]:-}
            [ -n "$id" ] || exit 0
            kill "$(sed -n "$((id + 1))p" "$FAKE/seeded")" 2>/dev/null
            echo "$id" >>"$FAKE/ended"
            [ -n "${FAKE_ARM:-}" ] && : >"$FAKE/disarmed"
            exit 0 ;;
          r)
            [ -e "$FAKE/disarmed" ] && exit 0
            id=${vis[sel]:-}
            [ -n "$id" ] && grep -qx "$id" "$FAKE/ended" 2>/dev/null || exit 0
            [ "${FAKE_REMOVE:-}" = keep ] || echo "$id" >>"$FAKE/gone"
            visible
            [ "$sel" -lt "$rows" ] || sel=$((rows - 1))
            [ "${FAKE_REMOVE:-}" = reset ] && sel=0
            ring=$sel ;;
          [1-4])
            [ -n "${FAKE_TABLATE:-}" ] && ring=$((rows + FAKE_STOPS - 1))
            [ -n "${FAKE_TABKEY:-}" ] && [ -z "${FAKE_TABLATE:-}" ] || { echo "$ring $sel" >"$FAKE/ring"; exit 0; }
            case $FAKE_TABKEY in
              stop) ring=$rows ;;
              search) ring=$((rows + FAKE_STOPS - 1)) ;; # the stop just before row 0
              *) ring=$sel ;;
            esac
            [ -n "${FAKE_TABRESET:-}" ] && { ring=0; sel=0; } ;;
          *) exit 0 ;;
        esac
        [ "$ring" -ge 0 ] && [ "$ring" -lt "$rows" ] && sel=$ring
        echo "$ring $sel" >"$FAKE/ring"
      fi
    fi ;;
  capture-pane)
    [ "${FAKE_CAP:-}" = fail ] && exit 1
    # The transcript: what the script typed, and FAKE_SCREEN.
    mapfile -t left < <(cat "$FAKE/screen" 2>/dev/null; printf '%s\n' "${FAKE_SCREEN:-}")
    # The pane opens on /rabe; FAKE_PANE=none keeps it closed.
    right=()
    if [ -e "$FAKE/late" ]; then
      read -r t n <"$FAKE/late"
      if [ "$n" -gt 1 ]; then
        echo "$t $((n - 1))" >"$FAKE/late"
      else
        echo "$t" >"$FAKE/tab"
        rm -f "$FAKE/late"
        read -r ring sel 2>/dev/null <"$FAKE/ring" && echo "$sel $sel" >"$FAKE/ring"
      fi
    fi
    if grep -qx /rabe "$FAKE/screen" 2>/dev/null && [ "${FAKE_PANE:-}" != none ] && [ ! -e "$FAKE/closed" ]; then
      tab=$(cat "$FAKE/tab" 2>/dev/null || echo 1)
      at=(0 1 15 26 40)
      rule=$(printf '─%.0s' $(seq 1 "${at[tab]}"))━━━──────────
      tabs=(' 1: Items 4    2: Cost    3: Effects    4: Timeline' "$rule")
      field=0 text=
      read -r field text 2>/dev/null <"$FAKE/field"
      if [ "$field" = 1 ] || [ -n "$text" ]; then tabs+=("search: $text"); else tabs+=('search: title, kind or command'); fi
      visible
      : >"$FAKE/opened"
      { [ -n "${FAKE_DETAIL:-}" ] || [ -e "$FAKE/detail" ]; } && tabs+=(' b back · esc close')
      if [ -z "${FAKE_LIST:-}" ]; then
        right=("${tabs[@]}")
      else
        read -r ring sel 2>/dev/null <"$FAKE/ring" || { ring=$FAKE_RING; sel=$FAKE_RING; }
        # A scrolled list starts at the lines just above the selected row: its
        # group header and agent heading show, the tab row and the rows above
        # do not.
        from=0
        if [ -n "${FAKE_SCROLL:-}" ] && [ "$ring" != -1 ]; then from=$sel; else right=("${tabs[@]}"); fi
        n=0 id=0 rowk=()
        for w in $FAKE_LIST; do
          if [[ $w == [ri] ]] && [[ " ${vis[*]} " != *" $id "* ]]; then
            id=$((id + 1))
            continue
          fi
          case $w in
            H:*) line="▾ ${w#H:} 2" ;;
            F:*) line=" ◐ ${w#F:}" ;;
            *) [ "$n" = "$sel" ] && m=▌ || m=' '
               title="row $n"
               # FAKE_TG=1: a glyph inside the title, differing after it.
               [ -n "${FAKE_TG:-}" ] && title="worker █ ${letters[n]:-z}"
               [ -n "${FAKE_SLEEP:-}" ] && title="sleep ${durs[id]:-}"
               # FAKE_ZTITLE=desc: Claude shows the description, not the comment.
               [ "$id" = 0 ] && [ -e "$FAKE/zebra" ] && [ "${FAKE_ZTITLE:-}" != desc ] && title+=" # zebra nap"
               g=▶
               grep -qx "$id" "$FAKE/ended" 2>/dev/null && g=■
               [ "$w" = i ] && line="$m  $g $title" || line="$m$g $title"
               # FAKE_BAR: a Timeline bar one space after the title, one cell
               # longer at each draw, as a running item's bar grows (#233).
               if [ -n "${FAKE_BAR:-}" ]; then
                 b=$(($(cat "$FAKE/bar" 2>/dev/null || echo 1) + 1))
                 echo "$b" >"$FAKE/bar"
                 line+=" $(printf '█%.0s' $(seq 1 "$b"))"
                 # =eighth: a short Cost bar of one ▌ or ▋ by turn.
                 if [ "$FAKE_BAR" = eighth ]; then
                   [ $((b / 4 % 2)) = 0 ] && line="${line% *} ▌" || line="${line% *} ▋"
                 fi
               fi ;;
          esac
          if [ "$n" -ge "$from" ]; then
            [[ $w == [ri] ]] && rowk+=("${#right[@]}:$n")
            right+=("$line")
          fi
          if [[ $w == [ri] ]]; then
            n=$((n + 1))
            id=$((id + 1))
          fi
        done
      fi
    fi
    if [ ${#right[@]} = 0 ]; then
      printf '%s\n' "${left[@]}"
    elif [ -n "${FAKE_INLINE:-}" ]; then
      # Inline, as in a narrow terminal: a box under the transcript.
      for e in "${rowk[@]}"; do echo "$((${e%:*} + ${#left[@]} + 1)) ${e#*:}"; done >"$FAKE/rowmap"
      printf '%s\n' "${left[@]}" '╭──────────────────────'
      printf '│ %s\n' "${right[@]}"
      echo '╰──────────────────────'
    else
      # Docked, as at 120 columns: right of a border at cell 24, down from the
      # top line to the rule of the prompt box. The padding counts cells.
      right=('                     ✕' "${right[@]}")
      for e in "${rowk[@]}"; do echo "$((${e%:*} + 1)) ${e#*:}"; done >"$FAKE/rowmap"
      for ((i = 0; i < (${#left[@]} > ${#right[@]} ? ${#left[@]} : ${#right[@]}); i++)); do
        l=${left[i]:-}
        l=${l:0:23}
        printf '%s%*s│%s\n' "$l" $((24 - $(printf '%s' "$l" | wc -L))) '' "${right[i]:-}"
      done
      echo '────────────────────────────────────────'
    fi ;;
  kill-server | kill-session)
    echo "$cmd" >>"$FAKE/killed"
    kill "$(cat "$FAKE/pane")" 2>/dev/null ;;
esac
exit 0
EOF
printf '#!/bin/sh\nexec "$REAL_SLEEP" 0.02\n' >"$fake/bin/sleep"
chmod +x "$fake/bin/tmux" "$fake/bin/sleep"

alive() { local s; s=$(ps -o stat= -p "$1" 2>/dev/null) && [[ $s != Z* ]]; }
dead() { local i; for i in 1 2 3 4 5 6 7 8 9 10; do alive "$1" || return 0; "$real_sleep" 0.1; done; return 1; }

# Runs `check` against the fake tmux. Leading NAME=VALUE words set the fake's
# environment; FAKE names its folder, which then holds pane, foreign and keys.
letters=(alpha beta gamma delta)
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

faked CLAUDE=./nope/claude 'a relative CLAUDE that is no file is named in the error' 2 'was not found' --shells 0
stop
faked FAKE_NEW=fail 'a failed session start is a setup error' 2 'could not start' --shells 0
expect 'a failed session start kills no tmux server' test ! -e "$FAKE/killed"
stop
faked FAKE_BUSY=1 'a socket with any session is refused' 2 'in use' --shells 0
expect 'a refused socket keeps its sessions' test ! -e "$FAKE/killed"
stop
odd="$fake/it's \$(touch $fake/ran)"
mkdir -p "$odd"
faked 'a plugin path with quotes starts as it is' 0 'round 1: captured' --shells 0 --plugin-dir "$odd"
expect 'the plugin path reaches Claude Code as one argument' grep -Fxq -- "$odd" "$FAKE/argv"
stop
faked FAKE_PANE=none 'a run where Rabe never opens is a setup error' 2 'did not open' --shells 0
stop
faked FAKE_PANE=none FAKE_SCREEN=$'Claude: Step 1: Install it\nNothing runs in the background.' \
  'tab and empty-state text in the transcript is no open pane' 2 'did not open' --shells 0
stop
faked FAKE_PANE=none FAKE_SCREEN=$'▾ SHELLS 2\n▌▶ sleep 30' \
  'list lines in the transcript are no open pane' 2 'did not open' --shells 0
stop
faked FAKE_PANE=none FAKE_SCREEN=$'  │ 1: Items 4\n  │▾ SHELLS 2\n  │▌▶ sleep 30\n  │ esc close' \
  'a box in the transcript without the pane frame is no open pane' 2 'did not open' --shells 0
stop
faked FAKE_SCREEN='Use b: back to leave' 'expect reads the pane, not the transcript' 1 'round 1: fail' \
  --shells 0 --expect 'b: back'
stop
faked FAKE_LIST='H:SHELLS r r' FAKE_STOPS=3 FAKE_RING=1 FAKE_SCREEN=$'中文 😀 wide' \
  'wide characters beside the docked pane' 0 'round 1: pass' --shells 0 --expect '^▌▶ row 0$'
stop
faked FAKE_LIST='H:SHELLS r r' FAKE_STOPS=3 FAKE_RING=1 FAKE_SCREEN=$'one\ntwo\n✅ completed ⏰ soon' \
  'wide emoji beside the group header' 0 'round 1: pass' --shells 0 --expect '^▌▶ row 0$'
stop
faked FAKE_LIST='H:SHELLS r r' FAKE_STOPS=3 FAKE_RING=1 FAKE_SCREEN=$'Cafe\u0301 combined' \
  'combining characters beside the docked pane' 0 'round 1: pass' --shells 0 --expect '^▌▶ row 0$'
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
faked FAKE_SCREEN='Use b: back to leave' 'b: back in the transcript is no open detail' 0 'round 1: captured' --shells 0
expect 'the round does not press b for the transcript' test "$(grep -c '^b$' "$FAKE/keys")" = 0
stop
faked FAKE_DETAIL=1 'rounds run with a detail open' 0 'round 2: captured' --shells 0 --repeat 2
expect 'each round leaves the detail and goes to the first tab' \
  test "$(grep -c '^b$' "$FAKE/keys"):$(grep -c '^1$' "$FAKE/keys")" = 2:2
stop
# 22 Up presses on 4 rows and 3 other stops would wrap onto row 1.
faked FAKE_LIST='H:SHELLS r r r r' FAKE_STOPS=3 FAKE_RING=2 'each round stops on the first row' 0 'round 2: pass' \
  --shells 2 --timeout 50 --repeat 2 --expect '^▌▶ row 0$'
expect 'the reset stops pressing once the first row shows' \
  test "$(grep -c '^Up$' "$FAKE/keys")" = 2
stop
faked FAKE_LIST="H:SHELLS $(printf 'r %.0s' $(seq 30))" FAKE_STOPS=3 FAKE_RING=25 FAKE_SCROLL=1 \
  'a long list resets with its header scrolled away' 0 'round 1: pass' --shells 0 --expect '^▌▶ row 0$'
stop
faked FAKE_LIST='H:AGENTS r r H:SHELLS r r H:MONITORS r r' FAKE_STOPS=3 FAKE_RING=4 FAKE_SCROLL=1 \
  'a scrolled list does not take a later group for the top' 0 'round 1: pass' --shells 0 --expect '^▌▶ row 0$'
stop
faked FAKE_LIST='H:AGENTS r r H:SHELLS r r H:MONITORS r r' FAKE_STOPS=3 FAKE_RING=4 FAKE_SCROLL=1 \
  FAKE_SCREEN=' 1: Items' 'a tab row quoted in the transcript is no list top' 0 'round 1: pass' \
  --shells 0 --expect '^▌▶ row 0$'
stop
faked FAKE_LIST='H:SHELLS r r r r' FAKE_STOPS=3 FAKE_RING=2 FAKE_INLINE=1 'an inline pane resets too' 0 \
  'round 1: pass' --shells 0 --expect '^▌▶ row 0$'
stop
faked FAKE_LIST='H:SHELLS F:reviewer i i H:MONITORS r' FAKE_STOPS=3 FAKE_RING=1 \
  'an agent heading above the first row still resets' 0 'round 1: pass' --shells 0 --expect '^▌  ▶ row 0$'
stop
faked FAKE_LIST='H:SHELLS r r r r' FAKE_STOPS=3 FAKE_RING=2 FAKE_UP=ignore 'a first row that never shows is a setup error' 2 \
  'could not select the first row' --shells 0
stop

seqs=(FAKE_SLEEP=1 "FAKE_LIST=H:SHELLS r r r r" FAKE_STOPS=3 FAKE_RING=0 FAKE_TABKEY=ok)
sq() { faked "${seqs[@]}" "$@"; stop; }
sq 'a sequence that passes in every round is PASS' 0 'PASS ring-2 2/2' --shells 3 --timeout 50 --repeat 2 --sequences ring-2
sq 'ring-3 and ring-4 press their tab key' 0 'PASS ring-4 1/1' --shells 3 --timeout 50 --sequences ring-3,ring-4
expect 'ring-3 sends its own tab key' grep -qx 3 "$FAKE/keys"
sq FAKE_TABLATE=2 'a tab that lands late is waited for before Down' 0 'PASS ring-3 2/2' --shells 3 --timeout 50 --repeat 2 --sequences ring-3
sq FAKE_TABKEY=stop 'a ring left on a stop after the tab key is FAIL' 1 'FAIL ring-2 0/1' --shells 3 --timeout 50 --sequences ring-2
sq 'a field that reads what was typed is PASS' 0 'PASS search-keys 1/1' --shells 3 --timeout 50 --sequences search-keys
sq FAKE_FIELD=eat 'a field that loses a key is FAIL' 1 'FAIL search-keys 0/1' --shells 3 --timeout 50 --sequences search-keys
sq FAKE_ZTITLE=desc 'a matching row whose title lacks the comment is PASS' 0 'PASS search-keys 1/1' --shells 3 --timeout 50 --sequences search-keys
sq FAKE_BACKSPACE=stale 'a filter that stays after the last Backspace is FAIL' 1 'FAIL search-keys 0/1' --shells 3 --timeout 50 --sequences search-keys
sq FAKE_BACKSPACE=blur 'a field that loses the focus when rows return is FAIL' 1 'FAIL search-keys 0/1' --shells 3 --timeout 50 --sequences search-keys
sq FAKE_BACKSPACE=lost 'a Backspace lost while a seeded row matches is FAIL' 1 'FAIL search-keys 0/1' --shells 3 --timeout 50 --sequences search-keys
sq 'Esc that leaves the field keeps the pane PASS' 0 'PASS search-esc 1/1' --shells 3 --timeout 50 --sequences search-esc
sq FAKE_ESC=close 'Esc that closes the pane is FAIL' 1 'FAIL search-esc 0/1' --shells 3 --timeout 50 --sequences search-esc
sq 'a selection kept over the Cost tab is PASS' 0 'PASS tab-selection 1/1' --shells 3 --timeout 50 --sequences tab-selection
sq FAKE_TABRESET=1 'a selection lost over the Cost tab is FAIL' 1 'FAIL tab-selection 0/1' --shells 3 --timeout 50 --sequences tab-selection
sq FAKE_TABKEY=search 'a ring that stops on the control before the first row is FAIL' 1 'FAIL ring-2 0/1' --shells 3 --timeout 50 --sequences ring-2
sq FAKE_FIELD=eat FAKE_ESC=ignore 'an Esc that leaves the focus in a field that lost a key is FAIL' 1 'FAIL search-esc 0/1' --shells 3 --timeout 50 --sequences search-esc
sq 'a click and x that stop the clicked shell is PASS' 0 'PASS click-stop 1/1' --shells 3 --timeout 50 --sequences click-stop
sq FAKE_CLICK=ignore 'x that stops another shell than the clicked one is FAIL' 1 'FAIL click-stop 0/1' --shells 3 --timeout 50 --sequences click-stop
sq 'a search that leaves one marked row that Enter opens is PASS' 0 'PASS search-enter 1/1' --shells 3 --timeout 50 --sequences search-enter
sq FAKE_ENTER=nofilter 'a search that filters nothing is FAIL' 1 'FAIL search-enter 0/1' --shells 3 --timeout 50 --sequences search-enter
sq FAKE_ENTER=nodetail 'an Enter that opens no detail is FAIL' 1 'FAIL search-enter 0/1' --shells 3 --timeout 50 --sequences search-enter
sq 'r that removes the row and marks its neighbour is PASS' 0 'PASS remove-neighbour 1/1' --shells 3 --timeout 50 --sequences remove-neighbour
sq FAKE_ARM=1 'r after the stop disarmed the pane and an arrow armed it is PASS' 0 'PASS remove-neighbour 1/1' --shells 3 --timeout 50 --sequences remove-neighbour
sq FAKE_REMOVE=reset 'r that marks the first row instead of the neighbour is FAIL' 1 'FAIL remove-neighbour 0/1' --shells 3 --timeout 50 --sequences remove-neighbour
sq FAKE_REMOVE=keep 'r that keeps the row is FAIL' 1 'FAIL remove-neighbour 0/1' --shells 3 --timeout 50 --sequences remove-neighbour
sq 'a reopened pane that marks the same row and opens it is PASS' 0 'PASS reopen 1/1' --shells 3 --timeout 50 --sequences reopen
sq 'b back on the Cost and Timeline tabs is PASS' 0 'PASS back-timeline 1/1' --shells 3 --timeout 50 --sequences back-cost,back-timeline
sq FAKE_SLEEP= FAKE_BAR=1 'a bar one space after the title is no part of the marked row is PASS' 0 'PASS back-timeline 1/1' --shells 3 --timeout 50 --sequences back-timeline
sq FAKE_SLEEP= FAKE_BAR=eighth 'a bar that ends on ▌ then ▋ is no part of the marked row is PASS' 0 'PASS back-cost 1/1' --shells 3 --timeout 50 --sequences back-cost
sq FAKE_BACK=other FAKE_SLEEP= FAKE_BAR=1 FAKE_TG=1 'a glyph inside the title keeps the rows apart: a wrong return is FAIL' 1 'FAIL back-timeline 0/1' --shells 3 --timeout 50 --sequences back-timeline
sq FAKE_SLEEP= FAKE_BAR=1 FAKE_TG=1 'a glyph inside the title with the right return is PASS' 0 'PASS back-timeline 1/1' --shells 3 --timeout 50 --sequences back-timeline
sq FAKE_BACK=items 'b that goes to the first tab is FAIL on both' 1 'FAIL back-timeline 0/1' --shells 3 --timeout 50 --sequences back-cost,back-timeline
sq FAKE_TABKEY=stop 'one failing sequence sets the exit code' 1 'PASS search-keys 1/1' --shells 3 --timeout 50 --sequences ring-2,search-keys

exit $failed
