---
title: How to test Rabe
description: How to test the Rabe mod - unit tests of pure functions, hook and UI tests with claude-code/testing, a failing test first for each bug, live checks in a real Claude Code session through tmux with scripts/live-check.sh, and what CI runs.
tags: [testing, tdd, ci, live-check, tmux]
keywords: [key sequences, --sequences, idle, agent teams, claude plugin test, ui.close, closer, regain, claude-code/testing, mock.clock, advance, memoryState, files, core, state.set, tool.call, ui.mount, terminal, desktop, find, findAll, press, ui.focus, origin person, arm, arming, disarmed, focus order, append-only, stepRow, fixtures, live-check.sh, live-check.test.sh, test:scripts, tmux socket, send-keys, capture-pane, fake tmux, pane_pid, timeout, background shells, key handling, #37, bun run check, CI]
---

# How to test Rabe

Rabe has three kinds of checks:

1. **Unit tests** of pure functions: parsers, formatting, lists, views.
2. **Hook and UI tests** that run the mod's hooks with a mocked world and mount the band and the pane.
3. **Live checks** in a real Claude Code session, driven through tmux.

The first two run in CI on every pull request. A live check runs by hand before a release (see [RELEASING.md](../RELEASING.md)) and when a change touches keys, focus or drawing that the test kit cannot show.

## Run the tests

```sh
bun run test          # every *.test.ts and *.test.tsx under hooks/ (about 40 seconds)
bun run test:scripts  # the tests of scripts/live-check.sh, against a fake tmux (about 35 seconds)
bun run check         # lint, typecheck, strict validate, both of the above
```

`bun run test` is `claude plugin test .` from the pinned Claude Code. It runs each test file in a child process that is like the sandbox the mod runs in. There is no filter for one file or one folder: `claude plugin test hooks/ui` fails, because it looks for `hooks/hooks.json` in that folder. Run the whole suite.

## Write the failing test first

Every code change starts with a test that fails for the right reason. For a bug, the test reproduces the report: the same items, the same keys, the same order of events. Then fix the code until the test passes, and keep the test.

Tests live next to their module as `*.test.ts` or `*.test.tsx` and import their kit from `claude-code/testing`:

```ts
import { expect, mock, test } from 'claude-code/testing'
```

## Unit tests of pure code

Logic that needs no `$` lives in plain functions with plain tests: `hooks/tasks.ts`, `hooks/schedule.ts`, `hooks/writes.ts`, `hooks/prices.ts`, `hooks/ui/lists.ts`, `hooks/ui/view.ts` and the views in `hooks/ui/views/`. A test calls the function and compares the result.

The focus and arming rules are pure, so most of their tests are here. From `hooks/ui/view.test.ts`:

```ts
test('the pane starts disarmed, and only evidence of a safe ring arms it', () => {
  expect(DISARMED.isArmed).toBe(false)
  const armed = arm(DISARMED, { type: 'landed', isMoved: true })
  expect(armed.isArmed).toBe(true)
  expect(arm(armed, { type: 'reset' }).isArmed).toBe(false)
})
```

When a review or a bug finds a case that the rules miss, add the case to these tests first. Do not change an old expectation of the append-only focus order or of arming to make a new test pass: these rules prevent a stop or delete from landing on the wrong row (see [How Rabe is built](architecture.md)).

The fixtures in `hooks/ui/fixtures.ts` (`ALL`, `dev`, `ci`, `explore`, `NOW` and others) give the view and pane tests one shared set of items.

## Hook tests of the sources

A test function receives `$` and `on`. `on` registers hooks of the test that answer the world beneath the plugins; `$` raises events through the mod as Claude Code would.

The helpers in `hooks/testing.ts`:

| Helper | What it does |
|--------|--------------|
| `memoryState(on)` | Answers `state.get` and `state.set` from memory, with versions. Returns the record, keyed `plugin.key`, so the test reads what Rabe wrote: `state['rabe.items']?.value`. |
| `files(on, held)` | Answers `fs.stat` and `fs.read` from a record of paths to contents. Other paths pass on. |
| `core(on)` | Answers the events that nothing beneath the plugins answers in a test: `prompt.submit`, `session.start`, `command.register` and `classic.Stop`. |

The test's `$` has no `state` noun. To see what Rabe writes, use `memoryState`, or add a test hook on `state.set` that records the value and calls `next(e)`.

Code that reads the clock needs `mock.clock(on, { now })`. The clock stands still until the test moves it with `await clock.advance(ms)`, which runs each `$.clock.every`, `after` and `sleep` that comes due. This is how a test drives a poll, and how it checks that a poll writes state only when a value changed.

A tool result comes from a test hook on `tool.call`. From `hooks/sources/shells.test.ts`:

```ts
test('a background Bash call adds a running shell with its output file', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  bash(on) // a tool.call hook that answers like a background Bash call
  core(on)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', run_in_background: true })
  expect(state['rabe.items']?.value).toEqual([running])
})
```

## UI tests of the band and the pane

`$.ui.mount({ surface, plugin, component, requestId, props })` draws a component and returns the mounted drawing. Mount each test on both surfaces, `terminal` and `desktop`:

```ts
const SURFACES = ['terminal', 'desktop'] as const
for (const surface of SURFACES) {
  const ui = await $.ui.mount({ surface, ...PANE } as never)
  const x = await ui.find({ type: 'Button', key: 'stop' })
  expect(x?.props.hotkey).toBe('x')
  await ui.press({ key: 'stop' })
  await ui.unmount()
}
```

- Find elements by `type` and `text` (a string or a regex), or a Button by its `key`. `Text` keeps no `key`.
- `ui.press({ key })` presses a Button as the person would.
- A focus move by the person is `$.ui.focus({ ..., element, origin: { kind: 'person' } })`. The `arm` helper in `hooks/ui/pane.test.tsx` does this; without it the pane stays disarmed and `x` does nothing, as it does for a real person.
- `hold(on, items, seeds)` in `hooks/ui/pane.test.tsx` answers the sources' keys, seeds UI keys and records what the pane writes and toasts.

The test's outer `$` has no `ui.close`. To raise it, pass a fixture plugin through the test's `plugins` option. Put the call in that plugin's `register` function so the host scan can allow it. The pane close tests use `closer` in `hooks/ui/pane.test.tsx` for this. The kit refuses Rabe's own `$.ui.focus` before any hook sees it, so a pane test checks a regain by its effect (a refused move disarms the pane) and `hooks/ui/interaction.test.ts` checks its target.

A bug about focus or arming usually needs both: a pure test in `view.test.ts` for the rule, and a pane test that presses through the same steps as the report. See `the pane opens disarmed: a stop does nothing until the person moves the ring` in `hooks/ui/pane.test.tsx`.

## Live checks

The test kit does not show everything. Real key timing, the terminal's own key handling, tmux colors and Claude Code's own panes need a live session. `scripts/live-check.sh` drives one:

1. It makes a fresh temporary folder and starts Claude Code there with `--plugin-dir` set to this checkout, on its **own tmux socket**, so your other tmux sessions are not touched. A socket that already has any session is refused as a setup error. The script passes the binary, the plugin folder and the other arguments to tmux one by one, so no shell reads them and a path with quotes or `$` works.
2. It accepts the folder trust question.
3. It **seeds background work**: it asks Claude to start N background `sleep` shells with unique durations, and waits until each one runs as a process under this session's Claude Code. The prompt shows the same command text, so the screen cannot tell. If the shells do not start within `--timeout`, the run stops as a setup error.
4. Every check of the screen reads **only the Rabe pane**, so text in the transcript cannot pass for it. The pane is the text right of the longest vertical run of `│` at one terminal cell column, inside its frame: the border of the docked pane (at 120 columns), which ends on the rule of the prompt box at column 0, or the left edge of the inline box (in a narrow terminal), with `╭` above it and `╰` below. Cell columns count wide characters (CJK, emoji such as `✅` and `⏰`) as two and combining marks as none, so such text in the transcript does not move the border. The script needs a UTF-8 locale for this and sets `C.UTF-8` when there is none. `--expect` reads the pane too; a failed round still prints the whole screen.
5. For each round it opens `/rabe` and waits up to 15 seconds for the pane: its tab row (`1: Items`), its empty state or its list. If none shows, the run stops as a setup error. Then it **starts from the list**: `/rabe` keeps the open detail, the tab and the selection of the last round, so the script presses `b` when the pane shows `b back` and `1` for the Items tab. When the list shows a group header or the marker `▌` of a selected row, it presses Up one key at a time until the first row shows the marker: the row under the first group header, or in SHELLS and MONITORS the first row under an agent heading, whose rows are indented. Where all rows fit, the arrows wrap past the first row, so a fixed count of Up presses could end on any row. A list longer than the pane scrolls the whole pane: a later group's header can then be the first one on screen, so the tab row must also show above the header in the pane. Up on the first row scrolls the pane back up to it. If the first row does not show the marker after N + 100 presses, the run stops as a setup error. Then it sends the keys with a fixed gap, saves the screen to `captures/round-N.txt`, checks it against `--expect`, and closes the pane with Esc.
6. On exit it kills its own tmux session, only when it started one, stops the processes that this session's Claude Code started (the `sleep` shells among them), and removes the folder. It never stops a process by name, so two runs on different sockets do not stop each other's shells.

```sh
scripts/live-check.sh --help
scripts/live-check.sh --dry-run --keys 'Down Down Enter'   # prints the plan, starts nothing
scripts/live-check.sh --shells 3 --keys 'Down Down Enter' --expect 'b: back'
```

| Option | Default | Meaning |
|--------|---------|---------|
| `--name NAME` | `rabe-live` | tmux socket and session name. Use another name to run two checks at once. |
| `--plugin-dir DIR` | this checkout | The Rabe folder to load, for example a worktree. |
| `--shells N` | `3` | Background shells to seed. `0` seeds nothing and asks Claude nothing. |
| `--timeout SECONDS` | `90` | How long to wait for the seeded shells to start. |
| `--keys "K ..."` | none | tmux key names, such as `Down`, `Up`, `Enter`, `Tab`, `Escape`, `b`, `2`. |
| `--gap SECONDS` | `0.3` | Pause between two keys. Short gaps (0.02 to 0.05) find races in key handling. |
| `--repeat N` | `1` | Rounds. A race shows only in some rounds; use 10 or more. |
| `--sequences LIST` | none | Named key sequences instead of `--keys`; see below. |
| `--expect REGEX` | none | Extended regex the pane of each capture must match, line by line, without the border. A failed round prints the whole screen. |
| `--size COLSxROWS` | `120x40` | Terminal size. Use 140 columns or more for the pane with the detail beside the list. |
| `--keep` | off | Keep the folder, the captures and the session. Attach with `tmux -L NAME attach -t NAME`. |
| `--dry-run` | off | Print the plan and stop. |
| `--model NAME` | Claude Code's | The model of the session. A cheap one will do. |

The binary is `claude` on `PATH`, or the one named in the environment variable `CLAUDE`. The exit code is 0 when every round passed, 1 when a round failed and 2 for a usage or setup error: the socket already has a session, tmux could not start the session, the seeded shells did not start, Rabe did not open, a round could not select the first row, or a capture failed.

### Key sequences

The test kit refuses Rabe's own `ui.focus` before any hook sees it, so it cannot show a focus or landing bug (#174 and #175 needed a traced live copy). `--sequences` repeats fixed key sequences over `--repeat` rounds and prints one verdict per sequence:

```sh
scripts/live-check.sh --sequences fixed --repeat 5 --model haiku
scripts/live-check.sh --sequences pending,ring-2 --repeat 3
```

Each round starts from the list (step 5 above), runs the sequence and reads only the Rabe pane (plus the processes of this run's shells where a shell must stop). A failed round prints why and the screen. The last lines are `PASS name n/n` or `FAIL name k/n` per sequence, and the exit code is 0 when all pass, 1 when one fails, 2 for a setup error. `--sequences` needs `--shells 3` or more, and it seeds one spare shell per round for a sequence that stops or removes one (and one subagent for `back-cost`).

| Name | Keys | Passes when | Issue |
|------|------|-------------|-------|
| `ring-2`, `ring-3`, `ring-4` | tab key, `1`, `Down`, `Down` | each `Down` after the tab key and `1` lands on the next shell (three shells in a row, checked after each press), not on `s: search` | #174, #175 (fixed) |
| `click-stop` | click a running shell, `x` | the clicked shell's process stops (found by its duration), no other one | #186 |
| `search-keys` | `s z z x` | the field reads `zzx` | #180 |
| `search-esc` | `s`, type, `Esc` | the field reads `zz` before `Esc` and after `Esc` and a `z`, and the pane is still open | #187 |
| `search-enter` | `s`, a duration, `Enter`, `Enter` | one row is left and marked, and `Enter` opens it | #187 |
| `tab-selection` | `Down`, `2`, `1` | the marked row is the same | #188 |
| `remove-neighbour` | click, `x`, `r` | the removed row is gone and the marked row is the one before or after it, by name | #188 |
| `back-cost`, `back-timeline` | tab key, `Enter`, `b` | back on that tab | #185 |

`fixed` is the set that must pass on `main`. `pending` is the set of issues that are not fixed yet; it may FAIL, and the script reports it and does not hide it. `all` is both. A pending sequence moves to `fixed` in the pull request that fixes its issue. This is not run in CI: it needs a login. Run `fixed` before each release of the 0.9.x line and record the counts in the release PR.


### Issue #118 live check

Checked on 2026-10-12 with Claude Code 2.1.296 and the local fix for issue #118.
Both runs used separate tmux sockets and short arithmetic tasks without file writes.

- With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, a named teammate reported its answer and sent an idle notification. The Rabe Items pane showed `1 idle` and two ended plain subagents. The teammate detail said `idle` and kept its lifetime open through `now`. It also showed its last activity. The second plain subagent was an extra agent spawned during the task. Both plain subagents finished as `done`.
- With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset, a plain background subagent reported its answer. The Rabe Items pane showed `1 ended`, with status `done` and an end time.

These checks read the Rabe pane itself after the completion notifications.
They do not cover waking or stopping a teammate.

### Measure key handling

Issue [#37](https://github.com/lorenzh/rabe/issues/37) (arrow keys lost or reordered after a view change) was measured this way: open the pane, change the view, send several arrows with gaps of 20 to 50 ms (`2 1` switches to the Cost tab and back), and check where the focus landed, many times. With the script:

```sh
for gap in 0.02 0.03 0.05; do
  scripts/live-check.sh --shells 6 --repeat 12 --gap "$gap" \
    --keys '2 1 Down Down Down Down Down' --expect '▌'
done
```

Baseline for the fast tab key (issue [#129](https://github.com/lorenzh/rabe/issues/129), Claude Code 2.1.296, `--shells 3 --repeat 14 --keys '2 1 Down Down Down Down'`): a pass is the Items tab with the third of three rows selected. Expect about 1 of 10 rounds to stay on the Cost tab, because the engine drops the `1` before the mod sees it (see [the trace](feasibility/ui.md#a-tab-key-lost-after-a-fast-arrow-burst)). On an idle VM: 13/14 at 0.05 s and 11/14 at 0.03 s on main; on a busy VM with a trace copy: 13/14 and 12/14 at 0.03 s and 12/14 at 0.05 s. A change that is correct shows the same range, not 14/14, so compare counts over at least 28 rounds.

The selected row starts with `▌`. Make `--expect` as exact as the case needs, for example the title of the row the focus must reach. Each failed round prints the screen, so you can see where the focus went.

### Check keys without a model turn

Use a temporary copy of the plugin for offline checks. Add three ended shell fixtures through a matched `session.start` hook. Seed `rabe.items` after `next(e)` returns. Give them distinct titles such as `fixture 0`, `fixture 1` and `fixture 2`.

Block prompt submission in that copy:

```ts
on('prompt.submit', { origin: { kind: /^/ } }, async () => ({
  drop: 'Offline key fixture: prompt submission blocked',
}))
```

Run `scripts/live-check.sh` with `--plugin-dir` pointing to the copy and `--shells 0`. Use `--size 200x50` so all three rows fit. For a tab race, use `--keys '2 1 Down' --gap 0.05 --repeat 10`. Match `▌.*fixture 1` with `--expect`.

For the back-arrow case, keep the script's session with `--keep`. Open the first fixture's detail and wait for `b: back`. Send `b` and then Down 20 ms later. The marker must move to `fixture 1`. Enter must open that fixture's detail.

For opening keys, close the pane and run `/rabe` again. Send `3` after a 250 ms pause from Enter. The pane must show the Effects tab's empty state. Check the transcript for handler errors. Stop the isolated tmux server after the checks.

### Notes

- Known limit: text that draws its own box with the frame of the pane, a tab row and list lines can still pass for the pane. The script's own prompts never ask for that, so it takes model output that draws a fake pane. The width table is short, so a rarer wide or zero-width character beside the docked pane can still move the border; the run then stops as a setup error, not a pass.

- The seed prompt costs one short model turn per run. `--shells 0` skips it when the check does not need background work.
- Claude Code keeps the trust answer for the temporary folder in its own config, as for any folder you trust.
- CI runs `scripts/live-check.test.sh`. It checks the arguments, and runs the script against a fake `tmux` whose pane starts the seeded shells: setup errors (a busy socket, a pane that never opens), text in the transcript that looks like the pane (tab row, empty state, list lines, `b: back`, a box without the pane's frame), wide and combining characters beside the docked pane, `--expect` on the pane only, the docked and the inline pane, the arguments tmux gets, the seed wait, the cleanup and the reset of each round. The fake's focus wraps like the engine's, so the test fails if the reset passes the first row. Other fake lists are longer than the pane and show only the lines from the selected row's header down, with and without later groups, and one starts with an agent heading. It also runs the sequences against the same fake, with a switch for each bug (a ring that lands on a stop or on the control before the first row, a field that loses a key, an Esc that closes the pane or leaves the focus in the field, a selection lost over a tab, a click that does not move the marker, a search that filters nothing or opens no detail, an `r` that resets the marker or removes nothing, a `b` that goes to the first tab), so each verdict is shown to turn FAIL. It also shows that `x` after a click stops the clicked shell and `r` marks a neighbour of the removed row. The live run needs tmux, a signed-in Claude Code and a person to read the result.
- For a release, also do the manual live check in [RELEASING.md](../RELEASING.md): band, `/rabe`, arrow keys, Enter, a mouse click on a row, every tab, a detail of each kind, `x` on a shell and Esc.

## What CI runs

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`, on Ubuntu with Bun 1.4.0 and a 10 minute limit:

1. `bun install --frozen-lockfile`
2. `bun run lint` (Biome)
3. `bun run typecheck` (`tsc`)
4. `bun run validate` (`claude plugin validate --strict .`)
5. `bun run test` (the hook, UI and unit tests, about 40 seconds)
6. `bun run test:scripts` (the tests of the live-check script, about 35 seconds)
7. On a pull request: the docs check. A change under `hooks/`, `commands/`, `types/index.d.ts`, `data/` or `.claude-plugin/` must also change a doc, unless the pull request has the `no-docs` label.

`bun run check` runs steps 2 to 6 on your machine.
