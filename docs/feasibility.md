---
title: What Rabe can see
description: Where Rabe gets each piece of data about background work (mod API, files on disk, source code), what is not available, the pane key model, what a Raster can draw, what of Claude Code's own display a mod can hide, and what still needs a runtime test.
tags: [feasibility, data-sources, mod-api, claude-code, codex, runtime-tests]
keywords: [staged, rabe.evicted, Raster, ui.panes, combining mark, Hangul Jamo, autonomous-loop, Edit, Write, session.usage, cost.usd, $.store, session.end, previous session, files touched, cells, bodyColumns, blit, autoFocus, closeOnEscape, PromptHint, TurnDuration, disableAgentView, agent list, local_bash, installed_plugins.json, CLAUDE_PLUGIN_DATA, CODEX_HOME, sessionId, custom_tool_call, CommandExecution, subagent, workflow, workflowPhase, meta.json, worktree, codex, rollout, threadId, token_count, model_reasoning_summary, shell, task output, monitor, cron, CronList, TaskStop, tool.check, hotkey, Button, focus, band, pane, 4 MiB, n/a, task-notification, output-file, exited with code, killed, backgroundTaskId, background_tasks, session_crons, ScheduleWakeup, scheduledFor, scheduled-trigger, transcript, tool_use, tool_result, item_completed, task_complete]
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
| Prompt | `agent.spawn`'s `prompt`, the Agent tool's `prompt` parameter (d.ts:276). Agents that started before Rabe loaded have none and show the description. |
| Tool calls, recent tools | `tool.call` carries `agentId` (d.ts:12589). |
| Tokens, live | `turn.step` carries `agentId` and `usage` per request (d.ts:13316, d.ts:13413). `turn.complete` has the total (d.ts:13201). Rabe adds up the steps, so an agent that runs again after a message keeps counting. |
| Tool calls per response | The `turn.step` result lists `toolUses` with name and input: the calls the model asks for, which may still be refused or fail (d.ts:13391). Rabe uses it for the tool count and the turns. |
| Edits that changed a file | A `tool.call` hook on `Edit` and `Write`: after `next(e)`, a result without `isError` means the engine ran it; a refusal answers `deny` and no result (d.ts:12631). A result with `staged: true` was held for the machine owner to review and left the file unchanged (d.ts:20404, 21302); it is the only such flag in the two result types. The result's `filePath` names the file. `e.agentId` names the subagent. |
| End | `turn.complete` with `agentId` and `reason` (`answer`, `aborted`, `refusal`, `error`). Also `$.agent.list()` status for agents in the list. |
| Cost | `$.session.usage().cost.usd` gives the whole session's dollars as `/cost` totals them; Rabe shows it as the session cost. No source gives dollars per agent. A price table in Rabe times tokens would give an estimate; it does not exist yet, so the cost per agent shows `n/a`. Claude's `input` counts cache reads, as Codex's `input_tokens` counts `cached_input_tokens`, so the two compare. |
| Turns | Text and tool calls from the `turn.step` result (Rabe uses this). The transcript `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` has them too, for agents that ran before Rabe loaded. |
| Worktree at start | `classic.SubagentStart` gives the worktree as `cwd`, with `agent_id` and `transcript_path`. `agent.spawn` has no cwd. The Agent `tool.call` input shows `isolation: 'worktree'`. `transcript_path` is the session's transcript, not the agent's. The hook runs inside the spawn, before `agent.spawn` returns the `agentId`. Tested. |
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
| Command, task id | Bash `tool.call` input and result `backgroundTaskId` (d.ts:16032, d.ts:20215). Set for `run_in_background`, Ctrl+B (`backgroundedByUser`) and a timed-out command (`timedOutAfterMs`). |
| Output file path | The result `text`: `Command running in background with ID: <id>. Output is being written to: <path>.` Tested. |
| Output, exit code | `/tmp/claude-<uid>/<project>/<session>/tasks/<taskId>.output`. Live output, then an empty line and `[exited with code N]`, or `[killed]` for a stopped task. Tested. Read with `$.fs` up to 4 MiB, beyond that with `tail -c` through `$.process.run`. |
| End | `prompt.submit` with `origin.kind` `task-notification`. Its text holds `<task-notification>` blocks with `<task-id>`, `<tool-use-id>`, `<output-file>`, `<status>` (`completed`, `failed`, `killed`) and `<summary>` (`… failed with exit code 3`). Tested. The `UserMessage` row's `task` (d.ts:14467) has the same fields and `durationMs`, but only while the row is drawn. |
| Still running | `classic.Stop` `background_tasks` lists running work (`type` `shell` with `command`, `monitor`, `subagent`, `workflow`); a finished task is not in it. A Monitor tool task runs as a `local_bash` task, so it is listed as `shell` with a `command`; `monitor` is only an MCP or WebSocket monitor (checked in the 2.1.295 source, `local_bash: "shell"`, `monitor_mcp` and `monitor_ws: "monitor"`). |
| Port | Not reported. Guessed from the output (`localhost:5173`, `127.0.0.1:8080`, `port 4000`). `ss -ltnp` is not used. |
| Stop | `TaskStop`. |

## Monitors

Command, description, timeout and `persistent` come from the Monitor tool input and result (d.ts:16231, d.ts:20620). A monitor has no interval: it is one command that streams lines.

The result text (`Monitor started (task <id>, expires in …)`) has no file path. The output file sits beside the shells' files (`tasks/<taskId>.output`) and ends with the same exit line. Tested. Rabe takes the folder from a path it already knows; the end notification also carries `<output-file>`.

Notifications: each batch of lines arrives as a `<task-notification>` with `<summary>Monitor event: "…"</summary>` and `<event>` lines and no `<status>`; the end has `<status>completed</status>` and `Monitor "…" stream ended`. Tested.

Line times: task notifications are delayed and often carry several lines, so their time is not when the line was written. Follow the monitor's output file instead, and label the times "received".

## Cron jobs and loops

| Data | Source |
|---|---|
| New job | CronCreate input (`cron`, `prompt`, `recurring`) and result (`id`, `humanSchedule`) (d.ts:16050, d.ts:20291). |
| Jobs made before Rabe loaded | `CronList`: id, `cron`, `humanSchedule`, prompt (d.ts:20300). Runs without a prompt (tested). |
| Current list | `classic.Stop` `session_crons`: id, `schedule`, `recurring`, prompt; no `humanSchedule`. It also holds wakeups. |
| Next run | Computed from the schedule in local time (`hooks/schedule.ts`). Claude Code adds up to 10 % jitter to recurring jobs (at most 15 min), and fires one-time jobs at :00 or :30 up to 90 s early. |
| Loop wakeup | ScheduleWakeup result `scheduledFor` (d.ts:20956); `stop: true` ends the loop. No job id. |
| Loop prompts | A `/loop` wakeup's prompt is the `/loop` input, passed verbatim each turn, so it fires as that text. An autonomous loop passes the sentinel `<<autonomous-loop-dynamic>>` to ScheduleWakeup, and the CronCreate mode uses `<<autonomous-loop>>` (d.ts:16436); both fire expanded, so their text matches no stored prompt. |
| Runs | Prompts with origin `scheduled-trigger` (d.ts:8840). The prompt text tells which job; whether a run failed is a guess. |
| End | CronDelete; a one-time job deletes itself after it fires; a recurring job expires after 7 days. Rabe sees the last two only as a job gone from `session_crons` or `CronList`. |

## User interface

- **Band above the prompt.** Several lines up to `maxRows`; the engine draws its own "n more" row (d.ts:10200). Collapse belongs to the engine (ctrl+x ctrl+a, d.ts:10184); the hook gets no collapsed flag. When nothing runs, the band draws nothing.
- **Pane.** Docks beside the transcript, or sits inline at about a third of the height. There is no full screen (d.ts:10241). Design for narrow widths with `bodyColumns`.
- **Keys.** Tested: nothing holds focus when the pane opens, so Enter does nothing until Tab is pressed, unless a Button has `autoFocus`. Tab and Down move focus between Buttons (`ui.focus` fires); Left and Right do nothing. Enter presses the focused Button. Space never presses a Button: it takes the keys away from the pane. Hotkeys are one digit or one lowercase letter, and Shift is ignored, so `X` is the same as `x` (d.ts:1070, d.ts:9334). `/`, space and `←→` cannot be bindings. `Client.onKey` gets every key, but only after a mouse click (d.ts:1583).
- **Esc.** Without `closeOnEscape` Esc only returns the keys and the pane stays. With it, Esc closes the pane while it holds the keys, and at an idle, empty prompt (`PaneOpenArgs.closeOnEscape`).
- **Opening focused.** `$.ui.open({ focus: true })` inside `command.run` places the pane but does not focus it. The same call from `$.clock.after(1500)` after the command does focus it. Esc may close the pane in that time, so the late call first checks `$.ui.panes()` (d.ts:2499, this plugin's open panes) and opens nothing when the pane is gone.
- **Large lists.** A tree draws at most 100,000 characters. Draw the visible part and use `$.ui.scroll`.
- **Status line and toasts.** `$.ui.status` (d.ts:2449) and `$.ui.toast` (d.ts:2437).

### Raster

`Raster` (d.ts:9188) is a fixed grid of cells: `columns` 1 to 512, `rows` 1 to 256, and `cells`, standard padded base64 of little-endian u32 triplets `[codePoint, foreground, background]`. A code point is one printable width-1 BMP character, or the tree is refused naming the cell's index. A color is `0x00RRGGBB`, or `0x01000000` for the terminal's default. Rabe cuts every grid to that size before it draws (`clamp`), and `safe()` replaces combining marks, format characters (such as the Devanagari virama U+094D) and Hangul Jamo vowels and finals (U+1160 to U+11FF, U+D7B0 to U+D7FF), which take no cell. No bold, underline or italic. It is a leaf (no press, no focus), and only the terminal's element table has it.

Tested in a live 2.1.295 session in tmux (a spike mod, 2026-10-08):

1. A Raster draws in a docked pane and in the AbovePrompt band, with colored backgrounds, box drawing, blocks and the icons `◐ ▶ ✗ ◉ ⟳`. A Button row draws below a Raster.
2. Size: `$.ui.open({ columns: 100 })` gave a dock of `bodyColumns` 72 at a 200-column terminal; the person can drag it wider. At 100 terminal columns the pane goes inline with `bodyColumns` 96. A Raster wider than the body is cut on the right, and the engine's `[-]` draws over its top row. So every Raster is sized from `bodyColumns` and `scroll.bodyRows` on every draw.
3. `$.ui.blit` repaints only the changed cells (about 80 bytes a frame) and is refused after a size change ("a resize is a redraw"). Blit only between resizes, otherwise redraw.
4. Default focus works: `autoFocus` on a Button, or `$.ui.focus({ requestId, key })` right after the open. `$.ui.focus` is refused while keys are still arriving.
5. Button hotkeys `j`, `k`, `x` fire while the pane holds the keys. A letter no Button binds moves the focus to the prompt, and the next keys type into the composer. No hook can keep the keys: there is no `ui.key` event, and a focused Input takes every key and stops the hotkeys. So Rabe binds the common letters on Buttons and shows the hint.
6. Under tmux the colors become 256-color codes.
7. Text in Raster cells copies intact through terminal selection.
8. On the desktop `$.ui.resolve` still returns a Raster constructor, but it draws an empty Box. The text fallback is chosen by `e.surface === 'terminal'`, not by checking for `Raster`.

### Claude Code's own count of background work

- **PromptHint** (d.ts:10152). `hint` is one string, the parts joined by ` · `: `PR #5 · 2 shells, 1 monitor · esc to interrupt · ↓ to manage`. Tested: `next({ ...e, props: { ...e.props, hint } })` with the task part removed hides it, and the mode label (`⏵⏵ auto mode on`) is not part of `hint` and stays. Rewriting the whole hint would drop `esc to interrupt` and `PR #5`, so only the task part goes. ↓ still opens Claude Code's background manager.
- **TurnDuration** (d.ts:10078). The line reads `✻ Brewed for 5s · done 1:16 · 2 shells, 1 monitor still running`, but the props are only `word`, `durationMs` and `onScreen`. The source shows the rest comes from the message's timestamp (`done`), a token budget, hidden messages and the live task list, none of them props. To drop the "still running" part a hook must draw the whole line, and it then cannot show `done 1:16`. While background agents or workflows are pending, the engine draws "Waiting for …" and no "still running" part.
- **The agent list under the prompt** cannot be hidden by a mod: it is no `RenderComponent`, and no setting hides it. `disableAgentView` does not hide it, and it turns off agent view, `claude agents`, `--bg` and the daemon, so Rabe does not use it.

## Where the views get their data

The views read no files. The sources keep what the views show in session state:

| Data | Where the views read it | Written by |
|---|---|---|
| Agent turns | `rabe.turns` | `turn.step` with `agentId` (agents source); agents that ran before Rabe loaded have no turns |
| Codex steps, prompt, model | the item's `detail` (`steps`, `prompt`, `model`, `effort`) | the Codex source, from the Codex session file |
| Shell and monitor output | `rabe.lines` | the shells and monitors sources, from the task output file |
| Files agents edited | the agent item's `detail.edits`: `{ path, at }` per `Edit` or `Write` call that changed the file | agents source; no line counts |
| Session cost | `Model.usd`, from `$.session.usage().cost.usd` (d.ts:11635), the dollars `/cost` totals | `pane.tsx` and `band.tsx` on each draw; absent where the host keeps no ledger |
| Previous session | `Model.previous`, from `$.store` key `previous:<cwd>` | `pane.tsx` on `session.end`, from the items and `$.session.usage()` |

A file the source cannot read leaves the value as it was, and the view shows `n/a`.

## Files outside the project

Tested: `$.fs.stat` and `$.fs.read` read files under `~/.codex/sessions` and `/tmp/claude-<uid>/…/tasks/` without a prompt or a denial.

## Still to test at runtime

- Does Rabe's own turn line (`✻ Brewed for 5s`, one empty line above) sit where the engine's did, in every transcript layout?
- Which words does the hint use for agents, workflows and teammates in its task part? `stripTasks` drops parts like `1 background agent`; others stay.
- Is the grid's background readable in light terminal themes? Plain text and the background use the terminal's default; chips and the selected row use fixed dark backgrounds.

- Does `$.session.usage().cost` count the subagents' requests as well as the main thread's? Rabe labels it the session cost either way.
- Does `CronList` also list `ScheduleWakeup` wakeups, and with which id?
- Is a `prompt.submit` raised for a task notification delivered into a running turn, as for one dequeued when idle?
- What does the output file of a monitor that hit its timeout end with?

- Do `TaskStop` and `CronList` run without a prompt in auto mode too?
- Does the pane's `x: stop` on a Codex job act during a turn? It runs `/rabe-stop` through `$.command.run`, which the API says is "queued and run once the session is idle" (d.ts `command.run`); the command is registered with `immediate: true`, which may or may not apply to a plugin's call.
- How much does a band redraw every second cost while the user types?
