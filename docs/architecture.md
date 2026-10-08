---
title: How Rabe is built
description: The item model, the registry in session state, the source contract and the split between band and pane, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state]
keywords: [shells, monitors, crons, tasks.ts, schedule.ts, nextRun, nextRuns, parseNotifications, parseOutput, guessPort, rabe.lines, RabeLines, memoryState, matcher, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views and does nothing else.

```
hooks/
  register.tsx        calls sources(on), band(on), pane(on)
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit
  sources/index.ts    Source type and sources(on), which calls each source
  sources/<kind>.ts   one module per source: shells, monitors, crons
  tasks.ts            pure: task notifications, task output files, port guess
  schedule.ts         pure: next runs of a cron expression
  testing.ts          test helpers: state in memory, files, core stubs
  ui/band.tsx         the band above the prompt
  ui/pane.tsx         the /rabe command and its pane
types/index.d.ts      the state contract: item types and the $.state keys
```

## The engine's rule for `$`

`claude plugin validate` and `claude plugin test` scan each module before it loads. The scan follows `$` only into functions declared in the same file. It refuses a module that passes `$` to an imported function, to a method of an object, or to a function held in a list. A state reference (`{ plugin: 'rabe', key: 'items' }`) or an atom must be written in the file that uses it.

This sets the shape of Rabe:

- Shared code is pure. `model.ts` and `registry.ts` never see `$`.
- Each file that writes items has its own small write loop (below).
- `sources(on)` calls each source by name. A loop over an array of sources is refused.
- A source gets `on` only. It imports the pure registry functions it needs.
- A plugin may hook each event only once without a matcher; a second one makes the module fail to load. The pane owns `session.start` without one, so sources hook `session.start` with `{ isInteractive: [true, false] }` and `classic.Stop` with `{ stop_hook_active: [true, false] }`: matchers that match every event. Two hooks with the same matcher are allowed. `prompt.submit` takes a real matcher, such as `{ origin: { kind: 'task-notification' } }`.

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
| `agent` | `agentId`, `type?`, `model?`, `description?`, `transcriptPath?`, `worktreePath?`, `worktreeBranch?`, `workflowPhase?` |
| `workflow` | `runId`, `taskId?`, `scriptPath?`, `transcriptDir?`, `phases?` |
| `codex` | `jobId`, `threadId?`, `model?`, `effort?`, `prompt?`, `sessionPath?` |
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

## The views

The band and the pane read `rabe.items` and draw. Neither writes items.

- `hooks/ui/band.tsx`, `band(on)`: a `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise it draws one line: the number of running items.
- `hooks/ui/pane.tsx`, `pane(on)`: registers `/rabe`, opens the pane `rabe`, and draws it. A row of Buttons selects the tab: Items (with the item count), Cost, Effects and Timeline. The selected tab is the `$.state` key `rabe.tab`. With no items the pane shows "Nothing runs in the background." The Items tab lists each item as status word, kind and title; the other tabs are not built yet. The last line is the key hint "tab to select · esc close", because nothing holds focus when the pane opens.

Both views are tested on the `terminal` and `desktop` surfaces. Tests feed items with a test hook on `state.get` that answers `rabe.items`.

## Background shells, monitors and cron jobs

Three sources follow the work Claude Code runs as background tasks. Each writes items of its own kind only. The pure parsing lives in `hooks/tasks.ts` and `hooks/schedule.ts`, so views can use it too.

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

`schedule.ts` has `nextRun(expr, from)` and `nextRuns(expr, from, count)`: the next times a 5-field cron expression matches in local time, after `from`. It reads `*`, numbers, ranges, lists and steps; day of month and day of week match either one when both are set, as in cron. A broken or impossible expression gives `undefined` (an empty list). Claude Code adds up to 10 % jitter to recurring jobs, which this does not show.

### Testing sources

The test's `$` has no `state` noun. `memoryState(on)` from `hooks/testing.ts` answers `state.get` and `state.set` from memory, with versions, and returns the record to read (`state['rabe.items'].value`). `files(on, held)` answers `fs.stat` and `fs.read` from a record. `core(on)` answers the events the tests raise that nothing beneath the plugins answers: `prompt.submit`, `session.start`, `command.register` and `classic.Stop`. Tool results come from a test hook on `tool.call`, and `mock.clock` drives the poll.
