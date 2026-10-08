---
title: How Rabe is built
description: The item model, the registry in session state, the source contract and the split between band and pane, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state]
keywords: [RabeTurn, rabe.turns, agents, workflows, agent.spawn, turn.step, turn.complete, SubagentStart, meta.json, task-notification, matcher, codex source, rabe-stop, parseRollout, codexItem, RabeCodexStep, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner, shells, monitors, crons, tasks.ts, schedule.ts, nextRun, nextRuns, parseNotifications, parseOutput, guessPort, rabe.lines, RabeLines, memoryState, parseClaude, parseCodex, act, rabe.filter, rabe.open]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views and does nothing else.

```
hooks/
  register.tsx        calls sources(on), band(on), pane(on)
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit
  sources/index.ts    Source type and sources(on), which calls each source
  sources/agents.ts   Claude subagents: items, live tokens and turns
  sources/workflows.ts  workflow runs: items, phases and their end
  sources/codex.ts    Codex plugin jobs: items, steps and /rabe-stop
  sources/shells.ts   background shells: items, exit code, port
  sources/monitors.ts monitors: items and their output lines
  sources/crons.ts    cron jobs and /loop wakeups
  tasks.ts            pure: task notifications, task output files, port guess
  schedule.ts         pure: next runs of a cron expression
  testing.ts          test helpers: state in memory, files, core stubs
  ui/band.tsx         the band above the prompt
  ui/pane.tsx         the /rabe command, its pane, file reads and actions
  ui/*.ts(x)          pure view code: lists, facts, format, parsers, tabs
types/index.d.ts      the state contract: item types and the $.state keys
```

## The engine's rule for `$`

`claude plugin validate` and `claude plugin test` scan each module before it loads. The scan follows `$` only into functions declared in the same file. It refuses a module that passes `$` to an imported function, to a method of an object, or to a function held in a list. A state reference (`{ plugin: 'rabe', key: 'items' }`) or an atom must be written in the file that uses it.

This sets the shape of Rabe:

- Shared code is pure. `model.ts` and `registry.ts` never see `$`.
- Each file that writes items has its own small write loop (below).
- `sources(on)` calls each source by name. A loop over an array of sources is refused.
- A source gets `on` only. It imports the pure registry functions it needs.
- An event may have only one hook without a matcher in the whole module. A second one stops the module from loading. Sources therefore give each hook a matcher, also when it has to match every event (`{ cwd: /^/ }` or `{ isInteractive: [true, false] }` on `session.start`, `{ agentId: /^/ }` on `turn.step`, `{ stop_hook_active: [true, false] }` on `classic.Stop`). Hooks with matchers, also equal ones, may repeat. `prompt.submit` takes a real matcher, such as `{ origin: { kind: 'task-notification' } }`.

## The item model

One type describes everything Rabe tracks. It is written in `types/index.d.ts`, because the state contract must hold every type it names and must not import. `hooks/model.ts` re-exports it, so modules import item types from `./model` or `../model`.

```ts
type RabeItemKind = 'agent' | 'workflow' | 'codex' | 'shell' | 'monitor' | 'cron'
type RabeItemStatus = 'running' | 'done' | 'failed' | 'stopped'
type RabeTokens = { input: number; output: number; cached?: number }

type RabeItemOf<K extends RabeItemKind> = {
  id: string            // itemId(kind, nativeId): 'shell:bg_4c1e', 'agent:a1b2'
  kind: K
  title: string         // the one-line name lists show
  status: RabeItemStatus
  seenAt: number        // ms epoch, when Rabe first saw the item (set by addItem)
  startedAt?: number    // absent: started before Rabe loaded
  endedAt?: number      // set by endItem
  parentId?: string     // item id of the parent (a workflow, an agent); absent: main session
  tokens?: RabeTokens   // absent: n/a
  costUsd?: number      // estimate from Rabe's price table; absent: n/a
  detail: RabeItemDetails[K]
}

type RabeItem = { [K in RabeItemKind]: RabeItemOf<K> }[RabeItemKind]
```

`kind` narrows `detail`. The details per kind:

| Kind | Detail fields |
|---|---|
| `agent` | `agentId`, `type?`, `model?`, `description?`, `transcriptPath?`, `worktreePath?`, `worktreeBranch?`, `workflowPhase?`, `workflowIndex?`, `toolCount?`, `lastTool?`, `lastToolAt?` |
| `workflow` | `runId`, `taskId?`, `scriptPath?`, `transcriptDir?`, `phases?` |
| `codex` | `jobId`, `jobKind?`, `threadId?`, `model?`, `effort?`, `sandbox?`, `prompt?`, `workspaceRoot?`, `logPath?`, `sessionPath?`, `sessionUpdatedAt?`, `isSessionMissing?`, `isSessionPartial?`, `commandCount?`, `steps?` |
| `shell` | `command`, `taskId?`, `outputPath?`, `exitCode?`, `port?` |
| `monitor` | `command`, `description?`, `taskId?`, `outputPath?`, `timeoutMs?`, `isPersistent?` |
| `cron` | `jobId`, `prompt`, `schedule?`, `humanSchedule?`, `scheduledFor?` |

An optional field that is absent means the data is not known. Views show it as `n/a`. A source that needs a new field adds it as optional to the contract, here, and in this table.

`model.ts` also has:

- `NewItem`: an item without `seenAt`, what a source passes to `addItem`.
- `ItemPatch`: the fields `updateItem` can change; `detail` is merged, not replaced.
- `EndStatus`: `done`, `failed` or `stopped`.
- `itemId(kind, nativeId)` and `mergeItem(item, patch)`. `mergeItem` always keeps the item's own `seenAt`, also when a full `RabeItem` is passed as the patch.

## The registry

The items live in one session value, `$.state` key `rabe.items`, an array in the order Rabe first saw them. It survives a hot reload. `registry.ts` has pure functions that take the list and return the next list. Each returns the same array when nothing changed. Values are compared with their object keys sorted, so `{ input: 10, output: 20 }` and `{ output: 20, input: 10 }` count as the same and cause no write:

| Function | What it does |
|---|---|
| `addItem(items, item, now)` | Appends a new item with `seenAt: now`. For a known id it merges the fields and keeps `seenAt`. |
| `updateItem(items, id, patch)` | Merges a patch into one item. Unknown id: no change. |
| `endItem(items, id, status, now)` | Sets `status` and `endedAt` on a running item. An item that already ended keeps its end. |
| `capEnded(items, max = MAX_ENDED)` | Keeps every running item and the newest 200 ended ones. |
| `commit(held, change)` | Applies a change and the cap. Answers `undefined` when nothing changed. |

To list items, read the value: `const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })`. A read while drawing subscribes the drawing, so a write draws it again.

### The write loop

Every file that writes items declares this function at its top level. It writes only when the list changed, and tries again when another hook wrote first:

```ts
import type { EngineInterface } from 'claude-code'
import { type Change, commit } from '../registry'

async function write($: Pick<EngineInterface, 'state'>, change: Change): Promise<void> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = commit(value, change)
    if (next === undefined) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next, {
      ifVersion: version,
    })
    if (isSet) return
  }
}

// in a hook:
const now = await $.clock.now()
await write($, items => addItem(items, item, now))
```

The library's `update($, atom, fn)` is not used: it writes even when `fn` returns the same value.

### Turns

The turns of a subagent live in a second session value, `$.state` key `rabe.turns`: an object from item id to a list of `RabeTurn`. They are kept apart from `rabe.items` so that the list stays small. Each turn is one model response of the agent:

```ts
type RabeToolUse = { name: string; summary?: string }   // 'Read', 'src/db.ts'
type RabeTurn = { index: number; at: number; text: string; tools: RabeToolUse[] }
```

`index` counts from 1 and keeps counting when old turns are dropped. `text` is the visible answer, cut to 300 characters. `summary` is the first of the tool's `file_path`, `command`, `pattern`, `path`, `url`, `query` or `description`, on one line of at most 80 characters. Each item keeps its newest 30 turns, and a write drops the turns of items no longer in `rabe.items`.

## The source contract

```ts
type Source = (on: On) => void
```

A source is a function in `hooks/sources/<kind>.ts` that registers its own hooks with `on`. Its hooks call `next(e)` unless they answer on purpose, and they never throw. To add a source, import it in `hooks/sources/index.ts` and call it in `sources(on)`:

```ts
export function sources(on: On): void {
  shells(on)
}
```

A source owns the items of its kind. It uses `itemId(kind, nativeId)` for ids, so another source can set `parentId` without asking it. Test a source through the engine: raise its events in a test, and watch `rabe.items` with a test hook on `state.set`.

### Starting work: `session.start` with a matcher

`pane.tsx` owns the plain `session.start` hook. Each source gives its own start hook a matcher (see the rule above): the agents source uses `{ cwd: /^/ }`, and the Codex source uses `{ isInteractive: true }`, since only a person at the prompt sees the band and the pane.

### Stopping an item: `/rabe-stop <item id>`

A view cannot pass `$` to a source, so stopping goes through a command. `/rabe-stop <item id>` is registered by the Codex source (with `immediate: true`, so it also runs during a turn). Each source that can stop its items answers it with a matcher on the id prefix, for example `{ command: 'rabe-stop', args: /^\s*codex:/ }`, and returns `{ text }` that says what happened. A view calls `$.command.run({ command: 'rabe-stop', args: item.id })` and shows the text as a toast. When a second source adds stopping, move the registration to `pane.tsx`.

## The sources

### Claude subagents: `hooks/sources/agents.ts`

One `agent` item per subagent, id `agent:<agentId>`. It covers agents the model starts, agents of workflows and teammates.

| Hook | What it does |
|---|---|
| `agent.spawn` | After `next(e)` gives the `agentId`, adds a running item: title from the description (else the type), type, model, `startedAt`. A workflow agent gets `parentId` `workflow:<runId>` and `workflowIndex`; an agent started by another agent gets `agent:<parentAgentId>`. A refused spawn adds nothing. |
| `classic.SubagentStart` | Fires inside the spawn, before `agent.spawn` adds the item, so it adds a running item (title the agent type) when none exists; the spawn then merges its fields in. Sets `transcriptPath` (`<session>/subagents/agent-<id>.jsonl`, built from the hook's `transcript_path`) and, when the hook's `cwd` is not the session's, `worktreePath`. |
| `turn.step` with `agentId` | After the response, adds its tokens (`input` is uncached plus cache writes, `cached` is cache reads), sets `model`, `toolCount`, `lastTool` and `lastToolAt`, puts the item back to running, and adds a turn to `rabe.turns`. Steps of loops Rabe has no item for (forks for compaction or memory) are ignored. |
| `turn.complete` with `agentId` | Ends the item: `answer` is done, `aborted` is stopped, `refusal` and `error` are failed. Reads the meta file once more. |
| `session.start` | Runs the poll once, then every 3 seconds with `$.clock.every`. |

The poll reads `$.agent.list()`. It adds agents Rabe has no item for (started before Rabe loaded) and ends items the list reports as `completed`, `failed` or `killed`. Then it reads the meta file of each running agent and copies `worktreePath`, `worktreeBranch` and `workflowPhase`. The meta file sits next to the transcript (`agent-<id>.meta.json`); for a workflow agent without a transcript path it is in the run's `transcriptDir`. The file appears about 1.5 seconds after the start and changes later, so the poll reads it each time.

Workflow agents are not in `$.agent.list()`: only `turn.complete` ends them.

### Workflows: `hooks/sources/workflows.ts`

One `workflow` item per run, id `workflow:<runId>`.

| Hook | What it does |
|---|---|
| `tool.call` for `Workflow` | After the call, takes `runId`, `taskId`, `workflowName`, `scriptPath` and `transcriptDir` from the result and adds a running item. A resumed run keeps its `runId` and runs again under the same item. Then it reads the script and stores the phase names of its `meta.phases` block in `phases`. A remote run has no `runId` and gets no item. |
| `prompt.submit` with origin `task-notification` | Reads `<task-id>` and `<status>` from the notification text. When the task id is a run's `taskId`, it ends the run: `completed` is done, `failed` is failed, `killed` is stopped. |

The run's agents come from `agents.ts`; they point to the run with `parentId` and carry their phase in `workflowPhase`. A view gets a run's tokens by adding up its agents.

### Codex jobs: `hooks/sources/codex.ts`

Tracks the jobs that the Codex plugin (`codex@openai-codex`) starts for this session. Data sources and their limits are in [What Rabe can see](feasibility.md#codex-jobs).

- **Poll.** `session.start` (interactive only) starts `$.clock.every(2000)`. Each poll lists the plugin's state folders, skips each whose `state.json` was not changed since the session started (`$.session.usage().startedAt`), and reads the rest. It keeps the jobs whose `sessionId` is this session's (`$.session.id()`), and checks that again in the job file, because `state.json` can hold a bare status patch without it. A job whose item already ended is not read again.
- **Item.** `codexItem(job, session)` builds the item. Title: the first line of the job's `summary` (the prompt's start). Status: `queued` and `running` are running; `completed`, `failed` and `cancelled` end the item as `done`, `failed` and `stopped`, with `endedAt` from `completedAt`. Undefined fields are left out, so a merge never erases a known value.
- **Session file.** The rollout file is found once by `threadId` in `sessions/YYYY/MM/DD` of the start day and the day before and after (the folder date is local time), then kept in `detail.sessionPath`. It is parsed again only when its `mtimeMs` differs from `detail.sessionUpdatedAt`, so an idle job causes no write. Files up to 4 MiB are read with `$.fs.read`; larger ones with `grep -m 2` (turn context and prompt) and `tail -n 200` through `$.process.run`, and the item gets `isSessionPartial`. A finished job without a session file gets `isSessionMissing`; its model and effort then come from the job's `request`, when the job was a background job.
- **`parseRollout(text)`.** Pure. Reads model, effort and sandbox (`turn_context`), the prompt (first `UserMessage`), tokens (last `token_count` total), and the steps: assistant messages, reasoning summaries when present, finished commands (`CommandExecution`, with exit code and output line count), and a running command (a `custom_tool_call` that has no output yet). Steps keep the last 50, each text cut at 300 characters. Lines that do not parse (a line still being written) are skipped.
- **Stop.** `/rabe-stop codex:<job id>` runs `node <plugin root>/scripts/codex-companion.mjs cancel <job id> --json --cwd <workspaceRoot>` with `CLAUDE_PLUGIN_DATA` set to the plugin's data folder. The plugin root is the `installPath` in `plugins/installed_plugins.json`. On success the item ends as `stopped`.

The codex detail fields are listed in the table above. `steps` holds `RabeCodexStep` values: `{ kind: 'message' | 'reasoning' | 'command', text, exitCode?, lines?, isRunning? }`.

The next three sources follow the work Claude Code runs as background tasks. Each writes items of its own kind only. The pure parsing lives in `hooks/tasks.ts` and `hooks/schedule.ts`, so views can use it too.

### Shells: `hooks/sources/shells.ts`

| Hook | What it does |
|---|---|
| `tool.call` `{ tool: 'Bash' }` | After `next(e)`: a result with `backgroundTaskId` adds `shell:<taskId>`, title the command. `outputPath` comes from the result text (`Output is being written to: …`). This covers `run_in_background`, Ctrl+B and a timed-out command. In a subagent, `parentId` is `agent:<agentId>`. |
| `prompt.submit` `{ origin: { kind: 'task-notification' } }` | Each `<task-notification>` with a `<status>` ends its shell: `completed` is done, `failed` failed, `killed` stopped. The exit code comes from the summary (`failed with exit code 3`). |
| `session.start` | Starts a poll every 2 s. It reads the output file of each running shell, guesses a port (`localhost:5173`, `port 4000`), and ends the shell at the last line `[exited with code N]` or `[killed]`. |
| `classic.Stop` | A running shell missing from `background_tasks` ends by its exit line, else as stopped. A shell in `background_tasks` that Rabe never saw is added, without `startedAt`. |

### Monitors: `hooks/sources/monitors.ts`

The same four hooks for the Monitor tool. The Monitor result has no file path, so `outputPath` is the sibling of a task output file Rabe already knows (`taskOutput`), or the `<output-file>` of the end notification.

Monitor lines are kept apart from the item, in the `$.state` key `rabe.lines`: `Record<itemId, { seen, lines: { at, text }[] }>`. `seen` counts the lines read from the file; `lines` holds the newest 200, each with the time the poll first read it ("received"). The poll and the end notification both read the file, so the last lines are kept even when the notification comes first. Notification `<event>` lines are not used: they come late and in batches.

### Cron jobs and loops: `hooks/sources/crons.ts`

| Hook | What it does |
|---|---|
| `tool.call` `{ tool: 'CronCreate' }` | Adds `cron:<id>` with `schedule`, `humanSchedule` and `prompt`. |
| `tool.call` `{ tool: 'CronDelete' }` | Ends the job as stopped. |
| `tool.call` `{ tool: 'ScheduleWakeup' }` | Ends the running wakeup as done and adds `cron:wakeup-<scheduledFor>` with `scheduledFor` and no schedule. `stop: true` ends running wakeups as stopped. The `<<autonomous-loop-dynamic>>` prompt shows as "autonomous loop". |
| `prompt.submit` `{ origin: { kind: 'scheduled-trigger' } }` | Ends the wakeups due by now (plus 90 s of jitter) as done. |
| `session.start` | Calls `CronList` and adds the jobs made before Rabe loaded. |
| `classic.Stop` | Syncs with `session_crons`: a job gone from the list ends as done (a one-time job fired, a job expired); a new one is added. Wakeups are not ended here, and a listed job whose prompt matches a running wakeup is not added twice. |

`schedule.ts` has `nextRun(expr, from)` and `nextRuns(expr, from, count)`: the next times a 5-field cron expression matches in local time, after `from`. It reads `*`, numbers, ranges, lists and steps; day of month and day of week match either one when both are set, as in cron. A broken or impossible expression gives `undefined` (an empty list). Claude Code adds up to 10 % jitter to recurring jobs, which this does not show. The band countdown and the cron detail use `nextRuns` too.

## Testing sources

The test's `$` has no `state` noun. `memoryState(on)` from `hooks/testing.ts` answers `state.get` and `state.set` from memory, with versions, and returns the record to read (`state['rabe.items'].value`). `files(on, held)` answers `fs.stat` and `fs.read` from a record. `core(on)` answers the events the tests raise that nothing beneath the plugins answers: `prompt.submit`, `session.start`, `command.register` and `classic.Stop`. Tool results come from a test hook on `tool.call`, and `mock.clock` drives the poll.

## The views

The band and the pane read `rabe.items` and draw. Neither writes items. Shared view code is pure: it gets the surface's element table and an `act(action)` callback, never `$`. Only `pane.tsx` turns an action into `$` calls, in its top-level `act($, action)`.

| File | What it holds |
|---|---|
| `ui/band.tsx` | `band(on)`: the band above the prompt |
| `ui/pane.tsx` | `pane(on)`: `/rabe`, the pane, the redraw tick, file reads and actions |
| `ui/items.tsx` | Items tab: filter row, search, grouped list, summary, detail views per kind |
| `ui/tabs.tsx` | Cost, Effects and Timeline tabs |
| `ui/view.ts` | `Ui`, `View`, `Action`, `Loaded`, and which items can be stopped |
| `ui/lists.ts` | Pure grouping, sorting, labels, band rows, totals, phases, tree, bars |
| `ui/facts.ts` | The fact lines of one item (model, worktree, spend, start, exit code) |
| `ui/format.ts` | Durations, ages, countdowns, token and dollar amounts, `fit` |
| `ui/transcript.ts` | `parseClaude(text)`: a subagent transcript as brief, turns and tools |
| `ui/rollout.ts` | `parseCodex(text)`: a Codex session file as model, tokens, turns and commands |
| `ui/fixtures.ts` | Fake items for the tests; nothing else imports it |

### The band

A `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise it draws one row per kind that has something to show: `claude`, `codex`, `workflow` (phase and agent count), `shells` (with port), `failed` (ended in the last 10 minutes), `watch` (monitors) and `cron` (countdown to the next run), then a `$ cost` row when any tokens are known. Each row lists names until the width is used and ends with `+N`. When the rows do not fit in `maxRows`, the band draws one line instead: `◐ 3 agents (2 claude, 1 codex) · ▶ 2 shells · ✗ 1 failed · …`. The engine owns collapsing (ctrl+x ctrl+a); the hook gets no collapsed flag.

### The pane

`/rabe` opens the pane `rabe`. The command cannot focus it (see feasibility), so `pane.tsx` opens it again with `focus: true` from `$.clock.after(1500)`. Until the pane holds the keys, the last line says "tab to select · esc close".

The tab Buttons have the hotkeys `1` to `4`. The selected tab is `rabe.tab`. Each other value the pane keeps is a `$.state` key too, so a hot reload keeps it:

| Key | What it holds |
|---|---|
| `rabe.filter` | `all`, `agents`, `shells`, `monitors`, `cron` or `failed` |
| `rabe.query` | The search text; matches title, kind, command, prompt, description and agent type |
| `rabe.page` | The page of a filtered list |
| `rabe.folded` | The groups folded in the All view |
| `rabe.selected` | The item under the focus (set from `ui.focus`) or last opened |
| `rabe.open` | The item whose full detail shows; `''` shows the list |

Keys follow the feasibility key model: every row is a focusable `Button` (`row:<item id>`), Tab and Down move, Enter opens. Hotkeys are lowercase letters: `s` search (moves the focus to the search `Input`), `x` stop, `g` stop group or stop run, `f` follow (scroll to the end), `m` message agent, `c` copy command or prompt, `d` delete a cron job, `b` back to the list. Mobile has no `Input`, so the search and the message field are left out there.

**Items tab.** A filter row (All, Agents, Shells, Monitors, Cron, Failed when any) and the search field. The All view groups items: failed first, then agents (Claude, Codex, workflows), shells, monitors and cron. Inside a group, running items come first, then the newest. A group header folds the group. Each row reads status word, kind, name, time. A docked pane 100 or more columns wide shows the selected item beside the list; a narrow or inline pane shows one summary line under the list. Enter opens the full detail in the same pane.

**Detail per kind.** Every detail shows the item's facts, then:

- Agent: brief, older turns folded into one line with tool counts, the last turns with their tools (`⎿ Edit path`, running or error marks), from the transcript at `transcriptPath`.
- Codex: prompt, turns (`◆`) with their commands, exit codes and line counts, the result when done, from the session file at `sessionPath`.
- Workflow: the phases as `✓ Review → ◐ Verify → · Report`, and the agents of each phase as rows.
- Shell and monitor: the last lines of the output file.
- Cron: the next five runs, computed from the schedule.

A file that cannot be read shows a line starting with `Error`; a file over 4 MiB is read with `tail -n 400` through `$.process.run` and shows a `Warning`. Missing fields show `n/a`, and an item without `startedAt` says "started before Rabe loaded".

**Cost tab.** Session total, tokens, Claude and Codex totals, the number of items without tokens, and agents and Codex jobs sorted by tokens. **Effects tab.** Worktrees from agent details, and ports of running shells with the `ssh -L` command; Enter copies it. **Timeline tab.** One bar per item over the session, and the tree of who started what, from `parentId`.

**Long lists.** The pane draws only what fits in `scroll.bodyRows`: each group in the All view shows a share of the rows and ends with "… N more", which opens that group's filter; a filtered list is paged ("… N more · page 1 of 3"). Turn views keep the last turns and fold the rest; Cost and Timeline end with "… N more".

**Live updates.** `session.start` starts `$.clock.every(1000)`, which calls `$.ui.invalidate('ui.render')` while any item runs. The pane re-reads the open item's file on each draw.

**Actions.** Stop calls `TaskStop` with the task id (shells, monitors, workflows) or the agent id. Delete calls `CronDelete`. Message calls `$.session.send` to the agent. Copy calls `$.ui.copy`. Each answers with a toast: "Stopping …", "Stop refused: …", "Stopped 7 of 9; 2 had already finished", "Message sent to …".

Both views are tested on the `terminal` and `desktop` surfaces. Tests feed items with a test hook on `state.get` that answers `rabe.items`, files with hooks on `fs.stat` and `fs.read`, and fix the time with `mock.clock`.
