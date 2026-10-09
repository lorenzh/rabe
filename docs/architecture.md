---
title: How Rabe is built
description: The item model, the registry in session state, the source contract, the cell engine and the view contract behind the band and the pane, and how Rabe hides Claude Code's own count of background work, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state, raster]
keywords: [changedFile, staged, cleanup, rabe.evicted, keepItems, evict, MAX_EVICTED, Raster, clip, clamp, bounded, edits, Hangul Jamo, ui.panes, combining mark, detail.prompt, costView, effectsView, timelineView, touched, previousOf, RabePrevious, $.store, session.end, session.usage, conflict, files touched, load, long tool, stuck, moveButtons, windowStart, cells, grid, palette, DEFAULT, View, Drawn, ViewButton, ViewInput, Selection, render, paneView, bandView, itemsView, detailView, TABS, controlRows, SPLIT_COLUMNS, bodyColumns, closeOnEscape, PromptHint, TurnDuration, hideBuiltinTasks, stripTasks, RabeTurn, rabe.turns, agents, workflows, agent.spawn, turn.step, turn.complete, SubagentStart, meta.json, task-notification, matcher, codex source, rabe-stop, detailLines, costBox, $.command.run, parseRollout, codexItem, RabeCodexStep, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner, shells, monitors, crons, tasks.ts, schedule.ts, nextRun, nextRuns, parseNotifications, parseOutput, guessPort, rabe.lines, RabeLines, memoryState, act, rabe.selected, rabe.open, bandRows, nameSpans, joinFit, chip, summary line, desktop fallback]
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
  sources/cleanup.ts  after each write of the items: evicted ids, lines and turns of dropped items
  tasks.ts            pure: task notifications, task output files, port guess
  schedule.ts         pure: next runs of a cron expression
  testing.ts          test helpers: state in memory, files, core stubs
  ui/band.tsx         the band above the prompt
  ui/pane.tsx         the /rabe command, its pane and actions
  ui/builtin.tsx      hides Claude Code's own count of background work
  ui/render.tsx       one renderer: a view's grid as a Raster, or as Text and Buttons
  ui/view.ts          the view contract: Model, Size, Selection, Drawn, View, Action
  ui/cells/           pure cell engine (grid.ts) and the mockup colors (palette.ts)
  ui/views/           pure views: band, pane frame, items, detail, cost, effects, timeline
  ui/*.ts             pure helpers: lists, facts, format
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
  costUsd?: number      // dollar estimate; no source sets it yet (no price table), so views show n/a
  detail: RabeItemDetails[K]
}

type RabeItem = { [K in RabeItemKind]: RabeItemOf<K> }[RabeItemKind]
```

`kind` narrows `detail`. The details per kind:

| Kind | Detail fields |
|---|---|
| `agent` | `agentId`, `type?`, `model?`, `description?`, `transcriptPath?`, `cwd?`, `worktreePath?`, `worktreeBranch?`, `workflowPhase?`, `workflowIndex?`, `toolCount?`, `lastTool?`, `lastToolAt?`, `edits?` (`{ path, at }[]`, the newest 100 edits the engine ran) |
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
| `capEnded(items, max = MAX_ENDED)` | Keeps every running item and the newest 200 ended ones. The cleanup hook applies it to every write (see Cleanup after a write). |
| `commit(held, change)` | Applies a change. Answers `undefined` when the capped result is the held list: nothing changed, or the cap drops what the change added (an old ended item a poll finds again), so a poll then writes no state. Else it answers the changed list, uncapped: the cleanup hook applies the cap as the list is written. |
| `keepItems(record, items)` | The entries of a per-item record (`rabe.lines`, `rabe.turns`) whose key is still an item id; the same record when nothing goes. |
| `evict(evicted, before, after)` | Appends the ids a write dropped to the newest 1000 evicted ids (`MAX_EVICTED`); the same list when it dropped none. |

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

### Cleanup after a write: `hooks/sources/cleanup.ts`

Per-item state outside `rabe.items` must leave with its item. Any write loop can drop items, since `commit` applies the cap, so the cleanup does not live in the write loops. `cleanup(on)` hooks `state.set` with the matcher `{ plugin: 'rabe', key: 'items' }`, which every write of the list passes, whichever file made it. It applies the cap (`capEnded`) and passes the capped list on with `next({ ...e, value })`, so it knows each id the cap drops, also one the same write added. After the write lands it:

- appends the ids the write dropped (in `e.previous` or the written list, not in the capped list) to `rabe.evicted`, the newest 1000;
- drops the entries of `rabe.lines` and `rabe.turns` whose id is no longer in the list.

Each of the three writes only when its value changed. So the output buffers and the turns follow the cap whether or not the dropped item's output changed. The writers of `rabe.lines` and `rabe.turns` only set their own entry. Polls read `rabe.evicted` so that they do not add an ended item the cap dropped (see the agents and Codex sources).

### Turns

The turns of a subagent live in a second session value, `$.state` key `rabe.turns`: an object from item id to a list of `RabeTurn`. They are kept apart from `rabe.items` so that the list stays small. Each turn is one model response of the agent:

```ts
type RabeToolUse = { name: string; summary?: string }   // 'Read', 'src/db.ts'
type RabeTurn = { index: number; at: number; text: string; tools: RabeToolUse[] }
```

`index` counts from 1 and keeps counting when old turns are dropped. `text` is the visible answer, cut to 300 characters with `…` at the end (`clip` in `model.ts`). `summary` is the first of the tool's `file_path`, `command`, `pattern`, `path`, `url`, `query` or `description`, on one line of at most 80 characters; a `file_path` is kept whole, since the Effects tab tells files apart by it. Each item keeps its newest 30 turns. The turns of an item dropped from `rabe.items` go with it (see Cleanup after a write).

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

### Stopping an item

The pane stops agents, shells, monitors and workflows itself: it calls `TaskStop` through `$.tool.call` (see Actions under The pane). A Codex job has no task id, so it stops through a command instead. `/rabe-stop <item id>` is registered by the Codex source (with `immediate: true`, so it also runs during a turn). It answers with a matcher on the id prefix, `{ command: 'rabe-stop', args: /^\s*codex:/ }`, and returns `{ text }` that says what happened. The person can type `/rabe-stop codex:<job id>`. The pane's `x: stop` on a Codex job runs the same command with `$.command.run({ command: 'rabe-stop', args: <item id> })` and shows its answer as a toast, so the cancel stays in the Codex source.

## The sources

### Claude subagents: `hooks/sources/agents.ts`

One `agent` item per subagent, id `agent:<agentId>`. It covers agents the model starts, agents of workflows and teammates.

| Hook | What it does |
|---|---|
| `agent.spawn` | After `next(e)` gives the `agentId`, adds a running item: title from the description (else the type), type, model, the prompt (`detail.prompt`, cut to 600 characters), `startedAt`. A workflow agent gets `parentId` `workflow:<runId>` and `workflowIndex`; an agent started by another agent gets `agent:<parentAgentId>`. A refused spawn adds nothing. |
| `classic.SubagentStart` | Fires inside the spawn, before `agent.spawn` adds the item, so it adds a running item (title the agent type) when none exists; the spawn then merges its fields in. Sets `transcriptPath` (`<session>/subagents/agent-<id>.jsonl`, built from the hook's `transcript_path`), `cwd`, and, when the hook's `cwd` is not the session's, `worktreePath`. |
| `turn.step` with `agentId` | After the response, adds its tokens (`input` is uncached input plus cache writes plus cache reads, `cached` is the cache reads inside `input`, the same as Codex counts them), sets `model`, `toolCount`, `lastTool` and `lastToolAt`, puts the item back to running, and adds a turn to `rabe.turns`. Steps of loops Rabe has no item for (forks for compaction or memory) are ignored. |
| `tool.call` for `Edit` and `Write` with `agentId` | After the call, when it changed the file (`changedFile`: a result, no error, and not `staged` for review), adds `{ path, at }` to the agent's `detail.edits`, the path from the result's `filePath`. A refused, failed or staged edit adds nothing. The Effects tab reads these, not the turns: a turn lists the calls the model asks for, which may be refused. |
| `turn.complete` with `agentId` | Ends the item: `answer` is done, `aborted` is stopped, `refusal` and `error` are failed. Reads the meta file once more. |
| `session.start` | Runs the poll once, then every 3 seconds with `$.clock.every`. |

The poll reads `$.agent.list()`. It adds agents Rabe has no item for (started before Rabe loaded), except an ended agent whose id is in `rabe.evicted`: the cap dropped it, and adding it back with a new `seenAt` would drop another ended item on each poll. An evicted agent the list shows running again (a message resumed it) is added back. The poll also ends items the list reports as `completed`, `failed` or `killed`. Then it reads the meta file of each running agent and copies `cwd`, `worktreePath`, `worktreeBranch` and `workflowPhase`. An agent with neither `cwd` nor `worktreePath` shows its tree as `n/a`, not as the main tree. The meta file sits next to the transcript (`agent-<id>.meta.json`); for a workflow agent without a transcript path it is in the run's `transcriptDir`. The file appears about 1.5 seconds after the start and changes later, so the poll reads it each time.

Workflow agents are not in `$.agent.list()`: only `turn.complete` ends them.

### Workflows: `hooks/sources/workflows.ts`

One `workflow` item per run, id `workflow:<runId>`.

| Hook | What it does |
|---|---|
| `tool.call` for `Workflow` | After the call, takes `runId`, `taskId`, `workflowName`, `scriptPath` and `transcriptDir` from the result and adds a running item. A resumed run keeps its `runId` and runs again under the same item. Then it reads the script and stores the phase names of its `meta.phases` block in `phases`, in order, from strings and from the `title` of objects alike. A bracket inside a phase string (`'Review [fast]'`) does not end the list. A remote run has no `runId` and gets no item. |
| `prompt.submit` with origin `task-notification` | Reads `<task-id>` and `<status>` of each `<task-notification>` in the text (with `parseNotifications`; one prompt can carry several). When a task id is a run's `taskId`, it ends the run: `completed` is done, `failed` is failed, `killed` is stopped. |

The run's agents come from `agents.ts`; they point to the run with `parentId` and carry their phase in `workflowPhase`. A view gets a run's tokens by adding up its agents.

### Codex jobs: `hooks/sources/codex.ts`

Tracks the jobs that the Codex plugin (`codex@openai-codex`) starts for this session. Data sources and their limits are in [What Rabe can see](feasibility.md#codex-jobs).

- **Poll.** `session.start` (interactive only) starts `$.clock.every(2000)`. Each poll lists the plugin's state folders, skips each whose `state.json` was not changed since the session started (`$.session.usage().startedAt`), and reads the rest. It keeps the jobs whose `sessionId` is this session's (`$.session.id()`), and checks that again in the job file, because `state.json` can hold a bare status patch without it. A job whose item already ended is not read again, nor an ended job whose id is in `rabe.evicted` (the cap dropped it). The other polls add only work in flight (`background_tasks`, `session_crons`), which the cap never drops.
- **Item.** `codexItem(job, session)` builds the item. Title: the first line of the job's `summary` (the prompt's start). Status: `queued` and `running` are running; `completed`, `failed` and `cancelled` end the item as `done`, `failed` and `stopped`, with `endedAt` from `completedAt`. Undefined fields are left out, so a merge never erases a known value.
- **Session file.** The rollout file is found once by `threadId` in `sessions/YYYY/MM/DD` of the start day and the day before and after (the folder date is local time), then kept in `detail.sessionPath`. It is parsed again only when its `mtimeMs` differs from `detail.sessionUpdatedAt`, so an idle job causes no write. Files up to 4 MiB are read with `$.fs.read`; larger ones with `grep -m 2` (turn context and prompt) and `tail -n 200` through `$.process.run`, and the item gets `isSessionPartial`. A finished job without a session file gets `isSessionMissing`; its model and effort then come from the job's `request`, when the job was a background job. An unchanged file gives no new fields, so the item keeps the model and effort the file gave. A file that cannot be read gives no `sessionUpdatedAt`, so the next poll tries again; the job still ends. A failure in one job never stops the poll for the others.
- **`parseRollout(text)`.** Pure. Reads model, effort and sandbox (`turn_context`), the prompt (first `UserMessage`), tokens (last `token_count` total), and the steps: assistant messages, reasoning summaries when present, finished commands (`CommandExecution`, with exit code and output line count), and a running command (a `custom_tool_call` that has no output yet). Steps keep the last 50, each text cut at 300 characters. Lines that do not parse (a line still being written) are skipped.
- **Stop.** `/rabe-stop codex:<job id>` runs `node <plugin root>/scripts/codex-companion.mjs cancel <job id> --json --cwd <workspaceRoot>` with `CLAUDE_PLUGIN_DATA` set to the plugin's data folder. The plugin root is the `installPath` in `plugins/installed_plugins.json`. On success the item ends as `stopped`.

The codex detail fields are listed in the table above. `steps` holds `RabeCodexStep` values: `{ kind: 'message' | 'reasoning' | 'command', text, exitCode?, lines?, isRunning? }`.

The next three sources follow the work Claude Code runs as background tasks. Each writes items of its own kind only. The pure parsing lives in `hooks/tasks.ts` and `hooks/schedule.ts`, so views can use it too.

### Shells: `hooks/sources/shells.ts`

| Hook | What it does |
|---|---|
| `tool.call` `{ tool: 'Bash' }` | After `next(e)`: a result with `backgroundTaskId` adds `shell:<taskId>`, title the command. `outputPath` comes from the result text (`Output is being written to: …`). This covers `run_in_background`, Ctrl+B and a timed-out command. In a subagent, `parentId` is `agent:<agentId>`. |
| `prompt.submit` `{ origin: { kind: 'task-notification' } }` | Each `<task-notification>` with a `<status>` ends its shell: `completed` is done, `failed` failed, `killed` stopped. The exit code comes from the summary (`failed with exit code 3`). It reads the output file once more first, so a shell that ended between two polls keeps its last lines. |
| `session.start` | Starts a poll every 2 s. It reads the output file of each running shell, keeps its lines in `rabe.lines` (as the monitors source does), guesses a port (`localhost:5173`, `port 4000`), and ends the shell at the last line `[exited with code N]` or `[killed]`. A file over 4 MiB is read with `tail -c` for the port and the exit line only, so its lines stop at what the poll read before. |
| `classic.Stop` | A running shell missing from `background_tasks` ends by its exit line, else as stopped. A shell in `background_tasks` that Rabe never saw is added, without `startedAt`. Claude Code lists a Monitor tool task with type `shell` too, so a task id Rabe already has as `monitor:<id>` is skipped; a monitor started before Rabe loaded still shows as a shell. |

### Monitors: `hooks/sources/monitors.ts`

The same four hooks for the Monitor tool. The Monitor result has no file path, so `outputPath` is the sibling of a task output file Rabe already knows (`taskOutput`), or the `<output-file>` of the end notification.

The end notification is handled only for task ids Rabe has as `monitor:<id>`: a shell's notification also carries an `<output-file>`, and reading it would file shell lines under a monitor id.

Monitor lines are kept apart from the item, in the `$.state` key `rabe.lines`: `Record<itemId, { seen, lines: { at, text }[] }>`. `seen` counts the lines read from the file; `lines` holds the newest 200, each with the time the poll first read it ("received"). A last line read while it was still being written (`hel`, then `hello`) is updated in place and keeps its time. The poll and the end notification both read the file, so the last lines are kept even when the notification comes first. Notification `<event>` lines are not used: they come late and in batches. The lines of an item dropped from `rabe.items` go with it, in the write that drops it (see Cleanup after a write), as its turns do.

### Cron jobs and loops: `hooks/sources/crons.ts`

| Hook | What it does |
|---|---|
| `tool.call` `{ tool: 'CronCreate' }` | Adds `cron:<id>` with `schedule`, `humanSchedule` and `prompt`. |
| `tool.call` `{ tool: 'CronDelete' }` | Ends the job as stopped. |
| `tool.call` `{ tool: 'ScheduleWakeup' }` | Ends the running wakeup as done and adds `cron:wakeup-<scheduledFor>` with `scheduledFor` and no schedule. `stop: true` ends running wakeups as stopped. The `<<autonomous-loop-dynamic>>` prompt shows as "autonomous loop". |
| `prompt.submit` `{ origin: { kind: 'scheduled-trigger' } }` | Ends a wakeup due by now (plus 90 s, since a wakeup can fire early) as done only on evidence that it fired: the fired text is its prompt (a `/loop` wakeup fires its input verbatim), or its prompt is a sentinel such as `<<autonomous-loop-dynamic>>` and the text names it (the expanded dynamic tick tells the model to re-arm with that sentinel). Any other text ends nothing, also the expanded tick of a recurring `<<autonomous-loop>>` cron job, which names no sentinel. A wakeup whose tick Rabe does not recognise stays running until the next `ScheduleWakeup` ends it as done, or `stop: true` as stopped; it ends late, never early. |
| `session.start` | Calls `CronList` and adds the jobs made before Rabe loaded. |
| `classic.Stop` | Syncs with `session_crons`: a job gone from the list ends as done (a one-time job fired, a job expired); a new one is added. Wakeups are not ended here, and a listed job whose prompt matches a running wakeup is not added twice. |

`schedule.ts` has `nextRun(expr, from)` and `nextRuns(expr, from, count)`: the next times a 5-field cron expression matches in local time, after `from`. It reads `*`, numbers, ranges, lists and steps; day of month and day of week match either one when both are set, as in cron. Minutes advance in real time, so a next run is never earlier than `from`, also in the hour that repeats when summer time ends (a job in that hour can show twice). A broken or impossible expression gives `undefined` (an empty list). Claude Code adds up to 10 % jitter to recurring jobs, which this does not show. The band countdown and the cron detail use `nextRuns` too.

## Testing sources

The test's `$` has no `state` noun. `memoryState(on)` from `hooks/testing.ts` answers `state.get` and `state.set` from memory, with versions, and returns the record to read (`state['rabe.items'].value`). `files(on, held)` answers `fs.stat` and `fs.read` from a record. `core(on)` answers the events the tests raise that nothing beneath the plugins answers: `prompt.submit`, `session.start`, `command.register` and `classic.Stop`. Tool results come from a test hook on `tool.call`, and `mock.clock` drives the poll.

## The views

The band and the pane read the sources' session values and draw. Neither writes items, and no view reads a file: the agent turns come from `rabe.turns`, Codex steps from the item's `detail.steps`, and shell and monitor output from `rabe.lines`. Views are pure functions. Only `band.tsx`, `pane.tsx` and `builtin.tsx` touch `$`; `pane.tsx` turns an action into `$` calls in its top-level `act($, action, surface)`.

| File | What it holds |
|---|---|
| `ui/cells/grid.ts` | The cell engine: a grid, text, spans, fill, box lines, bars, wrap, paste, the `cells` encoding |
| `ui/cells/palette.ts` | The mockup colors, `DEFAULT` (the terminal's own color), chip colors per kind, `tone(item)` |
| `ui/view.ts` | The view contract: `Model`, `Size`, `Selection`, `Action`, `ViewButton`, `ViewInput`, `Drawn`, `View`; `controlRows`, `canStop`, `taskIdOf` |
| `ui/render.tsx` | `render(ui, surface, drawn, act)`: a Raster on the terminal, else Text and Buttons |
| `ui/views/band.ts` | `bandView`: the band's rows |
| `ui/views/pane.ts` | `paneView` and `TABS`: the tab row, the tab's view or the open item, the hint |
| `ui/views/items.ts` | `itemsView`: grouped list, split or one-line summary, list Buttons, search |
| `ui/views/detail.ts` | `detailView`, `detailLines` and `bodyLines`: one item in full, per kind |
| `ui/views/cost.ts`, `effects.ts`, `timeline.ts` | The other tabs |
| `ui/views/lines.ts` | `Line`, `draw`, `text`, `itemLine`, `headLines`: shared row drawing |
| `ui/lists.ts` | Pure grouping, sorting, labels, band rows, totals, phases, tree, bars |
| `ui/facts.ts` | The fact lines of one item (model, worktree, spend, start, exit code) |
| `ui/format.ts` | Durations, ages, countdowns, token and dollar amounts |
| `ui/fixtures.ts` | Fake items and `screen(ui)` for the tests; nothing else imports it |

### The cell engine

A Raster is a fixed grid of terminal cells. Each cell is exactly `[codePoint, foreground, background]`: a code point is one printable width-1 BMP character, a color is `0x00RRGGBB` or `0x01000000` for the terminal's default. A Raster has no bold, underline or italic, so emphasis is color and background (the active tab gets a `━` line under it, the selected row a background and a `▌`). It is a leaf: no press and no focus.

`hooks/ui/cells/grid.ts` builds such grids with plain functions and no `$`. They change the grid they are given and return nothing or the next column:

| Function | What it does |
|---|---|
| `grid(columns, rows, style?)` | A grid of spaces in the default colors (or the style's) |
| `safe(text)` | One cell per character: whitespace becomes a space; a wide, emoji, control or non-BMP character, a combining mark or a format character (any script, such as the Devanagari virama), or a Hangul Jamo vowel or final (U+1160 to U+11FF, U+D7B0 to U+D7FF, which take no cell) becomes `?` |
| `clamp(g)` | The grid cut to the 512 columns and 256 rows a Raster takes; `render` applies it to every Raster as a last guard. The pane and the band already pass the views a size within these bounds (`bounded` in `view.ts`) |
| `fit(text, width)` | Pads, or cuts with `…`, to exactly `width` cells |
| `write(g, x, y, text, style?)` | Text from `(x, y)`, clipped at the edge; a style leaves the colors it does not name |
| `spans(g, x, y, [[text, style], …], width?)` | Runs of styled text, the last cut with `…` at `width` |
| `wrap(text, width)` | Lines of at most `width` cells, split at spaces |
| `fill(g, x, y, w, h, style?, ch?)`, `hline`, `vline`, `box` | Rectangles and box lines (`─ │ ┌ ┐ └ ┘`) |
| `bar(value, max, width)` | A bar in eighths of a block (`█▉▊▋▌▍▎▏`), padded |
| `paste(g, src, x, y)` | Copies one grid into another, clipped |
| `encode(g)` / `decode(columns, rows, base64)` | The Raster `cells` string: little-endian u32 triplets in padded base64 |
| `lines(g)` | The text of each row, trailing spaces cut: the text fallback and the tests |

`palette.ts` holds the colors of the mockups (`C.orange`, `C.yellow`, `C.dim`, `C.selected` …), `CHIP` (foreground and background per kind, for failed, done and cost), and `tone(item)`, the glyph color of an item. Plain text and the background use `DEFAULT`, so the pane follows the person's theme.

The table of characters that are not width 1 is short; one it misses makes the engine refuse the Raster, naming the cell's index.

### The view contract

Each view is a pure function from the model, the size and the selection to a grid and the controls it needs:

```ts
type Model = { items: RabeItem[]; turns: Record<string, RabeTurn[]>; lines: Record<string, RabeLines>; now: number; usd?: number; previous?: RabePrevious }
type Size = { columns: number; rows: number; surface: RenderSurface; hasInput: boolean }
type Selection = { tab: RabeTab; query: string; folded: string[]; selected: string; open: string; isFocused: boolean }

type ViewButton = { key: string; label: string; action: Action; hotkey?: string; autoFocus?: true }
type ViewInput = { key: string; label: string; placeholder: string; submitLabel: string; value?: string; isLive?: boolean; action: (text: string) => Action }
type Drawn = {
  grid: Grid
  buttons: ViewButton[]
  inputs?: ViewInput[]
  rows?: Record<number, { key: string; action: Action }>
}
type View = (model: Model, size: Size, selection: Selection) => Drawn
```

- A view draws a grid of exactly `size.columns` columns and at most `size.rows` rows. `columns` is the site's `bodyColumns`, read on every draw, so a Raster is never wider than the body (a wider one is cut on the right, and the engine's `[-]` draws over its top row).
- A view registers its keys by returning `buttons`. The label carries the key (`j: down`), since the engine does not draw hotkeys. Hotkeys are one digit or one lowercase letter. A Button with `autoFocus` takes the focus, so Enter presses it: the list's `open` and the detail's `b: back` do this.
- `inputs` are drawn under the Buttons where the surface has `Input` (`size.hasInput`). A focused Input takes every key, also the hotkeys, so a view offers a Button that focuses it (`s: search`, `m: message`) instead of focusing it itself.
- `rows` maps grid rows to actions. The terminal cannot press a Raster cell; the text fallback draws such a row as a Button keyed `key` (`row:<item id>`, `group-<id>`).
- `Action` is what pressing does: `tab`, `select`, `open`, `fold`, `query`, `focus`, `stop`, `delete`, `copy` and `message`. `pane.tsx` runs it.

A new view is a file in `hooks/ui/views/` that exports a `View`. A new tab adds its view and label to `TABS` in `views/pane.ts` and its name to `RabeTab`. A new detail adds a case to `bodyLines` in `views/detail.ts`. Neither touches the renderer or `pane.tsx` unless it needs a new `Action`.

### The renderer

`render(ui, surface, drawn, act)` in `ui/render.tsx` is the one place that turns a `Drawn` into elements:

- On the terminal: a `Raster` keyed `cells` (the band's is keyed `band`) with the grid's size and `encode(grid)`, then a row of Buttons, then the Inputs. The engine refuses a Raster over 512 columns or 256 rows, so on the terminal `bounded(size)` caps the size before the view lays out: a view keeps its selected row inside the rows it draws, and a cut after layout would hide it. `clamp` stays as a guard.
- On every other surface: one `Text` per grid row (trailing spaces cut), or a plain `Button` for a row in `rows`, then the same Buttons and Inputs. The desktop draws an empty Box for a Raster though `$.ui.resolve` hands one out, so the choice is `surface === 'terminal'`, not whether `Raster` exists.

The renderer redraws the whole Raster on each draw. `$.ui.blit` repaints only changed cells, but it is refused after a size change, so it is not used yet.

### Sizing

`paneView` gives the tab's view `scroll.bodyRows` less the tab row and its rule (2), the hint (1) and the rows its Buttons and Inputs take (`controlRows`: Buttons as `[ label ]` with a gap, wrapped at `bodyColumns`, plus one row per Input). It calls the view twice: once to learn its controls, once with the rows left. So the grid and the controls fill the body without scrolling.

The Items tab splits into list and detail side by side only on the terminal and when `bodyColumns` is at least 90 (`SPLIT_COLUMNS`). A docked pane asked for 100 columns gets about 72 at a 200-column terminal, and an inline one at 100 terminal columns gets 96. Below 90 the list fills the width and ends with one summary line of the selected item on the panel background (`◐ review auth.ts · gpt-6.1-sol · ≈ $0.09 · 25k in · running`), and Enter opens the full detail in place; `b` goes back. The list keeps an empty line between groups only when the whole list fits; otherwise it drops them and the window follows the selected row.

### The band

A `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise `bandView` draws one row per kind that has something to show: failed (ended in the last 10 minutes) first, then `claude`, `codex`, `workflow` (phase and agent count), `shells` (with port), `watch` (monitors) and `cron` (countdown to the next run), then a `$ cost` row when any tokens are known. Each row starts with a chip in its kind's colors (`CHIP`), padded to the longest label so the names line up, and lists names until the width is used, ending with a dim `+N`. Names are plain; times, workflow phases and the ` · ` between names are dim, a shell's port is blue, a failed shell's exit code red, and a cron job's next run (`· next 3:48`) bright. The cost row starts with the dollar amount, bright (`≈ $0.04 · 43k tok · top: raven poem 21k`), or `cost n/a`. The amount is the session's cost from `$.session.usage().cost.usd`, as `/cost` totals it, when the host has one; else the sum of the items' dollars. When the rows do not fit in `maxRows`, the band draws one line of count chips instead, failed first, then the cost: `✗ 1 failed  ◐ 2 claude  ▶ 2 shells  ◉ 1 monitor  ⟳ 1 cron  ≈ $0.04 · 43k tok`. `lists.ts` gives the band its rows as spans (`bandRows`, `nameSpans`, `joinFit`).

The grid is `bodyColumns` wide and exactly as tall as its lines. The band before drew padded `Text` labels in a row; beside an open pane the band is narrow, a label wrapped its trailing spaces, and the band drew an empty line. The engine owns collapsing (ctrl+x ctrl+a); the hook gets no collapsed flag.

### The pane

`/rabe` opens the pane `rabe` with `closeOnEscape`, so Esc closes it; without it Esc only hands the keys back and the pane stays. The command cannot focus it (see feasibility), so `pane.tsx` opens it again with `focus: true` from `$.clock.after(1500)`, but only while `$.ui.panes()` still lists it: a pane closed with Esc in that time stays closed. Until the pane holds the keys, the hint says "tab to select · esc close".

On the terminal `paneView` draws the tab row (the active one orange with a `━` line under it): `Items 7    Cost    Effects    Timeline` and `1-4 switch` at the right end at 90 columns and more, `Items 7  Cost  Effects  Timeline` below. It adds the tab Buttons `1` to `4`, labeled with the digit only. Off the terminal the tab Buttons are the tab row (`Items 7`, `Cost`, … with the same hotkeys), so the grid starts with the tab's view. Each value the pane keeps is a `$.state` key, so a hot reload keeps it:

| Key | What it holds |
|---|---|
| `rabe.tab` | The selected tab |
| `rabe.query` | The search text; matches title, kind, command, prompt, description and agent type |
| `rabe.folded` | The groups folded in the list (folded from a group row off the terminal) |
| `rabe.selected` | The item under the cursor: set by `j`/`k`, by focus on a row Button, or by opening |
| `rabe.open` | The item whose full detail shows; `''` shows the list |

Keys: the Buttons under the grid hold them. On the list: `j` down, `k` up, Enter opens (the `open` Button has the focus), `x` stop, `g` stop the group, `s` search. `j` and `k` stay bound at the ends of the list (they select the same row), so they never fall through to the prompt. Below the split the labels of `j`, `k` and `s` keep only the letter; `x: stop` and `g: stop group` keep their word. The hint under every tab names the keys its Buttons bind (`j/k move · enter open · x stop · esc close`; the Effects tab, which has no move Buttons, only `esc close`). `b` back on the list moves the focus to `open` with `$.ui.focus`, since the ring would else stay on the first Button (`j`) and Enter would move instead of open. In a detail: `b` back, `c` copy the command or prompt, `d` delete a cron job, `m` message an agent, `x` stop, `g` stop a workflow run. A letter no Button binds moves the focus to the prompt, and the next keys type into the composer; no hook can keep them (see feasibility).

**Items tab.** Groups: failed first, then agents (Claude, Codex, workflows), shells, monitors and cron; inside a group running items first, then the newest. A group row is `▾ AGENTS` in the group's color and a dim note (`2 claude · 1 codex`, `2 running`). A row reads glyph (colored by `tone`), name, and the time, or the status word and age once it ended. The selected row has an orange `▌`, the `selected` background, a bright name and a plain time; other times are dim, and ended names too. The window follows the selected row.

**Desktop.** Off the terminal the list is text the renderer turns into Buttons: group rows read `Agents 2` (`Shells 1 · folded` when folded) and fold on press; item rows read `▶ python3 -u -m http.server · :4173 · 47s` and open on press. The grid holds the whole list, never windowed, since the desktop scrolls the rows itself; the list has no `j`, `k` or `open` Buttons (a press or Enter on a row opens it, and focus on a row selects it), and there is no summary line.

**Detail per kind.** `detailLines(model, item, rows, width)` in `views/detail.ts` builds one item's detail; the full detail (`detailView`) and the right side of the split (`summary` in `views/items.ts`) both use it. It has three parts. The head (`headLines`) is the glyph, the title, the status word on the right, and the fact lines in dim. The top stays while the body scrolls: a cost panel and the brief or prompt, or the label of the body (`▸ output`, `▸ next runs`). The body (`bodyLines`) is cut from the start, so the newest lines show:

- Agent: a cost panel (background `C.panel`): `≈ $0.16   in 36k  out 5k  cached 12k`, then `45% of session` and, while it runs, `active 3s ago` from `lastToolAt`. Then `▸ brief` with the prompt the agent was given, or the description for an agent Rabe did not see spawn (at most three lines, cut with `…`), then the turns from `rabe.turns`: `1  ● text` (index dim, `●` orange), then `⎿ Tool summary` per tool. The last turn of a running agent has the raised background `C.raised`. An agent that ran before Rabe loaded has no turns and says so.
- Codex: the facts say model, effort and sandbox, the job id and whether the session file was read, is partial (a file over 4 MiB, the last 200 lines) or is gone. The cost panel adds the command count and takes `active` from `sessionUpdatedAt`. Then `▸ prompt`, then `detail.steps`: `●` (cyan) messages, `thinking:` reasoning summaries, and `$ command` with `✓ exit 0 · N lines`, `✗ exit N` or `◐ running` on the right; the running command is raised. `x: stop` cancels the job through `/rabe-stop` (see Stopping an item).
- Workflow: the cost panel sums the run's agents and counts them. Then the phases as `✓ Review → ◐ Verify → · Report`, and per phase its agents with their tokens and time (`22k · 40s`); on the desktop each agent row is a Button that opens it.
- Shell: `▸ output · newest last · N lines` (`1 line` for one) (N is `seen`, all lines read), the lines in `rabe.lines`, and at the end `✓ exit 0` in green or `✗ exit N` in red once the exit code is known.
- Monitor: `▸ lines received · newest last`, each line after the time the poll first read it.
- Cron: `▸ next runs`, the next five times from the schedule with a countdown (`10:55  in 3:00`); a `/loop` wakeup shows `▸ fires` and its one time. Delete shows for cron jobs only: a wakeup has no id `CronDelete` knows.

Cost, tokens and the share of the session left the fact lines for the panel; the spend there is the same sum the Cost tab uses. Cron runs seen this session and the per-tool exit codes of agents are not shown: no source records them.

**Cost tab** (`views/cost.ts`). A head row on a panel: the session's cost (`Model.usd`, from `$.session.usage().cost`, as `/cost` totals it; `session cost n/a` without it), the Claude and Codex dollar totals, tokens, the running count and the number of workers without tokens. Then agents and Codex jobs sorted by tokens: glyph, name, a bar in eighths of a block scaled to the largest, tokens, cost and run time. The bar takes the kind's color while the worker runs, green or red once it ended, and `▏` in dim where tokens are `n/a`. `j`/`k` move the selection (`rabe.selected`) and stay bound at the ends of the list (`moveButtons` in `views/lines.ts`), and Enter opens the worker in the Items tab. Under **LOAD**, running agents that look slow, from `rabe.turns`: `◷ long tool` when the last step asked for tools 2 minutes ago or more (the tool still runs), `⚠ stuck` when the last step asked for none and no step came for 5 minutes. The foot names where the session cost comes from and says when a Codex session file is gone.

**Effects tab** (`views/effects.ts`). `touched(model)` collects the files agents edited from each agent's `detail.edits`: the `Edit` and `Write` calls that changed a file for it, not the calls a turn asks for, which may be refused or staged; a path is shown relative to the agent's worktree or `cwd`. A file two agents edited is a conflict: the tab heads with `⚠ conflict  src/logger.ts is edited by A and B in the main tree` on a red background, and lists conflicts first, then the newest edits, with who edited and how many times. Two worktrees never share an absolute path, so the same file in two worktrees is no conflict. Then the worktrees (`⎇ .claude/worktrees/…  branch · agents`), the agents that share the main tree and those whose tree is `n/a`, and the ports of running shells with the `ssh -L` line; the first port's line has a background and `c copies`, and a Button per port copies it (`c` for the first). The file list gets the rows the other sections leave, ending with `… N more`.

**Timeline tab** (`views/timeline.ts`). A head with the window (`last 40 min`), a legend of chip colors and a time axis with three clock times and `now`. One row per item, sorted by start: a bar from its start to its end (or now) in the kind's color while it runs, green or red once it ended. A cron job draws a tick at each run its schedule had since Rabe saw it and before it ended, computed with `nextRun`, so jitter is not shown. A space parts the name, cut with `…`, from its bar. `j`/`k` and Enter work as in the Cost tab, and the window follows the selected row. Below: who started what (`tree`, with the kind in brackets for all but Claude agents), and the previous session in this project (`Model.previous`): side by side from 90 columns, else one under the other.

### The previous session

On `session.end` (`{ reason: /^/ }`) `pane.tsx` keeps a summary of the session in `$.store` under `previous:<cwd>`: `previousOf(items, now, usage)` counts the items per kind and holds the tokens, the session's cost and start, and the titles of failed items (`RabePrevious` in `types/index.d.ts`). A session without items keeps the last summary, so a short session with no background work does not hide the one before. The pane reads the key on each draw; a value of another shape shows as no previous session. After `/clear` the summary is the cleared conversation's.


**Live updates.** `session.start` starts `$.clock.every(1000)`, which calls `$.ui.invalidate('ui.render')` while any item runs.

**Actions.** Stop calls `TaskStop` with the task id (shells, monitors, workflows) or the agent id, and runs `/rabe-stop <item id>` for a Codex job. Delete calls `CronDelete`. Message calls `$.session.send` to the agent. Copy calls `$.ui.copy` on the surface that was pressed. Each answers with a toast: "Stopping …", "Stop refused: …", "Stopped 7 of 9; 2 had already finished", "Message sent to …".

### Hiding Claude Code's own count

Claude Code shows background work itself: a pill in the hint under the prompt (`2 shells, 1 monitor · ↓ to manage`) and a part of the line that ends a turn (`· 2 shells, 1 monitor still running`). Rabe's band shows the same, so `ui/builtin.tsx` hides both. It is on by default; the `userConfig` option `hideBuiltinTasks` in `.claude-plugin/plugin.json` turns it off, and `register` then does not call `builtin(on)`.

- `PromptHint`: `stripTasks(hint)` splits the hint at ` · ` and drops the parts that only count work (`2 shells, 1 monitor`, `1 background agent`) and `↓ to manage`. The hook passes the rest on with `next({ ...e, props: { ...e.props, hint } })`, so the PR number, `esc to interrupt` and the other parts stay. Rewriting the whole hint would drop them. The mode label (`⏵⏵ auto mode on`) is not part of `hint` and stays. ↓ still opens Claude Code's background manager.
- `TurnDuration`: the "still running" part is not a prop, so the hook draws the line itself (`✻ Brewed for 5s`, dim, one empty line above) while Rabe knows of a running shell or monitor and of no running agent or workflow. While an agent or workflow runs, the engine draws "Waiting for …" without that part, so the hook passes. The own line leaves out what has no prop: `done 1:16`, a token budget and "messages hidden".
- The agent list under the prompt stays: no component and no setting hides it (see feasibility).

Both views are tested on the `terminal` and `desktop` surfaces. Tests feed the session values with test hooks on `state.get`, fix the time with `mock.clock`, and read a drawing with `screen(ui)` from `fixtures.ts`: the decoded Raster on the terminal, the Text and Button texts elsewhere. The views can also be called directly with a model, since they are plain functions: `views/band.test.ts` and `views/items.test.ts` decode the grid and check the text and the colors at positions.
