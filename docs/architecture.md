---
title: How Rabe is built
description: The item model, the registry in session state, the source contract and the split between band and pane, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state]
keywords: [codex source, rabe-stop, parseRollout, codexItem, RabeCodexStep, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views and does nothing else.

```
hooks/
  register.tsx        calls sources(on), band(on), pane(on)
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit
  sources/index.ts    Source type and sources(on), which calls each source
  sources/<kind>.ts   one module per source: codex.ts
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

### Starting work: one `session.start` per event and matcher

The engine refuses a module that registers the same event twice without a matcher. `pane.tsx` owns the plain `session.start` hook. A source that needs its own start hook gives it a matcher; the Codex source uses `{ isInteractive: true }`, since only a person at the prompt sees the band and the pane. Two sources that need a start hook must not use the same matcher; move shared start work into one hook then.

### Stopping an item: `/rabe-stop <item id>`

A view cannot pass `$` to a source, so stopping goes through a command. `/rabe-stop <item id>` is registered by the Codex source (with `immediate: true`, so it also runs during a turn). Each source that can stop its items answers it with a matcher on the id prefix, for example `{ command: 'rabe-stop', args: /^\s*codex:/ }`, and returns `{ text }` that says what happened. A view calls `$.command.run({ command: 'rabe-stop', args: item.id })` and shows the text as a toast. When a second source adds stopping, move the registration to `pane.tsx`.

## Sources

### Codex jobs: `hooks/sources/codex.ts`

Tracks the jobs that the Codex plugin (`codex@openai-codex`) starts for this session. Data sources and their limits are in [What Rabe can see](feasibility.md#codex-jobs).

- **Poll.** `session.start` (interactive only) starts `$.clock.every(2000)`. Each poll lists the plugin's state folders, skips each whose `state.json` was not changed since the session started (`$.session.usage().startedAt`), and reads the rest. It keeps the jobs whose `sessionId` is this session's (`$.session.id()`), and checks that again in the job file, because `state.json` can hold a bare status patch without it. A job whose item already ended is not read again.
- **Item.** `codexItem(job, session)` builds the item. Title: the first line of the job's `summary` (the prompt's start). Status: `queued` and `running` are running; `completed`, `failed` and `cancelled` end the item as `done`, `failed` and `stopped`, with `endedAt` from `completedAt`. Undefined fields are left out, so a merge never erases a known value.
- **Session file.** The rollout file is found once by `threadId` in `sessions/YYYY/MM/DD` of the start day and the day before and after (the folder date is local time), then kept in `detail.sessionPath`. It is parsed again only when its `mtimeMs` differs from `detail.sessionUpdatedAt`, so an idle job causes no write. Files up to 4 MiB are read with `$.fs.read`; larger ones with `grep -m 2` (turn context and prompt) and `tail -n 200` through `$.process.run`, and the item gets `isSessionPartial`. A finished job without a session file gets `isSessionMissing`; its model and effort then come from the job's `request`, when the job was a background job.
- **`parseRollout(text)`.** Pure. Reads model, effort and sandbox (`turn_context`), the prompt (first `UserMessage`), tokens (last `token_count` total), and the steps: assistant messages, reasoning summaries when present, finished commands (`CommandExecution`, with exit code and output line count), and a running command (a `custom_tool_call` that has no output yet). Steps keep the last 50, each text cut at 300 characters. Lines that do not parse (a line still being written) are skipped.
- **Stop.** `/rabe-stop codex:<job id>` runs `node <plugin root>/scripts/codex-companion.mjs cancel <job id> --json --cwd <workspaceRoot>` with `CLAUDE_PLUGIN_DATA` set to the plugin's data folder. The plugin root is the `installPath` in `plugins/installed_plugins.json`. On success the item ends as `stopped`.

The codex detail fields are listed in the table above. `steps` holds `RabeCodexStep` values: `{ kind: 'message' | 'reasoning' | 'command', text, exitCode?, lines?, isRunning? }`.

## The views

The band and the pane read `rabe.items` and draw. Neither writes items.

- `hooks/ui/band.tsx`, `band(on)`: a `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise it draws one line: the number of running items.
- `hooks/ui/pane.tsx`, `pane(on)`: registers `/rabe`, opens the pane `rabe`, and draws it. A row of Buttons selects the tab: Items (with the item count), Cost, Effects and Timeline. The selected tab is the `$.state` key `rabe.tab`. With no items the pane shows "Nothing runs in the background." The Items tab lists each item as status word, kind and title; the other tabs are not built yet. The last line is the key hint "tab to select · esc close", because nothing holds focus when the pane opens.

Both views are tested on the `terminal` and `desktop` surfaces. Tests feed items with a test hook on `state.get` that answers `rabe.items`.
