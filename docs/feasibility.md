---
title: What Rabe can see
description: Where Rabe gets each piece of data about background work (mod API, files on disk, source code), what is not available, the pane key model, and what still needs a runtime test.
tags: [feasibility, data-sources, mod-api, claude-code, codex]
keywords: [subagent, workflow, workflowPhase, meta.json, worktree, codex, rollout, threadId, token_count, model_reasoning_summary, shell, task output, monitor, cron, CronList, TaskStop, tool.check, hotkey, Button, focus, band, pane, 4 MiB, n/a]
---

# What Rabe can see

This page lists where Rabe gets each piece of data, and what it cannot get. It is the result of two independent reviews (Claude Opus 5.5 and GPT-6.1 Sol), a second round on the points where they disagreed, and our own checks.

Checked on 2026-10-08 with Claude Code 2.1.294 and 2.1.295 and Codex CLI 0.160.1 with the Codex plugin 1.0.6. Line numbers like `d.ts:3159` refer to the mod API types that Claude Code 2.1.294 writes to `.claude-plugin/types/claude-code/index.d.ts`.

## Where data comes from

Rabe uses three sources, in this order:

1. **The mod API.** Hooks and calls on `$`. Documented and stable.
2. **Files on disk.** Files that Claude Code and Codex write while they work. Not documented and can change in any release.
3. **The source code.** When the first two do not tell enough, read the Claude Code or Codex code to find out what a file holds and when it is written.

Everything from source 2 must be read defensively: a missing file or field shows as `n/a`, never as an error.

## No list of running work

The mod API has no call that lists the running background tasks. `background_tasks` and `session_crons` arrive only on the classic `Stop` and `SubagentStop` events (d.ts:12056, d.ts:12186).

Rabe keeps its own list. It adds an item when a hook reports a start (`tool.call` for Bash, Monitor, Agent, CronCreate and Workflow, `agent.spawn`), and closes it when a task notification or result arrives. It corrects the list on `classic.Stop`. Items that started before Rabe loaded show only what `$.agent.list()`, `CronList` and the files on disk tell.

## Claude subagents

| Data | Source |
|---|---|
| id, type, description, name, status, parent | `$.agent.list()` (d.ts:3159, d.ts:122). Status values at d.ts:544. Workflow agents are not in this list (d.ts:3157). |
| Start time | Rabe's own clock at `agent.spawn` (d.ts:4063). |
| Tool calls, recent tools | `tool.call` carries `agentId` (d.ts:12589). |
| Tokens, live | `turn.step` carries `agentId` and `usage` per request (d.ts:13316, d.ts:13413). `turn.complete` has the total (d.ts:13201). |
| Cost | Rabe's price table times tokens. An estimate. |
| Turns | Text and tool calls from the hooks, or the transcript `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`. |
| Worktree, branch, phase, parent | `subagents/agent-<id>.meta.json`, written when the agent starts. Fields: `worktreePath`, `worktreeBranch`, `cwd`, `parentAgentId`, `workflowPhase`, `description`, `name`, `toolUseId`, `requestShape`. The API has the worktree only in the result of a finished foreground agent (d.ts:16722). |
| Message an agent | `$.session.send({ to: { agentId } })` (d.ts:2849). It also resumes a finished agent. Not for workflow agents. |
| Stop | `$.tool.call({ tool: 'TaskStop' })` (d.ts:16568). This runs the permission check. A `tool.check` hook that answers `allow` only for Rabe's own `TaskStop` calls avoids the prompt (d.ts:12786). Needs a runtime test. |

## Workflows

| Data | Source |
|---|---|
| Run id, name, script path, transcript folder | Workflow tool result (d.ts:21251). |
| Agents of a run | `agent.spawn` with `workflow: { runId, agentIndex }` (d.ts:357). |
| Phase of each agent | `workflowPhase` in the agent's meta file. |
| Phase names | The `meta.phases` block of the script. |
| Retries | Not reported: a retried agent does not raise `agent.spawn` again (d.ts:345). |
| Stop | The whole run with `TaskStop` on its task id. A single workflow agent cannot be stopped. |

## Codex jobs

| Data | Source |
|---|---|
| Jobs, status, title, prompt | The Codex plugin's job files: `~/.claude/plugins/data/codex-openai-codex/state/<workspace>/jobs/<id>.json` and `.log`. Poll every 1 to 2 seconds. Only background jobs keep `request.model` and `request.effort`. |
| Model, effort, tokens per request | Codex's own session file `~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl`. The job file has the `threadId`. Records: `turn_context` (model, effort), `token_count` (`last_token_usage`, `total_token_usage`). |
| Progress text | `response_item` records of type `message` from the assistant. Plain text. |
| Commands | `item_completed` records of type `CommandExecution`: command, cwd, status, output, exit code. |
| Reasoning summaries | Only when `model_reasoning_summary` is set in the Codex config (for example `concise`). Without it, reasoning is encrypted. We tested both. |
| Cancel | `node <plugin>/scripts/codex-companion.mjs cancel <id> --json` through `$.process.run` (d.ts:3472). |

Limits: Codex deletes old session files, so older jobs show `n/a` for tokens and model. `$.fs` rejects reads over 4 MiB (d.ts:3200), and some session files are larger: read those with `tail` or `jq` through `$.process.run`.

## Background shells

| Data | Source |
|---|---|
| Command, task id | Bash `tool.call` input and result `backgroundTaskId` (d.ts:16032, d.ts:20215). |
| Output, exit code | `/tmp/claude-<uid>/<project>/<session>/tasks/<taskId>.output`. Live output, and a last line `[exited with code N]`. Take the path from the tool result, do not build it. |
| End, duration | Task notification `props.task` with `status` and `durationMs` (d.ts:14467). |
| Port | Not reported. Guess from the output (`localhost:5173`) or from `ss -ltnp`. |
| Stop | `TaskStop`. |

## Monitors

Command, description, timeout and `persistent` come from the Monitor tool input and result (d.ts:16231, d.ts:20620). A monitor has no interval: it is one command that streams lines.

Line times: task notifications are delayed and often carry several lines, so their time is not when the line was written. Follow the monitor's output file instead, and label the times "received".

## Cron jobs and loops

`CronList` gives id, schedule, `humanSchedule` and prompt (d.ts:20300). Rabe computes the next run from the schedule. A one-time wakeup has `scheduledFor` (d.ts:20956). Runs show up as prompts with origin `scheduled-trigger` (d.ts:8840); whether a run failed is a guess.

## User interface

- **Band above the prompt.** Several lines up to `maxRows`; the engine draws its own "n more" row (d.ts:10200). Collapse belongs to the engine (ctrl+x ctrl+a, d.ts:10184); the hook gets no collapsed flag. When nothing runs, the band draws nothing.
- **Pane.** Docks beside the transcript, or sits inline at about a third of the height. There is no full screen (d.ts:10241). Design for narrow widths with `bodyColumns`.
- **Keys.** Tab and the arrow keys move focus between Buttons, Inputs and Selects; Enter presses the focused Button. Hotkeys are one digit or one lowercase letter, and Shift is ignored, so `X` is the same as `x` (d.ts:1070, d.ts:9334). `/`, space and `←→` cannot be bindings. Esc closes the pane. `Client.onKey` gets every key, but only after a mouse click (d.ts:1583). Rabe opens its pane focused, so no mouse is needed.
- **Large lists.** A tree draws at most 100,000 characters. Draw the visible part and use `$.ui.scroll`.
- **Status line and toasts.** `$.ui.status` (d.ts:2449) and `$.ui.toast` (d.ts:2437).

## Still to test at runtime

- Does a `tool.check` allow suppress the prompt for Rabe's `TaskStop` and `CronList` calls?
- Does space press a focused Button?
- Does a Codex session file grow while the job runs, so tokens update live?
- Is the `cwd` of `classic.SubagentStart` the agent's worktree?
- How much does a band redraw every second cost while the user types?
