---
title: How Rabe is built
description: The item model, the registry in session state, the source contract and the split between band and pane, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state]
keywords: [RabeTurn, rabe.turns, agents, workflows, agent.spawn, turn.step, turn.complete, SubagentStart, meta.json, task-notification, matcher, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner]
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
- An event may have only one hook without a matcher in the whole module. A second one stops the module from loading. Sources therefore give each hook a matcher, also when it has to match every event (`{ cwd: /^/ }` on `session.start`, `{ agentId: /^/ }` on `turn.step`). Hooks with matchers, also equal ones, may repeat.

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

## The sources

### Claude subagents: `hooks/sources/agents.ts`

One `agent` item per subagent, id `agent:<agentId>`. It covers agents the model starts, agents of workflows and teammates.

| Hook | What it does |
|---|---|
| `agent.spawn` | After `next(e)` gives the `agentId`, adds a running item: title from the description (else the type), type, model, `startedAt`. A workflow agent gets `parentId` `workflow:<runId>` and `workflowIndex`; an agent started by another agent gets `agent:<parentAgentId>`. A refused spawn adds nothing. |
| `classic.SubagentStart` | Sets `transcriptPath` (`<session>/subagents/agent-<id>.jsonl`, built from the hook's `transcript_path`) and, when the hook's `cwd` is not the session's, `worktreePath`. |
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

## The views

The band and the pane read `rabe.items` and draw. Neither writes items.

- `hooks/ui/band.tsx`, `band(on)`: a `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise it draws one line: the number of running items.
- `hooks/ui/pane.tsx`, `pane(on)`: registers `/rabe`, opens the pane `rabe`, and draws it. A row of Buttons selects the tab: Items (with the item count), Cost, Effects and Timeline. The selected tab is the `$.state` key `rabe.tab`. With no items the pane shows "Nothing runs in the background." The Items tab lists each item as status word, kind and title; the other tabs are not built yet. The last line is the key hint "tab to select · esc close", because nothing holds focus when the pane opens.

Both views are tested on the `terminal` and `desktop` surfaces. Tests feed items with a test hook on `state.get` that answers `rabe.items`.
