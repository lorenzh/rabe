---
title: What Rabe can see
description: Where Rabe gets each piece of data about background work (mod API, files on disk, source code), what is not available, the pane key model, and what still needs a runtime test.
tags: [feasibility, data-sources, mod-api, claude-code, codex, runtime-tests]
keywords: [installed_plugins.json, CLAUDE_PLUGIN_DATA, CODEX_HOME, sessionId, custom_tool_call, CommandExecution, subagent, workflow, workflowPhase, meta.json, worktree, codex, rollout, threadId, token_count, model_reasoning_summary, shell, task output, monitor, cron, CronList, TaskStop, tool.check, hotkey, Button, focus, band, pane, 4 MiB, n/a]
---

# What Rabe can see

This page lists where Rabe gets each piece of data, and what it cannot get. It is the result of two independent reviews (Claude Opus 5.5 and GPT-6.1 Sol), a second round on the points where they disagreed, and our own checks.

Checked on 2026-10-08 with Claude Code 2.1.294 and 2.1.295 (runtime tests in an interactive 2.1.295 session) and Codex CLI 0.160.1 with the Codex plugin 1.0.6. Line numbers like `d.ts:3159` refer to the mod API types that Claude Code 2.1.294 writes to `.claude-plugin/types/claude-code/index.d.ts`.

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
| Tokens, live | `turn.step` carries `agentId` and `usage` per request (d.ts:13316, d.ts:13413). `turn.complete` has the total (d.ts:13201). Rabe adds up the steps, so an agent that runs again after a message keeps counting. |
| Tool calls per response | The `turn.step` result lists `toolUses` with name and input. Rabe uses it for the tool count and the turns, so it needs no `tool.call` hook per agent. |
| End | `turn.complete` with `agentId` and `reason` (`answer`, `aborted`, `refusal`, `error`). Also `$.agent.list()` status for agents in the list. |
| Cost | Rabe's price table times tokens. An estimate. |
| Turns | Text and tool calls from the `turn.step` result (Rabe uses this). The transcript `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` has them too, for agents that ran before Rabe loaded. |
| Worktree at start | `classic.SubagentStart` gives the worktree as `cwd`, with `agent_id` and `transcript_path`. `agent.spawn` has no cwd. The Agent `tool.call` input shows `isolation: 'worktree'`. Tested. |
| Worktree, branch, phase, parent | `subagents/agent-<id>.meta.json`, written about 1.5 s after the agent starts and rewritten later, so read it after a short delay and again on change. Fields: `worktreePath`, `worktreeBranch`, `cwd`, `parentAgentId`, `workflowPhase`, `description`, `name`, `toolUseId`, `requestShape`. Seen on disk as well: `agentType`, `spawnDepth`, `isFork`, `model`, `requestNonInteractive`. Each field is optional. The API has the worktree only in the result of a finished foreground agent (d.ts:16722). |
| Message an agent | `$.session.send({ to: { agentId } })` (d.ts:2849). It also resumes a finished agent. Not for workflow agents. |
| Stop | `$.tool.call({ tool: 'TaskStop' })` (d.ts:16568). Tested: core allows `TaskStop` and `CronList` without a prompt in manual mode, so no `tool.check` hook is needed. Rabe's own calls carry `origin.plugin === 'rabe'`. Not tested in auto mode. |

## Workflows

| Data | Source |
|---|---|
| Run id, name, script path, transcript folder | Workflow tool result (d.ts:21251). |
| Agents of a run | `agent.spawn` with `workflow: { runId, agentIndex }` (d.ts:357). |
| Phase of each agent | `workflowPhase` in the agent's meta file. |
| Phase names | The `meta.phases` block of the script at `scriptPath`. Each phase is a string or `{ title, detail }`. |
| Agent files | Workflow agents write their transcript and meta file to `transcriptDir`, which is `<session>/subagents/workflows/<runId>/`. The same folder has `journal.jsonl` (one record per agent start and result, with phase). `<session>/workflows/<runId>.json` has the run's status, phases and totals, but is written when the run ends. |
| End | The task notification: a `prompt.submit` with origin `task-notification` whose text holds `<task-id>` (the run's `taskId`) and `<status>` (`completed`, `failed`, `killed`). The text format is not documented. |
| Retries | Not reported: a retried agent does not raise `agent.spawn` again (d.ts:345). |
| Stop | The whole run with `TaskStop` on its task id. A single workflow agent cannot be stopped. |

## Codex jobs

| Data | Source |
|---|---|
| Jobs, status, title, prompt | The Codex plugin's files under `<claude dir>/plugins/data/codex-openai-codex/state/<slug>-<hash>/`: `state.json` (the last 50 jobs of the workspace, short entries) and `jobs/<id>.json` and `.log` (one job, full). `<slug>` is the base name of the workspace's git root and `<hash>` the first 16 hex digits of the SHA-256 of its real path, so Rabe lists the folders instead of computing the name. Poll every 1 to 2 seconds. |
| Which session | `sessionId` in the job is the Claude Code session id (the plugin's `SessionStart` hook puts it in `CODEX_COMPANION_SESSION_ID`); compare with `$.session.id()`. `state.json` can hold a bare status patch without `sessionId`; the job file has it. `$.session.usage().startedAt` skips the folders whose `state.json` did not change during this session. |
| Status | `queued`, `running`, `completed`, `failed`, `cancelled`. `completedAt` and `startedAt` are ISO times. `summary` in the job file is the prompt's start; in `state.json` it is the result's first line once the job ended. `kindLabel` is `rescue`, `review` or `adversarial-review`. Only background jobs keep `request.model`, `request.effort` and `request.prompt`. |
| Model, effort, tokens per request | Codex's own session file `<codex home>/sessions/YYYY/MM/DD/rollout-<local time>-<threadId>.jsonl` (`CODEX_HOME`, default `~/.codex`; the folder date is local time). The job file has the `threadId`. Records: `turn_context` (`model`, `effort`, `sandbox_policy.type`), `token_count` (`info.last_token_usage`, `info.total_token_usage` with `input_tokens`, `cached_input_tokens`, `output_tokens`). Tested: the file grows during the run, one `token_count` per step, so tokens update live. |
| Prompt | The first `event_msg` `item_completed` of type `UserMessage`. Also for foreground jobs, whose job file has no `request`. |
| Progress text | `response_item` records of type `message` with role `assistant`, text in `content[].output_text`. |
| Commands | `custom_tool_call` is written when a command starts; its `input` is a small script such as `text(await tools.exec_command({cmd:"git status"}))`, so the command is taken from `cmd`. `item_completed` of type `CommandExecution` (`command` as argv, `cwd`, `status`, `aggregated_output`, `exit_code`) comes about when it ends, then `custom_tool_call_output` with the same `call_id`, then `token_count`. `task_complete` comes last. There are no `exec_command_end` records. |
| Reasoning summaries | `response_item` of type `reasoning`, `summary[].text`, only when `model_reasoning_summary` is set in the Codex config (for example `concise`). Without it `summary` is empty and the reasoning is encrypted. We tested both. |
| Cancel | `node <plugin root>/scripts/codex-companion.mjs cancel <id> --json --cwd <workspaceRoot>` through `$.process.run` (d.ts:3472). Set `CLAUDE_PLUGIN_DATA` to the plugin's data folder: without it the script looks in `$TMPDIR/codex-companion` and finds no job. The plugin root is `installPath` of `codex@openai-codex` in `<claude dir>/plugins/installed_plugins.json`. |

Limits: Codex deletes old session files, so older jobs show `n/a` for tokens and model. `$.fs` rejects reads over 4 MiB (d.ts:3200), and some session files are larger (seen: 4.9 MB): Rabe reads those with `grep -m 2` for the turn context and prompt and `tail -n 200` for the rest, through `$.process.run`, so the step list and command count cover the last 200 lines only.

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
- **Keys.** Tested: nothing holds focus when the pane opens, so Enter does nothing until Tab is pressed. Tab and Down move focus between Buttons (`ui.focus` fires); Left and Right do nothing. Enter presses the focused Button. Space never presses a Button: it takes the keys away from the pane. Hotkeys are one digit or one lowercase letter, and Shift is ignored, so `X` is the same as `x` (d.ts:1070, d.ts:9334). `/`, space and `←→` cannot be bindings. Esc closes the pane. `Client.onKey` gets every key, but only after a mouse click (d.ts:1583).
- **Opening focused.** `$.ui.open({ focus: true })` inside `command.run` places the pane but does not focus it. The same call from `$.clock.after(1500)` after the command does focus it.
- **Large lists.** A tree draws at most 100,000 characters. Draw the visible part and use `$.ui.scroll`.
- **Status line and toasts.** `$.ui.status` (d.ts:2449) and `$.ui.toast` (d.ts:2437).

## Files outside the project

Tested: `$.fs.stat` and `$.fs.read` read files under `~/.codex/sessions` and `/tmp/claude-<uid>/…/tasks/` without a prompt or a denial.

## Still to test at runtime

- Do `TaskStop` and `CronList` run without a prompt in auto mode too?
- How much does a band redraw every second cost while the user types?
