---
title: How Rabe is built
description: Overview of Rabe's modules and links to the detailed architecture documents.
tags: [architecture, modules]
keywords: [architecture, module map, overview, CronDelete, isDeleted, shellWrites, writes.ts, changed, beforeBash, afterBash, FileChange, arming, rabe.edits, resume, Raster, View, render, band, pane, register.tsx, $.state, prices.csv, pricesFile, CodexRequest, nextRun, parseWorktrees]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views and does nothing else; it hands the option `pricesFile` to `sources(on, file)`, which passes it to the agents and Codex sources.

```
hooks/
  register.tsx        calls sources(on, pricesFile), band(on), pane(on, hours)
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit, pastEnd, prune
  sources/index.ts    Source type and sources(on, file), which calls each source
  sources/agents.ts   Claude subagents: items, live tokens, turns and workflow phases
  sources/workflows.ts  workflow runs: items, phases and their end
  sources/codex.ts    Codex plugin jobs: items, steps and /rabe-stop
  sources/shells.ts   background shells: items, exit code, port
  sources/monitors.ts monitors: items and their output lines
  sources/crons.ts    cron jobs and /loop wakeups
  sources/worktrees.ts  the repository's git worktrees, for the Effects tab
  tasks.ts            pure: task notifications, task output files, port guess
  writes.ts           pure: the files a shell command line may write, and whether a path changed
  prices.ts           pure: the price table, its lookup and the dollars of a request
  forwarders.ts       pure: the Codex companion calls of agents, and the jobs they started
  schedule.ts         pure: next runs of a cron expression
  testing.ts          test helpers: state in memory, files, core stubs
  ui/band.tsx         the band above the prompt
  ui/pane.tsx         the /rabe command, its pane and actions
  ui/interaction.ts   pure state transitions for focus, held order, regain and arming
  ui/sequence.ts      serializes reserved press landings and focus moves
  ui/builtin.tsx      hides Claude Code's own count of background work
  ui/render.tsx       one renderer: lines as row Boxes of Text and plain Buttons, charts as a Raster
  ui/view.ts          the view contract: Model, Size, Selection, Press, Line, Node, Drawn, View, Action
  ui/cells/           pure cell engine for charts (grid.ts) and the 256-color palette (palette.ts)
  ui/views/           pure views: band, pane frame, items, detail, cost, effects, timeline
  ui/*.ts             pure helpers: lists, facts, format
types/index.d.ts      the state contract: item types and the $.state keys
data/prices.csv       list prices per model, read at run time for the cost estimate (see docs/feasibility/prices.md)
```

The pure [interaction model](architecture/interaction.md) owns focus, held order, regain retries and arming. The pane feeds events and runs its effects.

The details are split by area: [state and items](architecture/state.md), [sources](architecture/sources.md), [prices](architecture/prices.md), [UI](architecture/ui.md), [focus and keys](architecture/focus-and-keys.md), [focus order and arming](architecture/focus-order.md), and [view behavior](architecture/views.md).
