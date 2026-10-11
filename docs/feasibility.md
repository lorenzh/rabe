---
title: What Rabe can see
description: Overview of Rabe's data sources and links to their detailed limits.
tags: [feasibility, data-sources]
keywords: [data sources, limits, privacy, CronDelete, isDeleted, resume-last, resumed thread, completedAt, prices.csv, price table, cache write, FileChange, shell writes, candidates, fs.stat, mtime, here-doc, redirection, glob, brace expansion, command substitution, rabe.edits, main session, desktop app, reload-plugins, next.trace, focus rewrite, swallowed focus, append-only, view change, landing, state.set in ui.render, plain Button, ui.scroll, ui.focus, ui.press, pointer, arrow keys, mouse, Raster, combining mark, Hangul Jamo, Edit, Write, session.usage, cost.usd, $.store, session.end, previous session, files touched, autoFocus, PromptHint, TurnDuration, agent list, installed_plugins.json, CLAUDE_PLUGIN_DATA, CODEX_HOME, sessionId, custom_tool_call, CommandExecution, subagent, workflow, workflowPhase, meta.json, worktree, rollout, threadId, token_count, model_reasoning_summary, shell, task output, monitor, cron, CronList, TaskStop, 4 MiB, n/a, task-notification, output-file, exited with code, killed, backgroundTaskId, background_tasks, session_crons, ScheduleWakeup, pricesFile, plugin.root, costUsd, last_token_usage, cache_write_input_tokens, ephemeral_5m_input_tokens, ephemeral_1h_input_tokens, codex-rescue, forwarder, codex-companion, Thread ready, started in the background, kindLabel, summary, claude --resume, codex resume, session.id, resume.id, ui.copy, OSC 52, git worktree list, porcelain, worktrees, longest prefix]
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

The types say a `$` call passes every hook but the one that made it. The live engine (2.1.295) does less: a `$.state.set` made in a `$.clock.every` or `$.clock.after` callback does not pass the plugin's own `state.set` hooks, while one made in a hook or a command does. So Rabe does nothing in a hook on its own writes; the write loop does it (see [state and items](architecture/state.md#the-write-loop)).

## No list of running work

The mod API has no call that lists the running background tasks. `background_tasks` and `session_crons` arrive only on the classic `Stop` and `SubagentStop` events (d.ts:12056, d.ts:12186).

Rabe keeps its own list. It adds an item when a hook reports a start (`tool.call` for Bash, Monitor, CronCreate, ScheduleWakeup and Workflow, `agent.spawn`), and closes it when a task notification or result arrives. It corrects the list on `classic.Stop`. Items that started before Rabe loaded show only what `$.agent.list()`, `CronList` and the files on disk tell.
