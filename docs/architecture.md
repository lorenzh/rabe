---
title: How Rabe is built
description: The item model, the registry in session state, the source contract and the split between band and pane, so that each source and view can be built on its own.
tags: [architecture, item-model, registry, sources, ui, state]
keywords: [nextRuns, parseClaude, parseCodex, act, rabe.filter, rabe.open, RabeItem, RabeItemKind, RabeItemStatus, NewItem, ItemPatch, itemId, addItem, updateItem, endItem, capEnded, commit, MAX_ENDED, write loop, Source, sources, register.tsx, band, pane, AbovePrompt, Pane, tab, $.state, ifVersion, scanner]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views and does nothing else.

```
hooks/
  register.tsx        calls sources(on), band(on), pane(on)
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit
  sources/index.ts    Source type and sources(on), which calls each source
  sources/<kind>.ts   one module per source (none yet)
  ui/band.tsx         the band above the prompt
  ui/pane.tsx         the /rabe command, its pane, file reads and actions
  ui/*.ts(x)          pure view code: lists, facts, format, cron, parsers, tabs
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
| `ui/cron.ts` | `nextRuns(schedule, from, count)`: the next runs of a five-field cron schedule |
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
