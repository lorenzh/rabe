---
title: State and items
description: How Rabe models items and updates its session registry.
tags: [architecture, state, items]
keywords: [item model, registry, write loop, turns, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, RabeCodexCall, codexCalls, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, MAX_FOREGROUND, ifVersion, $.state, rabe.edits, rabe.turns, RabeTurn, FileChange, cleanup, forget, prune, pastEnd, timer writes, CronDelete, isDeleted]
---

# State and items

## The engine's rule for `$`

`claude plugin validate` and `claude plugin test` scan each module before it loads. The scan follows `$` only into functions declared in the same file. It refuses a module that passes `$` to an imported function, to a method of an object, or to a function held in a list. A state reference (`{ plugin: 'rabe', key: 'items' }`) or an atom must be written in the file that uses it.

This sets the shape of Rabe:

- Shared code is pure. `model.ts` and `registry.ts` never see `$`.
- Each file that writes items has its own small write loop (below).
- `sources(on)` calls each source by name. A loop over an array of sources is refused.
- A source gets `on`. Polled sources also get the shared `pollers` list. The agents and Codex sources get the user's price file (`pricesFile`). It imports the pure registry functions it needs.
- An event may have only one hook without a matcher in the whole module. A second one stops the module from loading. Sources therefore give each hook a matcher, also when it has to match every event (`{ cwd: /^/ }` or `{ isInteractive: [true, false] }` on `session.start`, `{ agentId: /^/ }` on `turn.step`, `{ stop_hook_active: [true, false] }` on `classic.Stop`). Hooks with matchers, also equal ones, may repeat. `prompt.submit` takes a real matcher, such as `{ origin: { kind: 'task-notification' } }`.


## The item model

One type describes everything Rabe tracks. It is written in `types/index.d.ts`, because the state contract must hold every type it names and must not import. `hooks/model.ts` re-exports it, so modules import item types from `./model` or `../model`.

```ts
type RabeItemKind = 'agent' | 'workflow' | 'codex' | 'shell' | 'monitor' | 'cron'
type RabeItemStatus = 'running' | 'idle' | 'done' | 'failed' | 'stopped'
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
  costUsd?: number      // dollar estimate from data/prices.csv (agents and Codex jobs); absent: n/a
  detail: RabeItemDetails[K]
}

type RabeItem = { [K in RabeItemKind]: RabeItemOf<K> }[RabeItemKind]
```

`kind` narrows `detail`. The details per kind:

| Kind | Detail fields |
|---|---|
| `agent` | `agentId`, `isTeammate?` (true for a teammate), `name?`, `type?`, `model?`, `description?`, `transcriptPath?`, `cwd?`, `worktreePath?`, `worktreeBranch?`, `workflowPhase?`, `workflowIndex?`, `toolCount?`, `lastTool?`, `lastToolAt?`, `edits?` (`RabeEdit[]`, the newest 100 file changes, see below), `codexCalls?` (`RabeCodexCall[]`, the newest 10 calls of the Codex companion, see Forwarders) |
| `workflow` | `runId`, `taskId?`, `scriptPath?`, `transcriptDir?`, `phases?` |
| `codex` | `jobId`, `jobKind?`, `threadId?`, `model?`, `effort?`, `sandbox?`, `prompt?`, `workspaceRoot?`, `logPath?`, `sessionPath?`, `sessionUpdatedAt?`, `isSessionMissing?`, `isSessionPartial?`, `commandCount?`, `steps?`, `edits?` (`RabeEdit[]`, from the rollout) |
| `shell` | `command`, `taskId?`, `outputPath?`, `resultPath?`, `exitCode?`, `port?`, `portAt?` (when the poll found the port), `codex?` (`RabeCodexRun`, set for a direct `codex exec` call, even when empty: `model?`, `effort?`, `sandbox?`, `dir?` from the flags, `isModelAsked?` when `model` came from `-m`, then `threadId?`, `sessionPath?`, `matchedBy?` (`id` or `time`), `sessionUpdatedAt?`, `isSessionPartial?`, `sessionEndedAt?` from the matched session file; `isUnmatched?` when none is matched, `isDetached?` for a `&` run without a result file, `isEndUnknown?` when such a run ended without one) |
| `monitor` | `command`, `description?`, `taskId?`, `outputPath?`, `timeoutMs?`, `isPersistent?` |
| `cron` | `jobId`, `prompt`, `schedule?`, `humanSchedule?`, `scheduledFor?`, `isDeleted?` |

A file change is `RabeEdit`: `{ path, at, via?, change? }`. `via` says how: `edit` or `write` (the tool), `shell` (a path from the host's Bash diff, or a command line's candidate checked on disk) or `codex` (a Codex file change, with `change` `add`, `update` or `delete`); a shell `mv` source or `rm` has `change: 'delete'`. An edit without `via` is an `Edit` or `Write` from before this field. The main session's changes have no item: they are the `$.state` key `rabe.edits`, the newest 100, written by the agents source.

An optional field that is absent means the data is not known. Views show it as `n/a`. A source that needs a new field adds it as optional to the contract, here, and in this table.

`model.ts` also has:

- `NewItem`: an item without `seenAt`, what a source passes to `addItem`.
- `ItemPatch`: the fields `updateItem` can change; `detail` is merged, not replaced.
- `EndStatus`: `done`, `failed` or `stopped`.
- `isEnded(item)`: false for running or idle. Counts, the cap and removal use it so idle agents remain alive.
- `itemId(kind, nativeId)` and `mergeItem(item, patch)`. `mergeItem` always keeps the item's own `seenAt`, also when a full `RabeItem` is passed as the patch.


## The registry

The items live in one session value, `$.state` key `rabe.items`, an array in the order Rabe first saw them. It survives a hot reload. `registry.ts` has pure functions that take the list and return the next list. Each returns the same array when nothing changed. Values are compared with their object keys sorted, so `{ input: 10, output: 20 }` and `{ output: 20, input: 10 }` count as the same and cause no write:

| Function | What it does |
|---|---|
| `addItem(items, item, now)` | Appends a new item with `seenAt: now`. For a known id it merges the fields and keeps `seenAt`. |
| `updateItem(items, id, patch)` | Merges a patch into one item. Unknown id: no change. |
| `endItem(items, id, status, now)` | Sets `status` and `endedAt` on a running or idle item. An item that already ended keeps its end. |
| `capEnded(items, max = MAX_ENDED)` | Keeps every running and idle item and the newest 200 ended ones, newest by `endedAt`, else `seenAt`. Ended foreground Bash rows (`shell:fg-…`) go first, except a direct `codex exec` row (it has `detail.codex`), which counts like a Codex job, before any other ended item, and never more than `MAX_FOREGROUND` (50) stay; of two that ended at the same time, the one Rabe saw earlier goes. Of two other items that ended at the same time, the one Rabe saw later goes first. `commit`, `stage` and the poll loop apply it, so every write does, also a poll that ends a detached `codex exec` row. |
| `commit(held, change)` | Applies a change and the cap. Answers `{ items, dropped }`: the capped list to write and the ids the write drops, also one the change added and the cap dropped at once. Answers `undefined` when the capped list is the held list: nothing changed, or the cap drops what the change added (an old ended item a poll finds again), so a poll then writes no state. |
| `pastEnd(items, now)` | The end time an ended item takes when Rabe did not watch it end (a poll finds it): the oldest end of the ended items held, or `now` when there are none. `undefined` once 200 ended items that are not foreground Bash rows (`shell:fg-…`, a direct `codex exec` row excluded) are held, since the cap would then drop the new item itself. Ended foreground rows do not count here, because the cap drops them first; a direct `codex exec` row does count. So such an item never pushes out one Rabe watched, except a foreground row. |
| `prune(record, dropped, items)` | A per-item record (`rabe.lines`, `rabe.turns`) without the entries of the `dropped` ids that are not back in `items`; the same record when nothing goes. Only those ids go: an entry a later write added stays. |

To list items, read the value: `const { value: items = [] } = await $.state.get({ plugin: 'rabe', key: 'items' })`. A read while drawing subscribes the drawing, so a write draws it again.

### The write loop

The [shared poll loop](../architecture.md#shared-poll-loop) stages item changes from every polled source. It commits them together after the sources finish. Event hooks use the immediate write loop below.

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

`index` counts from 1 and keeps counting when old turns are dropped. `text` comes from `TurnStepResult.answer`. The source keeps at most 16,000 characters per answer with `clip`. A longer answer ends with `…`. The opened detail wraps all stored text as plain text. Bullet and numbered list markers stay with the first part of a long path. `summary` is the first of the tool's `file_path`, `command`, `pattern`, `path`, `url`, `query` or `description`, on one line of at most 80 characters. A longer summary ends with `…`. A `file_path` stays whole in state; the detail shows project-relative paths when it can, with a middle ellipsis for long paths. Each item keeps its newest 30 turns. The turns of an item dropped from `rabe.items` go with it (see [the write loop](state.md#the-write-loop)).
