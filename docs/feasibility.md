---
title: What Rabe can see
description: Overview of Rabe's data sources and links to their detailed limits.
tags: [feasibility, data-sources]
keywords: [data sources, limits, privacy]
---

# What Rabe can see

This page lists where Rabe gets each piece of data, and what it cannot get. It is the result of two independent reviews (Claude Opus 5.5 and GPT-6.1 Sol), a second round on the points where they disagreed, and our own checks.

Checked on 2026-10-08 and 2026-10-09 with Claude Code 2.1.294 and 2.1.295 (runtime tests in an interactive 2.1.295 session) and Codex CLI 0.160.1 with the Codex plugin 1.0.6. Line numbers like `d.ts:3159` refer to the mod API types that Claude Code 2.1.294 writes to `.claude-plugin/types/claude-code/index.d.ts`.

Details by area: [Claude agents and workflows](feasibility/agents.md), [Codex and background work](feasibility/background-work.md), [user interface](feasibility/ui.md), [prices](feasibility/prices.md), and [files and runtime limits](feasibility/files.md).

## Where data comes from

Rabe uses three sources, in this order:

1. **The mod API.** Hooks and calls on `$`. Documented and stable.
2. **Files on disk.** Files that Claude Code and Codex write while they work. Not documented and can change in any release.
3. **The source code.** When the first two do not tell enough, read the Claude Code or Codex code to find out what a file holds and when it is written.

Everything from source 2 must be read defensively: a missing file or field shows as `n/a`, never as an error.

The types say a `$` call passes every hook but the one that made it. The live engine (2.1.295) does less: a `$.state.set` made in a `$.clock.every` or `$.clock.after` callback does not pass the plugin's own `state.set` hooks, while one made in a hook or a command does. So Rabe does nothing in a hook on its own writes; the write loop does it (see architecture).

## No list of running work

The mod API has no call that lists the running background tasks. `background_tasks` and `session_crons` arrive only on the classic `Stop` and `SubagentStop` events (d.ts:12056, d.ts:12186).

Rabe keeps its own list. It adds an item when a hook reports a start (`tool.call` for Bash, Monitor, CronCreate, ScheduleWakeup and Workflow, `agent.spawn`), and closes it when a task notification or result arrives. It corrects the list on `classic.Stop`. Items that started before Rabe loaded show only what `$.agent.list()`, `CronList` and the files on disk tell.
