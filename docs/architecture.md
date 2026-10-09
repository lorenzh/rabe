---
title: How Rabe is built
description: The item model, the registry in session state, the source contract, the view contract of lines and plain Buttons, focus and the arrow keys, the held list order, the 256-color palette, the cell engine of the band, and how Rabe hides Claude Code's own count of background work, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state, raster, focus, palette]
keywords: [Press, Part, Line, familyHead, stop-run, stop run, Node, fitLine, beside, focusOn, plain, rowKeys, stepRow, ui.scroll, ui.focus, autoFocus, dimColor, hover, rabe.order, RabeOrder, stable, orderOf, byStart, byParent, Family, shownFrom, size.window, scroll.offset, xterm, paint, ansi256, xterm-256, tmux, mouse, arrow keys, allow list, GLYPHS, changedFile, staged, cleanup, forget, prune, pastEnd, resume, timer writes, Raster, clip, clamp, bounded, edits, Hangul Jamo, ui.panes, combining mark, detail.prompt, costView, effectsView, timelineView, touched, previousOf, RabePrevious, $.store, session.end, session.usage, conflict, files touched, load, long tool, stuck, cells, grid, palette, DEFAULT, View, Drawn, ViewButton, ViewInput, Selection, render, paneView, bandView, itemsView, detailView, TABS, controlRows, SPLIT_COLUMNS, bodyColumns, closeOnEscape, PromptHint, TurnDuration, hideBuiltinTasks, stripTasks, RabeTurn, rabe.turns, agents, workflows, agent.spawn, turn.step, turn.complete, SubagentStart, meta.json, task-notification, matcher, codex source, rabe-stop, detailLines, costBox, $.command.run, parseRollout, codexItem, RabeCodexStep, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner, shells, monitors, crons, tasks.ts, schedule.ts, nextRun, nextRuns, parseNotifications, parseOutput, guessPort, rabe.lines, RabeLines, memoryState, act, rabe.selected, rabe.open, bandRows, nameSpans, joinFit, chip, summary line, desktop fallback]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views and does nothing else.

```
hooks/
  register.tsx        calls sources(on), band(on), pane(on)
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit, pastEnd, prune
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
  ui/pane.tsx         the /rabe command, its pane and actions
  ui/builtin.tsx      hides Claude Code's own count of background work
  ui/render.tsx       one renderer: lines as row Boxes of Text and plain Buttons, charts as a Raster
  ui/view.ts          the view contract: Model, Size, Selection, Press, Line, Node, Drawn, View, Action
  ui/cells/           pure cell engine for charts (grid.ts) and the 256-color palette (palette.ts)
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
| `capEnded(items, max = MAX_ENDED)` | Keeps every running item and the newest 200 ended ones, newest by `endedAt`, else `seenAt`. Of two that ended at the same time, the one Rabe saw later goes first. `commit` applies it, so every write loop does. |
| `commit(held, change)` | Applies a change and the cap. Answers `{ items, dropped }`: the capped list to write and the ids the write drops, also one the change added and the cap dropped at once. Answers `undefined` when the capped list is the held list: nothing changed, or the cap drops what the change added (an old ended item a poll finds again), so a poll then writes no state. |
| `pastEnd(items, now)` | The end time an ended item takes when Rabe did not watch it end (a poll finds it): the oldest end of the ended items held, or `now` when there are none. `undefined` once 200 ended items are held, since the cap would drop it. So such an item never pushes out one Rabe watched. |
| `prune(record, dropped, items)` | A per-item record (`rabe.lines`, `rabe.turns`) without the entries of the `dropped` ids that are not back in `items`; the same record when nothing goes. Only those ids go: an entry a later write added stays. |

To list items, read the value: `const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })`. A read while drawing subscribes the drawing, so a write draws it again.

### The write loop

Every file that writes items declares `write` and `forget` at its top level (the scanner does not follow `$` across an import). `write` writes only when the list changed, and tries again when another hook wrote first. `commit` applies the cap, so any write can drop items; `forget` then drops the per-item state of exactly those items:

```ts
import type { EngineInterface } from 'claude-code'
import { type Change, commit, prune } from '../registry'

async function write($: Pick<EngineInterface, 'state'>, change: Change): Promise<void> {
  for (;;) {
    const { value, version } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = commit(value, change)
    if (next === undefined) return
    const { isSet } = await $.state.set({ plugin: 'rabe', key: 'items' }, next.items, {
      ifVersion: version,
    })
    if (isSet) return forget($, next.dropped)
  }
}

async function forget($: Pick<EngineInterface, 'state'>, dropped: string[]): Promise<void> {
  if (dropped.length === 0) return
  for (;;) {
    const { value = {}, version } = await $.state.get({ plugin: 'rabe', key: 'lines' })
    const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })
    const next = prune(value, dropped, items)
    if (next === value) break
    const lines = await $.state.set({ plugin: 'rabe', key: 'lines' }, next, { ifVersion: version })
    if (lines.isSet) break
  }
  // the same loop for { plugin: 'rabe', key: 'turns' }
}

// in a hook:
const now = await $.clock.now()
await write($, items => addItem(items, item, now))
```

The library's `update($, atom, fn)` is not used: it writes even when `fn` returns the same value.

Per-item state outside `rabe.items` (`rabe.lines`, `rabe.turns`) must leave with its item, whether or not its output changed. That is done in the write itself, not in a hook on `state.set`: the live engine does not run the plugin's own `state.set` hooks for a write made in a `$.clock.every` or `$.clock.after` callback, so such a hook does not see the polls' writes. A write from a hook or a command does pass it.

`forget` removes only the ids its own write dropped, never every id missing from a list it read earlier: between the write and the pruning another write can add an item and store its output. It reads the list again right before each pruning and keeps an id that is back in it (an agent that resumed). Each pruning writes only when its value changed. The writers of `rabe.lines` and `rabe.turns` only set their own entry.

### Turns

The turns of a subagent live in a second session value, `$.state` key `rabe.turns`: an object from item id to a list of `RabeTurn`. They are kept apart from `rabe.items` so that the list stays small. Each turn is one model response of the agent:

```ts
type RabeToolUse = { name: string; summary?: string }   // 'Read', 'src/db.ts'
type RabeTurn = { index: number; at: number; text: string; tools: RabeToolUse[] }
```

`index` counts from 1 and keeps counting when old turns are dropped. `text` is the visible answer, cut to 300 characters with `…` at the end (`clip` in `model.ts`). `summary` is the first of the tool's `file_path`, `command`, `pattern`, `path`, `url`, `query` or `description`, on one line of at most 80 characters; a `file_path` is kept whole, since the Effects tab tells files apart by it. Each item keeps its newest 30 turns. The turns of an item dropped from `rabe.items` go with it (see The write loop).

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

The poll reads `$.agent.list()`. It adds agents Rabe has no item for (started before Rabe loaded, or dropped by the cap). An ended one never gets a new recency: it takes `pastEnd`, the oldest end held, and is not added at all once 200 ended items are held, since the cap would drop it. So an unchanged list causes no write, however many ended agents it holds, and agents Rabe did not watch never push out the ones it did. The poll also ends items the list reports as `completed`, `failed` or `killed`. An agent can resume under the same id: when the list shows an ended item's agent as `pending`, `running` or `waiting`, the poll sets it running again and clears `endedAt`, and one the cap dropped is added back as running. `idle` does not count: a teammate is idle after each turn, which already ended its item. Then it reads the meta file of each running agent and copies `cwd`, `worktreePath`, `worktreeBranch` and `workflowPhase`. An agent with neither `cwd` nor `worktreePath` shows its tree as `n/a`, not as the main tree. The meta file sits next to the transcript (`agent-<id>.meta.json`); for a workflow agent without a transcript path it is in the run's `transcriptDir`. The file appears about 1.5 seconds after the start and changes later, so the poll reads it each time.

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

- **Poll.** `session.start` (interactive only) starts `$.clock.every(2000)`. Each poll lists the plugin's state folders, skips each whose `state.json` was not changed since the session started (`$.session.usage().startedAt`), and reads the rest. It keeps the jobs whose `sessionId` is this session's (`$.session.id()`), and checks that again in the job file, because `state.json` can hold a bare status patch without it. A job whose item already ended is not read again. For a finished job Rabe holds no item for, the poll first asks `commit` whether the item would change the list; when the cap would drop it again (it ended before every ended item held, so the cap dropped it before), its session file is not read and nothing is written. The other polls add only work in flight (`background_tasks`, `session_crons`), which the cap never drops.
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
| `classic.Stop` | A running shell missing from `background_tasks` ends by its exit line, else as stopped. A shell a subagent started (`parentId` `agent:…`) is skipped: it may be missing from the main session's list while it runs, and the poll ends it from its file. A shell in `background_tasks` that Rabe never saw is added, without `startedAt`. Claude Code lists a Monitor tool task with type `shell` too, so a task id Rabe already has as `monitor:<id>` is skipped; a monitor started before Rabe loaded still shows as a shell. |

A subagent's shells and monitors get no end notification in the main session: it goes only to the subagent (see feasibility). Their output files are in the main session's `tasks` folder, so the poll ends them from the file's last line, `[exited with code N]` or `[killed]`, as it does every shell.

### Monitors: `hooks/sources/monitors.ts`

The same four hooks for the Monitor tool, with the same `classic.Stop` rule for a subagent's monitor. The Monitor result has no file path, so `outputPath` is the sibling of a task output file Rabe already knows (`taskOutput`, tried again on each poll), or the `<output-file>` of the end notification. A subagent's monitor has no end notification in the main session, so it ends from its file once Rabe knows any task output path.

The end notification is handled only for task ids Rabe has as `monitor:<id>`: a shell's notification also carries an `<output-file>`, and reading it would file shell lines under a monitor id.

Monitor lines are kept apart from the item, in the `$.state` key `rabe.lines`: `Record<itemId, { seen, lines: { at, text }[] }>`. `seen` counts the lines read from the file; `lines` holds the newest 200, each with the time the poll first read it ("received"). A last line read while it was still being written (`hel`, then `hello`) is updated in place and keeps its time. The poll and the end notification both read the file, so the last lines are kept even when the notification comes first. Notification `<event>` lines are not used: they come late and in batches. The lines of an item dropped from `rabe.items` go with it, in the write that drops it (see The write loop), as its turns do.

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
| `ui/cells/grid.ts` | The cell engine for charts: a grid, text, spans, bars, wrap, paste, the `cells` encoding; `safe`, `fit` and `wrap` also serve the lines |
| `ui/cells/palette.ts` | The 256-color palette (`C`, `CHIP`), `DEFAULT` (the terminal's own color), `xterm`, `paint`, `tone(item)` |
| `ui/view.ts` | The view contract: `Model`, `Size`, `Selection`, `Action`, `Press`, `Part`, `Line`, `Node`, `ViewButton`, `ViewInput`, `Drawn`, `View`; `rowKeys`, `stepRow`, `controlRows`, `canStop`, `taskIdOf` |
| `ui/render.tsx` | `render(ui, surface, drawn, act)`: the same tree on every surface |
| `ui/views/band.ts` | `bandView`: the band's rows, as one chart |
| `ui/views/pane.ts` | `paneView` and `TABS`: the tab row, the tab's view or the open item, the hint |
| `ui/views/items.ts` | `itemsView`: grouped list, split or one-line summary, list controls, search |
| `ui/views/detail.ts` | `detailView`, `detailLines` and `bodyLines`: one item in full, per kind |
| `ui/views/cost.ts`, `effects.ts`, `timeline.ts` | The other tabs |
| `ui/views/lines.ts` | `fitLine`, `beside`, `text`, `itemLine`, `headLines`, `focusOn`, `plain`: shared row drawing |
| `ui/lists.ts` | Pure grouping, sorting, the held order (`stable`, `orderOf`), `byParent`, the files agents touched (`touched`, `byConflict`), labels, band rows, totals, phases, tree, bars |
| `ui/facts.ts` | The fact lines of one item (model, worktree, spend, start, exit code) |
| `ui/format.ts` | Durations, ages, countdowns, token and dollar amounts |
| `ui/fixtures.ts` | Fake items, `screen(ui)` and `raster(drawn)` / `gridOf(drawn)` for the tests; nothing else imports it |

### The view contract

Each view is a pure function from the model, the size and the selection to the lines of its body and the controls under it:

```ts
type Model = { items: RabeItem[]; turns: Record<string, RabeTurn[]>; lines: Record<string, RabeLines>; now: number; usd?: number; previous?: RabePrevious }
type Size = { columns: number; rows: number; surface: RenderSurface; hasInput: boolean }
type Selection = { tab: RabeTab; query: string; folded: string[]; selected: string; open: string; order?: RabeOrder; isFocused: boolean }

type Span = [text: string, style?: { fg?: number; bg?: number }]
type Press = { key: string; label: string; action: Action; hotkey?: string; autoFocus?: true; dim?: true; bg?: number }
type Part = Span | Press                       // isPress(part) tells them apart
type Line = { spans: Part[]; right?: Span[]; bg?: number }
type Node = Line | { chart: Grid }

type ViewButton = { key: string; label: string; action: Action; hotkey?: string; autoFocus?: true }
type ViewInput = { key: string; label: string; placeholder: string; submitLabel: string; value?: string; isLive?: boolean; action: (text: string) => Action }
type Drawn = { nodes: Node[]; buttons: ViewButton[]; inputs?: ViewInput[] }
type View = (model: Model, size: Size, selection: Selection) => Drawn
```

- **A line** is one row of the body: Text parts and plain Buttons, then a part at the right end. A view passes each line through `fitLine(line, columns)`, which makes it exactly `columns` cells wide, as a grid row was: parts cut with `…`, the right part at the end, spaces between, every character through `safe`, a Press with a `hotkey` counted with the `c: ` the engine draws before its label, and the line's `bg` moved onto each part, so two fitted lines can stand side by side. `beside(left, leftWidth, gap, right, rightWidth)` sets two columns of lines next to each other (the split, the Timeline's lower half).
- **A selectable row** is a line with one `Press`: a plain Button whose label is the row's name, keyed by a stable id (`row:<item id>`; a group header `group-<group>`; a tab `tab-<tab>`). The Effects tab's rows are not items, so their ids are their own: `row:file:<path>` for a file (it opens the agent that edited it last) and `row:ssh:<port>` for an `ssh -L` line (it copies the line). The other parts (marker, glyph, port, exit code, time) are Text. A row is one pressable thing: only Buttons take a press, so a row has no second control inside it. `itemLine(item, now, isSelected)` builds the Items row; the Cost, Effects and Timeline rows are built the same way.
- **Focus.** A Button takes no color. `dim` draws a name dim at rest and full under the focus or the pointer; the views dim every row but the selected one. The selected row also has an orange `▌` and the `selected` background, so it reads as selected while the pane does not hold the keys. `focusOn(lines, selected)` gives `autoFocus` to the selected row, else the first: the focus starts there when the pane takes the keys, and Enter presses it. Of several `autoFocus` elements the first drawn wins, so a view sets one.
- **The split shows no Buttons.** The detail beside the list goes through `plain`, which turns its Buttons into Text, so the arrow keys and Tab walk the list alone. The full detail (Enter) keeps its rows pressable (a workflow's agents).
- **Charts** (`{ chart: grid }`) are cells nobody presses: a Raster on the terminal, text lines elsewhere. Only the band uses one now. The Cost and Timeline bars and the time axis are block glyphs in Text parts of their rows: a chart is a whole node, so it cannot stand in a row beside the row's Button, and Text draws the same cells on the terminal and also on the desktop.
- **Controls.** `buttons` are drawn `[ label ]` in a row under the body. The label carries the key (`x: stop`), since the engine does not draw hotkeys. Hotkeys are one digit or one lowercase letter. A control with `autoFocus` takes the focus (the detail's `b: back`).
- `inputs` are drawn under the controls where the surface has `Input` (`size.hasInput`). A focused Input takes every key, also the hotkeys, so a view offers a control that focuses it (`s: search`, `m: message`) instead of focusing it itself.
- `Action` is what pressing does: `tab`, `open`, `fold`, `query`, `focus`, `stop`, `delete`, `copy` and `message`. `pane.tsx` runs it.

A new view is a file in `hooks/ui/views/` that exports a `View`. A new tab adds its view and label to `TABS` in `views/pane.ts` and its name to `RabeTab`. A new detail adds a case to `bodyLines` in `views/detail.ts`. Neither touches the renderer or `pane.tsx` unless it needs a new `Action`.

### The renderer

`render(ui, surface, drawn, act)` in `ui/render.tsx` is the one place that turns a `Drawn` into elements, and it draws the same tree on every surface:

- Each line is a row `Box`. Its Spans are `Text` (color, background, `wrap="truncate"`), its Presses plain `Button`s (`plain`, `dimColor`, `hotkey`, `autoFocus`, `onPress`). A Button takes no color prop, so each run of parts on one background sits in its own `Box` of that color: the focused Button draws inverse over its label and the Box's background shows around it. A row with exactly one Button is keyed `line:<press key>`, which makes it the hover scope of that Button (`hover: { bold: true }`); an empty line draws one space so it keeps its height.
- A chart is a `Raster` on the terminal, keyed `cells` (the band's `band`), cut by `clamp` to the 512 columns and 256 rows a Raster takes. Elsewhere it is one `Text` per row: the desktop hands out a Raster that draws an empty Box, so the choice is `surface === 'terminal'`.
- Then the controls in a row Box keyed `controls`, then the Inputs.

### The palette

Every color in `palette.ts` is one of the xterm-256 colors 16 to 255, written as `0x00RRGGBB`: a cube color (each channel 0, 95, 135, 175, 215 or 255) or a grey (8 + 10n). Under tmux the engine reduces a hex color for a Box or Text to 256 colors with a coarse formula (`#203020` and `#402040` both became 59), so two dark backgrounds could fall together. `paint(rgb, surface)` therefore names a Box or Text color as `ansi256(n)` on the terminal, which the engine passes unchanged, and as hex on every other surface; `DEFAULT` (`0x01000000`) is no color, the terminal's own, so plain text and the background follow the person's theme. A Raster's cells keep the exact entry, which the engine's own reduction of Raster colors maps to itself. The 16 base colors are left out, since each theme draws its own.

| Name | xterm | Use |
|---|---|---|
| `dim`, `bright`, `grey` | 245, 255, 252 | Secondary text, emphasis, the cost chip |
| `orange`, `yellow`, `green`, `red`, `blue`, `purple`, `cyan` | 173, 179, 107, 167, 75, 176, 73 | Kinds and states (`tone`), group headers, ports |
| `selected`, `panel`, `raised`, `rule` | 238, 236, 235, 239 | Selected row, cost panel and summary line, the running turn, rules |
| `CHIP.*` | fg 216, 116, 150, 222, 117, 183, 210, 252 on bg 94, 23, 22, 58, 17, 53, 52, 237 | Band chips, legend, conflict and load notes: a light tint of the kind's hue on the dark cube color of that hue (`done` shares `workflow`'s) |

`palette.test.ts` checks that each color is an exact entry and that the colors drawn side by side (the text colors, the row backgrounds, the chip backgrounds and the chip texts) are distinct indexes, so tmux keeps them apart.

### The cell engine

A Raster is a fixed grid of terminal cells. Each cell is exactly `[codePoint, foreground, background]`: a code point is one printable width-1 BMP character, a color is `0x00RRGGBB` or `0x01000000` for the terminal's default. A Raster has no bold, underline or italic. It is a leaf: no press and no focus. Rabe draws only charts with it (the band); the pane is lines of Text and Buttons.

`hooks/ui/cells/grid.ts` builds such grids with plain functions and no `$`. They change the grid they are given and return nothing or the next column:

| Function | What it does |
|---|---|
| `grid(columns, rows, style?)` | A grid of spaces in the default colors (or the style's) |
| `safe(text)` | One cell per character: whitespace becomes a space; a character on the allow list stays; anything else becomes `?` |
| `clamp(g)` | The grid cut to the 512 columns and 256 rows a Raster takes; `render` applies it to every chart. The band passes its view a size within these bounds (`bounded` in `view.ts`) |
| `fit(text, width)` | Pads, or cuts with `…`, to exactly `width` cells |
| `write(g, x, y, text, style?)` | Text from `(x, y)`, clipped at the edge; a style leaves the colors it does not name |
| `spans(g, x, y, [[text, style], …], width?)` | Runs of styled text, the last cut with `…` at `width` |
| `wrap(text, width)` | Lines of at most `width` cells, split at spaces |
| `bar(value, max, width)` | A bar in eighths of a block (`█▉▊▋▌▍▎▏`), padded |
| `paste(g, src, x, y)` | Copies one grid into another, clipped |
| `encode(g)` / `decode(columns, rows, base64)` | The Raster `cells` string: little-endian u32 triplets in padded base64 |
| `lines(g)` | The text of each row, trailing spaces cut: the text fallback and the tests |

`safe` keeps an allow list, not a deny list: a deny list missed characters such as `☰` (U+2630), which the engine takes as wide and refuses, naming the cell's index, so the whole Raster is lost. The list holds code points terminals draw one cell wide: printable ASCII, Latin-1 letters and punctuation, Latin Extended-A and B, Greek, Cyrillic, general punctuation (no spaces, zero-width or format characters), currency signs, arrows, box drawing and block elements, and the glyphs Rabe draws outside those ranges (`GLYPHS`: `◐ ● ▶ ✗ ✓ ⚠ ⟳ ≈` …). Unassigned code points, marks, format and control characters in those ranges are out. Other scripts, emoji and symbols show as `?`. `fitLine` uses it too, so a line's width in cells is its length. `render.test.tsx` draws every character `safe` keeps in one Raster through the pinned engine, which checks each cell. A new glyph in a view goes into `GLYPHS`, or it shows as `?`.

### Sizing

`paneView` gives the tab's view `scroll.bodyRows` less the tab row and its rule (2), the hint (1) and the rows its controls and Inputs take (`controlRows`: Buttons as `[ label ]` with a gap, wrapped at `bodyColumns`, plus one row per Input). It calls the view twice: once to learn its controls, once with the rows left. A body shorter than that is padded, so the hint sits at the bottom. A list longer than that is drawn whole: the pane is then taller than its body and the engine scrolls it, the focus carries the window along (see Focus and the arrow keys), and the wheel scrolls it. `size.rows` still bounds what is not a list: the detail keeps its newest body lines (a workflow's agent rows are a list and are drawn whole), the Effects file list ends with `… N more`. No view cuts its lines to `size.rows`: what does not fit scrolls, so no row's Button is lost. `size.window` is the part of the view's rows the pane shows, from the Pane's `scroll` (`offset`, `bodyRows`); `paneView` moves its `top` up by the tab row and the rule, so it counts in the view's rows.

The Items tab splits into list and detail side by side when `bodyColumns` is at least 90 (`SPLIT_COLUMNS`). A docked pane asked for 100 columns gets about 72 at a 200-column terminal, and an inline one at 100 terminal columns gets 96. Below 90 the list fills the width and ends with one summary line of the selected item on the panel background (`◐ review auth.ts · gpt-6.1-sol · ≈ $0.09 · 25k in · running`), and Enter opens the full detail in place; `b` goes back. The list keeps an empty line between groups only when the whole list fits. In the split, a list longer than the pane scrolls, and the detail starts at the first row the pane shows (empty lines above it), so it stays in view beside the focus. That row is `size.window.top` moved just enough to keep the focused row in view (`shownFrom`): the engine follows the focus that way and does not ask again (see feasibility).

### The band

A `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise `bandView` draws one row per kind that has something to show: failed (ended in the last 10 minutes) first, then `claude`, `codex`, `workflow` (phase and agent count), `shells` (with port), `watch` (monitors) and `cron` (countdown to the next run), then a `$ cost` row when any tokens are known. Shells and monitors an agent started follow the main session's, in the order of the Items tab (`byParent`). Each row starts with a chip in its kind's colors (`CHIP`), padded to the longest label so the names line up, and lists names until the width is used, ending with a dim `+N`. Names are plain; times, workflow phases and the ` · ` between names are dim, a shell's port is blue, a failed shell's exit code red, and a cron job's next run (`· next 3:48`) bright. The cost row starts with the dollar amount, bright (`≈ $0.04 · 43k tok · top: raven poem 21k`), or `cost n/a`. The amount is the session's cost from `$.session.usage().cost.usd`, as `/cost` totals it, when the host has one; else the sum of the items' dollars. When the rows do not fit in `maxRows`, the band draws one line of count chips instead, failed first, then the cost: `✗ 1 failed  ◐ 2 claude  ▶ 2 shells  ◉ 1 monitor  ⟳ 1 cron  ≈ $0.04 · 43k tok`. `lists.ts` gives the band its rows as spans (`bandRows`, `nameSpans`, `joinFit`). Nothing in the band is pressed, so it is one chart.

The grid is `bodyColumns` wide and exactly as tall as its lines. The band before drew padded `Text` labels in a row; beside an open pane the band is narrow, a label wrapped its trailing spaces, and the band drew an empty line. The engine owns collapsing (ctrl+x ctrl+a); the hook gets no collapsed flag.

### The pane

`/rabe` opens the pane `rabe` with `closeOnEscape`, so Esc closes it; without it Esc only hands the keys back and the pane stays. The command cannot focus it (see feasibility), so `pane.tsx` opens it again with `focus: true` from `$.clock.after(1500)`, but only while `$.ui.panes()` still lists it: a pane closed with Esc in that time stays closed. Until the pane holds the keys, the hint says "tab to select · esc close".

`paneView` draws the tab row as plain Buttons keyed `tab-<tab>` with the hotkeys `1` to `4`: `Items 7    Cost    Effects    Timeline` with `1-4 switch` at the right end at 90 columns and more, `Items 7  Cost  Effects  Timeline` below. The active tab is drawn full, the others dim, and a `━` line in orange under the active one marks it in the rule below the row. The desktop draws the same tree. Each value the pane keeps is a `$.state` key, so a hot reload keeps it:

| Key | What it holds |
|---|---|
| `rabe.tab` | The selected tab |
| `rabe.query` | The search text; matches title, kind, command, prompt, description and agent type |
| `rabe.folded` | The groups folded in the list |
| `rabe.selected` | The id of the row that holds the focus: set by `ui.focus` on a row, and by opening. An item id, or on the Effects tab `file:<path>` or `ssh:<port>`, which the other tabs do not find and so focus their first row |
| `rabe.open` | The item whose full detail shows; `''` shows the list |
| `rabe.order` | The list order taken when the pane opened (`RabeOrder`, see The held order) |

#### Focus and the arrow keys

- **Focus follows the person.** A `ui.focus` hook on the pane stores the item id of a `row:` element in `rabe.selected`, so the detail beside the list, the summary line, the marker and `x`/`g` follow the focus without Enter. Enter presses the focused row: it opens the item (from the Cost and Timeline tabs too, in the Items tab). A click presses a row the same way, on the terminal in the fullscreen layout; a click moves no focus ring, so it selects by opening.
- **Arrows in a tall pane.** Where all rows fit, ↑ and ↓ move the focus row by row (the engine does it, and wraps). In a pane taller than its body the engine scrolls one row instead and leaves the focus. A `ui.scroll` hook answers such a move (no `pointer`, `|by| === 1`) with `{}`, so the window stays, and moves the focus to the next or previous row with `$.ui.focus`; the pane then scrolls to show it. The rows are the `row:` Presses of the pane's drawing in document order (`rowKeys`), and the step is `stepRow`: from no row, ↓ goes to the first row; past the first or the last row the hook passes the scroll on, so ↑ shows the tab row and ↓ the controls. The wheel (a `pointer`) and the page keys pass. The hook draws the pane's view again from state to know the rows; their keys do not depend on the width, since the split's detail has no Buttons. Group headers are not arrow stops; Tab reaches them.
- **Back.** `b` in a detail goes back to the list, selects the item that was open and focuses its row with `$.ui.focus`, since the ring would stay where `b` was. It selects the open item, not `rabe.selected`: in a workflow's detail the focus may have moved onto one of its agent rows, and `b` goes back to the run.
- **Keys.** On the list: ↑↓ move, Enter opens, `x` stop, `g` stop the group, `s` search. `g` stops the rows of the group the selected row is drawn in, as the search shows them: a held row that changed status stops with the group it stands in, not with the group of its status. When the selected row is a workflow or a workflow agent, `g` is `g: stop run` (key `stop-run`) on that run instead, and there is no `x`: Claude Code stops a workflow only as a whole. Below the split the label of `s` keeps only the letter; `x: stop` and `g: stop group` keep their word. The hint under every tab names what works there (`↑↓ move · enter open · x stop · esc close`; on the Effects tab Enter on an `ssh -L` line copies it). In a detail: `b` back, `c` copy the command or prompt, `d` delete a cron job, `m` message an agent, `x` stop, `g` stop a workflow run. A workflow agent (`isWorkflowAgent`: its `parentId` is a `workflow:` item, or it has `workflowIndex` or `workflowPhase`) has no `x`, `m` or message field, since Claude Code can stop only the whole run and cannot message a workflow agent: its detail offers `g: stop run` on the parent run when that run can be stopped, and the list leaves it out of `x` and of a group stop. A letter no Button binds moves the focus to the prompt, and the next keys type into the composer; no hook can keep them (see feasibility).

#### The held order

If rows reorder while a row has the focus, the focus ring stays on the old index, so Enter presses another row (see feasibility). So the lists do not reorder while the pane is open. `/rabe` stores `orderOf(items)` in `rabe.order`: the item ids of each Items group sorted (running first, then the newest), the Cost list by tokens, the Timeline by start and the Effects files by `byConflict` (as `file:<path>`). Each list then goes through `stable(list, held, sort)`: the held ids first in held order, then the items Rabe saw since, in the order it saw them. A new item goes into the group of its kind, not into Failed, since its status may still change; a held item keeps its group when its status changes. A group that was empty at the open holds too: its items stay in the order Rabe saw them. SHELLS and MONITORS are held in their family order (`byParent`), so the blocks drawn at the open are the held order. Opening the pane again sorts anew. Without `rabe.order` (nothing opened the pane yet) the lists are sorted on each draw.

#### The tabs

**Items tab.** Groups: failed first, then agents (Claude, Codex, workflows), shells, monitors and cron; inside a group running items first, then the newest (as held). A group header is `▾ AGENTS`: the arrow in the group's color, the name a Button that folds the group (`▸` when folded), and a dim note (`2 claude · 1 codex`, `2 running`). A row reads marker, glyph (colored by `tone`), the name as its Button, a shell's port and exit code, and the time, or the status word and age once it ended, at the right end. The selected row has an orange `▌`, the `selected` background and a plain time; other names and times are dim.

`byParent(list, items)` in `lists.ts` groups shells and monitors by who started them: the main session's first (title `''`, drawn without a header), then one block per agent in list order with the agent item (for its glyph) and its title, `run › agent` for a workflow agent and `agent n/a` for an agent Rabe no longer holds. In SHELLS and MONITORS the Items tab draws each agent's block under a header that is Text, not a row: the agent's glyph in its `tone` (a dim `◐` for `agent n/a`) and its title in dim. The children's rows are indented two cells after the marker. The list order, the first row that takes the focus and `rowKeys` follow the drawn order, so the arrows walk the children where they stand. The blocks are cut from the held order. While an order is held (`byParent(list, items, true)`), a block takes only neighbours, so a new shell joins its agent's block only when that block is last; else it starts a new block at the end, with the agent's header again. Joining an earlier block would put a Button above the focused row, and the engine keeps the focus by index. A failed shell stays in FAILED without its agent. The band names the shells and monitors in the same order, each child after its agent's title in dim (`bun run dev :5173 · Explore verifyToken › bun test`), and counts them all in both forms.

**Detail per kind.** `detailLines(model, item, rows, width, sel?)` in `views/detail.ts` builds one item's detail; the full detail (`detailView`) and the right side of the split (`summary` in `views/items.ts`) both use it. It has three parts. The head (`headLines`) is the glyph, the title, the status word on the right, and the fact lines in dim. The top stays while the body scrolls: a cost panel and the brief or prompt, or the label of the body (`▸ output`, `▸ next runs`). The body (`bodyLines`) is cut from the start, so the newest lines show:

- Agent: a cost panel (background `C.panel`): `≈ $0.16   in 36k  out 5k  cached 12k`, then `45% of session` and, while it runs, `active 3s ago` from `lastToolAt`. Then `▸ brief` with the prompt the agent was given, or the description for an agent Rabe did not see spawn (at most three lines, cut with `…`), then the turns from `rabe.turns`: `1  ● text` (index dim, `●` orange), then `⎿ Tool summary` per tool. The last turn of a running agent has the raised background `C.raised`. An agent that ran before Rabe loaded has no turns and says so.
- Codex: the facts say model, effort and sandbox, the job id and whether the session file was read, is partial (a file over 4 MiB, the last 200 lines) or is gone. The cost panel adds the command count and takes `active` from `sessionUpdatedAt`. Then `▸ prompt`, then `detail.steps`: `●` (cyan) messages, `thinking:` reasoning summaries, and `$ command` with `✓ exit 0 · N lines`, `✗ exit N` or `◐ running` on the right; the running command is raised. `x: stop` cancels the job through `/rabe-stop` (see Stopping an item).
- Workflow: the cost panel sums the run's agents and counts them. Then the phases as `✓ Review → ◐ Verify → · Report`, and per phase its agents in start order with their tokens and time (`22k · 40s`). The start order is held like the Timeline's (`stable` with `rabe.order.timeline`), so an agent that ends never moves under the focus. In the full detail each agent row is a plain Button that opens it, `b: back` keeps the one `autoFocus`, and the arrow keys walk the agent rows like a list: the row that holds the focus is selected and marked (`▌`, the `selected` background), the others are dim. The full detail draws every agent row, not the newest that fit; the pane scrolls.
- Shell: `▸ output · newest last · N lines` (`1 line` for one) (N is `seen`, all lines read), the lines in `rabe.lines`, and at the end `✓ exit 0` in green or `✗ exit N` in red once the exit code is known.
- Monitor: `▸ lines received · newest last`, each line after the time the poll first read it.
- Cron: `▸ next runs`, the next five times from the schedule with a countdown (`10:55  in 3:00`); a `/loop` wakeup shows `▸ fires` and its one time. Delete shows for cron jobs only: a wakeup has no id `CronDelete` knows.

Cost, tokens and the share of the session left the fact lines for the panel; the spend there is the same sum the Cost tab uses. Cron runs seen this session and the per-tool exit codes of agents are not shown: no source records them.

**Cost tab** (`views/cost.ts`). A head row on a panel: the session's cost (`Model.usd`, from `$.session.usage().cost`, as `/cost` totals it; `session cost n/a` without it), the Claude and Codex dollar totals, tokens, the running count and the number of workers without tokens. Then a row per agent and Codex job, sorted by tokens when the pane opened (held): marker, glyph, the name as a Button that opens the worker in the Items tab, a bar in eighths of a block scaled to the largest, tokens, cost and run time. The bar takes the kind's chip color while the worker runs, green or red once it ended, and `▏` in dim where tokens are `n/a`. Under **LOAD**, running agents that look slow, from `rabe.turns`: `◷ long tool` when the last step asked for tools 2 minutes ago or more (the tool still runs), `⚠ stuck` when the last step asked for none and no step came for 5 minutes. The foot names where the session cost comes from and says when a Codex session file is gone.

**Effects tab** (`views/effects.ts`). `touched(items)` in `lists.ts` collects the files agents edited from each agent's `detail.edits`: the `Edit` and `Write` calls that changed a file for it, not the calls a turn asks for, which may be refused or staged; a path is shown relative to the agent's worktree or `cwd`. A file two agents edited is a conflict: the tab heads with `⚠ conflict  src/logger.ts is edited by A and B in the main tree` on a red background, and lists conflicts first, then the newest edits (`byConflict`, held while the pane is open), with who edited and how many times. Each file row is a plain Button on the file name that opens the agent that edited it last; the selected one has the `▌` marker and the focus. Two worktrees never share an absolute path, so the same file in two worktrees is no conflict. Then the worktrees (`⎇ .claude/worktrees/…  branch · agents`), the agents that share the main tree and those whose tree is `n/a`, and the ports of running shells, each with its `ssh -L` line as a plain Button that copies it. The first port's line has a background and the hotkey `c`, which the engine draws as `c: ssh -L …`. The tab has no controls under the body. The file list gets the rows the other sections leave, ending with `… N more`. In a pane too short for the other sections the tab is drawn whole and scrolls, so every `ssh -L` line stays a row.

**Timeline tab** (`views/timeline.ts`). A head with the window (`last 40 min`), a legend of chip colors and a time axis with three clock times and `now`. One row per item, sorted by start when the pane opened (held): the name as a Button that opens it, then a bar from its start to its end (or now) in the kind's chip color while it runs, green or red once it ended. A cron job draws a tick at each run its schedule had since Rabe saw it and before it ended, computed with `nextRun`, so jitter is not shown. A space parts the name, cut with `…`, from its bar. Below: who started what (`tree`, with the kind in brackets for all but Claude agents), and the previous session in this project (`Model.previous`): side by side from 90 columns, else one under the other.

### The previous session

On `session.end` (`{ reason: /^/ }`) `pane.tsx` keeps a summary of the session in `$.store` under `previous:<cwd>`: `previousOf(items, now, usage)` counts the items per kind and holds the tokens, the session's cost and start, and the titles of failed items (`RabePrevious` in `types/index.d.ts`). A session without items keeps the last summary, so a short session with no background work does not hide the one before. The pane reads the key on each draw; a value of another shape shows as no previous session. After `/clear` the summary is the cleared conversation's.


**Live updates.** `session.start` starts `$.clock.every(1000)`, which calls `$.ui.invalidate('ui.render')` while any item runs.

**Actions.** Stop calls `TaskStop` with the task id (shells, monitors, workflows) or the agent id, and runs `/rabe-stop <item id>` for a Codex job. Delete calls `CronDelete`. Message calls `$.session.send` to the agent. Copy calls `$.ui.copy` on the surface that was pressed. Each answers with a toast: "Stopping …", "Stop refused: …", "Stopped 7 of 9; 2 had already finished", "Message sent to …".

### Hiding Claude Code's own count

Claude Code shows background work itself: a pill in the hint under the prompt (`2 shells, 1 monitor · ↓ to manage`) and a part of the line that ends a turn (`· 2 shells, 1 monitor still running`). Rabe's band shows the same, so `ui/builtin.tsx` hides both. It is on by default; the `userConfig` option `hideBuiltinTasks` in `.claude-plugin/plugin.json` turns it off, and `register` then does not call `builtin(on)`.

- `PromptHint`: `stripTasks(hint)` splits the hint at ` · ` and drops the parts that only count work (`2 shells, 1 monitor`, `1 background agent`) and `↓ to manage`. The hook passes the rest on with `next({ ...e, props: { ...e.props, hint } })`, so the PR number, `esc to interrupt` and the other parts stay. Rewriting the whole hint would drop them. The mode label (`⏵⏵ auto mode on`) is not part of `hint` and stays. ↓ still opens Claude Code's background manager.
- `TurnDuration`: the "still running" part is not a prop, so the hook draws the line itself (`✻ Brewed for 5s`, dim, one empty line above) while Rabe knows of a running shell or monitor and of no running agent or workflow. While an agent or workflow runs, the engine draws "Waiting for …" without that part, so the hook passes. The own line leaves out what has no prop: `done 1:16`, a token budget and "messages hidden".
- The agent list under the prompt stays: no component and no setting hides it (see feasibility).

Both views are tested on the `terminal` and `desktop` surfaces. Tests feed the session values with test hooks on `state.get`, fix the time with `mock.clock`, and read a drawing with `screen(ui)` from `fixtures.ts`: each row Box as one line, a Raster decoded, each control alone. The views can also be called directly with a model, since they are plain functions: `gridOf(drawn)` lays a view's lines into a grid as the terminal does, so `views/*.test.ts` check the text and the colors at positions. The test kit cannot answer a plugin's `$.ui.focus`, so the pane's tests check that the arrow hook keeps a one-row scroll and passes the rest, and `view.test.ts` checks `stepRow`.
