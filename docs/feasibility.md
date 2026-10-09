---
title: What Rabe can see
description: Where Rabe gets each piece of data about background work (mod API, files on disk, source code), what is not available, the pane key, focus and mouse model, what plain Buttons and a Raster can draw, colors under tmux, what of Claude Code's own display a mod can hide, what the desktop app draws, and what still needs a runtime test.
tags: [feasibility, data-sources, mod-api, claude-code, codex, runtime-tests, focus, mouse]
keywords: [FileChange, move_path, completed_at_ms, started_at_ms, shell writes, candidates, fs.stat, mtime, here-doc, redirection, glob, brace expansion, command substitution, background list, rtk proxy, target-directory, rabe.edits, main session, via shell, desktop app, reload-plugins, next.trace, TraceEntry, focus rewrite, swallowed focus, tier builtin, own focus call, press closure, append-only, view change, landing, dock, inline, placement, resize, state.set in ui.render, plain Button, dimColor, hover, ui.scroll, ui.focus, ui.press, pointer, arrow keys, mouse, fullscreen, ansi256, xterm-256, reorder, focus ring, subagent tasks, staged, resume, timer writes, Raster, ui.panes, combining mark, Hangul Jamo, autonomous-loop, Edit, Write, session.usage, cost.usd, $.store, session.end, previous session, files touched, cells, bodyColumns, blit, autoFocus, closeOnEscape, PromptHint, TurnDuration, disableAgentView, agent list, local_bash, installed_plugins.json, CLAUDE_PLUGIN_DATA, CODEX_HOME, sessionId, custom_tool_call, CommandExecution, subagent, workflow, workflowPhase, meta.json, worktree, codex, rollout, threadId, token_count, model_reasoning_summary, shell, task output, monitor, cron, CronList, TaskStop, tool.check, hotkey, Button, focus, band, pane, 4 MiB, n/a, task-notification, output-file, exited with code, killed, backgroundTaskId, background_tasks, session_crons, ScheduleWakeup, scheduledFor, scheduled-trigger, transcript, tool_use, tool_result, item_completed, task_complete]
---

# What Rabe can see

This page lists where Rabe gets each piece of data, and what it cannot get. It is the result of two independent reviews (Claude Opus 5.5 and GPT-6.1 Sol), a second round on the points where they disagreed, and our own checks.

Checked on 2026-10-08 and 2026-10-09 with Claude Code 2.1.294 and 2.1.295 (runtime tests in an interactive 2.1.295 session) and Codex CLI 0.160.1 with the Codex plugin 1.0.6. Line numbers like `d.ts:3159` refer to the mod API types that Claude Code 2.1.294 writes to `.claude-plugin/types/claude-code/index.d.ts`.

## Where data comes from

Rabe uses three sources, in this order:

1. **The mod API.** Hooks and calls on `$`. Documented and stable.
2. **Files on disk.** Files that Claude Code and Codex write while they work. Not documented and can change in any release.
3. **The source code.** When the first two do not tell enough, read the Claude Code or Codex code to find out what a file holds and when it is written.

Everything from source 2 must be read defensively: a missing file or field shows as `n/a`, never as an error.

The types say a `$` call passes every hook but the one that made it. The live engine (2.1.295) does less: a `$.state.set` made in a `$.clock.every` or `$.clock.after` callback does not pass the plugin's own `state.set` hooks, while one made in a hook or a command does. So Rabe does nothing in a hook on its own writes; the write loop does it (see architecture).

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
| Files written through Bash | Not reported. Candidates from the Bash `tool.call` input `command`, each checked with `$.fs.stat` before and after the call ran: a result without `isError`, not `interrupted`, without `backgroundTaskId` (a background command has not finished). Tested in 2.1.295: a command that exits with code 1 comes back with `isError`, so its writes are not counted; a background teammate's here-doc into `/tmp` and its `>>` showed. See [Files written outside Edit and Write](#files-written-outside-edit-and-write). |
| End | `turn.complete` with `agentId` and `reason` (`answer`, `aborted`, `refusal`, `error`). Also `$.agent.list()` status for agents in the list. An ended agent can resume under the same id (d.ts:531); the list then shows it `pending`, `running` or `waiting` again. A teammate is `idle` after each turn. |
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
| Stop | The whole run with `TaskStop` on its task id. A single workflow agent cannot be stopped: `TaskStop` takes background tasks, teammates and named background agents only (d.ts:16568), so Rabe offers only `g: stop run` on a workflow agent. |

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
| File changes | `event_msg` `item_completed` of type `FileChange`: `item.changes` maps each absolute path to `{ type: 'add' \| 'update' \| 'delete', … }` (`content` for add and delete, `unified_diff` and `move_path` for update), with `item.status` (`completed`, `failed`) and the payload's `completed_at_ms`. A `move_path` that is not null would name a new path (all seen were null); Rabe then counts the old path deleted and the new one added. Rabe counts only completed ones. |
| Files a command wrote | Candidates from a `CommandExecution` with `exit_code` 0: the script of `command` (`["/bin/bash", "-lc", "<script>"]`), with relative paths taken against its `cwd` (a `file://` URL, decoded per path segment). A candidate counts when it is a file whose mtime lies between the record's `started_at_ms` and its `completed_at_ms` plus 2 s. |
| Cancel | `node <plugin root>/scripts/codex-companion.mjs cancel <id> --json --cwd <workspaceRoot>` through `$.process.run` (d.ts:3472). Set `CLAUDE_PLUGIN_DATA` to the plugin's data folder: without it the script looks in `$TMPDIR/codex-companion` and finds no job. The plugin root is `installPath` of `codex@openai-codex` in `<claude dir>/plugins/installed_plugins.json`. |

Limits: Codex deletes old session files, and their file changes with them; so older jobs show `n/a` for tokens and model. `$.fs` rejects reads over 4 MiB (d.ts:3200), and some session files are larger (seen: 4.9 MB): Rabe reads those with `grep -m 2` for the turn context and prompt and `tail -n 200` for the rest, through `$.process.run`, so the step list, the command count and the file changes cover the last 200 lines only.

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

### A subagent's background tasks

Tested in the same spike: a subagent's background `Bash` and `Monitor` calls reach the mod's `tool.call` hook with the subagent's `agentId` (the Bash result has `backgroundTaskId`, the Monitor result `taskId`). Their `tasks/<id>.output` files are in the main session's `tasks` folder. Their end notifications go only to the subagent: the main session gets only the agent's own task notifications. So Rabe ends a subagent's shells and monitors from the last line of the output file (`[exited with code N]`, `[killed]`), and does not end them at the main session's `Stop` when `background_tasks` leaves them out.

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
| Loop prompts | A `/loop` wakeup's prompt is the `/loop` input, passed verbatim each turn, so it fires as that text. An autonomous loop passes the sentinel `<<autonomous-loop-dynamic>>` to ScheduleWakeup, and the CronCreate mode uses `<<autonomous-loop>>` (d.ts:16436); both fire expanded, so their text matches no stored prompt. In Claude Code 2.1.295 the dynamic tick (`# Autonomous loop tick (dynamic pacing)`, with the loop preamble on its first fire) tells the model to call ScheduleWakeup again with the literal sentinel, so it names `<<autonomous-loop-dynamic>>`; the `loop.md` variant names `<<loop.md-dynamic>>`. The recurring tick (`# Autonomous loop tick`) names no sentinel. Read from the engine's bundled source; the text is not a contract and can change. |
| Runs | Prompts with origin `scheduled-trigger` (d.ts:8840). The prompt text tells which job; whether a run failed is a guess. |
| End | CronDelete; a one-time job deletes itself after it fires; a recurring job expires after 7 days. Rabe sees the last two only as a job gone from `session_crons` or `CronList`. |

## User interface

- **Band above the prompt.** Several lines up to `maxRows`; the engine draws its own "n more" row (d.ts:10200). Collapse belongs to the engine (ctrl+x ctrl+a, d.ts:10184); the hook gets no collapsed flag. When nothing runs, the band draws nothing.
- **Pane.** Docks beside the transcript, or sits inline at about a third of the height. There is no full screen (d.ts:10241). Design for narrow widths with `bodyColumns`.
- **Keys.** Tested: nothing holds focus when the pane opens, so Enter does nothing until Tab is pressed, unless a Button has `autoFocus`. Tab and Down move focus between Buttons (`ui.focus` fires); Left and Right do nothing. Enter presses the focused Button. Space never presses a Button: it takes the keys away from the pane. Hotkeys are one digit or one lowercase letter, and Shift is ignored, so `X` is the same as `x` (d.ts:1070, d.ts:9334). `/`, space and `←→` cannot be bindings. `Client.onKey` gets every key, but only after a mouse click (d.ts:1583). How the arrows, Tab and the mouse act on plain Buttons is under Buttons, focus and the mouse.
- **Esc.** Without `closeOnEscape` Esc only returns the keys and the pane stays. With it, Esc closes the pane while it holds the keys, and at an idle, empty prompt (`PaneOpenArgs.closeOnEscape`).
- **Opening focused.** `$.ui.open({ focus: true })` inside `command.run` places the pane but does not focus it. The same call from `$.clock.after(1500)` after the command does focus it. Esc may close the pane in that time, so the late call first checks `$.ui.panes()` (d.ts:2499, this plugin's open panes) and opens nothing when the pane is gone.
- **Large lists.** A tree draws at most 100,000 characters. Draw the visible part and use `$.ui.scroll`.
- **Status line and toasts.** `$.ui.status` (d.ts:2449) and `$.ui.toast` (d.ts:2437).

### Raster

`Raster` (d.ts:9188) is a fixed grid of cells: `columns` 1 to 512, `rows` 1 to 256, and `cells`, standard padded base64 of little-endian u32 triplets `[codePoint, foreground, background]`. A code point is one printable width-1 BMP character, or the tree is refused naming the cell's index. A color is `0x00RRGGBB`, or `0x01000000` for the terminal's default. Rabe cuts every grid to that size before it draws (`clamp`), and `safe()` keeps only an allow list of width-1 characters (see the cell engine in architecture). The engine's own width table is not published: it refuses characters a deny list misses, such as `☰` (U+2630), and takes every character on the allow list, which a test checks against the pinned version. No bold, underline or italic. It is a leaf (no press, no focus), and only the terminal's element table has it.

Rabe now draws only the band as a Raster; the pane is lines of Text and plain Buttons (see Buttons, focus and the mouse). Tested in a live 2.1.295 session in tmux (a spike mod, 2026-10-08):

1. A Raster draws in a docked pane and in the AbovePrompt band, with colored backgrounds, box drawing, blocks and the icons `◐ ▶ ✗ ◉ ⟳`. A Button row draws below a Raster.
2. Size: `$.ui.open({ columns: 100 })` gave a dock of `bodyColumns` 72 at a 200-column terminal; the person can drag it wider. At 100 terminal columns the pane goes inline with `bodyColumns` 96. A Raster wider than the body is cut on the right, and the engine's `[-]` draws over its top row. So every Raster is sized from `bodyColumns` and `scroll.bodyRows` on every draw.
3. `$.ui.blit` repaints only the changed cells (about 80 bytes a frame) and is refused after a size change ("a resize is a redraw"). Blit only between resizes, otherwise redraw.
4. Default focus works: `autoFocus` on a Button, or `$.ui.focus({ requestId, key })` right after the open. `$.ui.focus` is refused while keys are still arriving.
5. Button hotkeys such as `x` fire while the pane holds the keys. A letter no Button binds moves the focus to the prompt, and the next keys type into the composer. No hook can keep the keys: there is no `ui.key` event, and a focused Input takes every key and stops the hotkeys. So Rabe binds the common letters on Buttons and shows the hint.
6. Under tmux the colors become 256-color codes.
7. Text in Raster cells copies intact through terminal selection.
8. On the desktop `$.ui.resolve` still returns a Raster constructor, but it draws an empty Box. The text fallback is chosen by `e.surface === 'terminal'`, not by checking for `Raster`.

### Buttons, focus and the mouse

Tested in a live 2.1.295 session in the fullscreen layout under tmux (a spike mod with a list of plain Buttons in keyed Boxes, 2026-10-09). Where these differ from the d.ts, these win:

1. A `plain` Button draws its label without brackets. The focused one draws inverse over its label only; the row Box's `backgroundColor` still shows around it. A Button takes no color prop (`ButtonProps` has `dimColor` and `hover`, no `color` or `backgroundColor`), so the row's background comes from the Box around it.
2. In a pane where all rows fit, ↓ and ↑ move the focus row by row and wrap; Tab and Shift+Tab move it too (Tab also stops on the engine's close mark). Home, End, PgUp and PgDn only scroll; ← and → do nothing. In a pane taller than its body, ↓ and ↑ scroll the pane instead (`ui.scroll` with `by` 1 or -1 and no `pointer`) and leave the focus where it is. A `ui.scroll` hook that answers such a move with `{}` and calls `$.ui.focus` on the next or previous row makes the arrows move row by row again, and the pane follows the focus. Rabe does this (see architecture).
3. Enter presses the focused Button (`ui.press`, then `onPress`).
4. A mouse click on a row presses it (`ui.press`, surface terminal). A click on a Button does not move the focus ring and does not take the keyboard from the prompt; a click on an empty part of the pane does. Hover is drawn by the engine from the `hover` props (bold, a color, inverse) and not reported to the mod. The wheel scrolls the pane (`ui.scroll` with a `pointer`). Claude Code turns on mouse reporting (`?1000h ?1002h ?1003h ?1006h`, SGR) only in the fullscreen layout (`/tui fullscreen`), so clicks reach a pane only there.
5. Box and Text `backgroundColor`, `bold` and `color` draw. Under tmux a hex color for a Box or Text is reduced to 256 colors with a coarse formula: `#203020` and `#402040` both became 59. The engine passes `ansi256(n)` through unchanged (its color check takes `#rgb`, `#rrggbb`, `rgb(…)`, `ansi256(n)` and `ansi:<name>`), and its reduction of 24-bit codes, which Raster cells use, picks the nearest of the xterm cube and grey entries, so an exact entry stays itself. So Rabe uses only xterm-256 entries and names them `ansi256(n)` on the terminal.
6. Drawing again every second for 10 minutes: no flicker, and the focus stays. When the rows reorder, the focus ring stays on the old index: Enter then presses another row, and no `ui.focus` fires. `$.ui.focus` on the old key afterwards does not move it back. So a list must not reorder while it holds the focus. The same holds for any Button, Input or Select that comes or goes above the focused one, so the renderer keeps the focusable keys append-only while the pane is open (see architecture). A `ui.render` hook may not write `$.state`: the host refuses the write (drawing is pure), so what a render must remember lives in a module value.
7. Tab to a row out of view scrolls the pane to show it; with the arrow fix above, ↑ and ↓ do too.
8. `$.ui.open({ focus: true })` works only while the composer is empty and no dialog is open, and `$.ui.focus` is refused while the pane does not hold the keyboard (from the design thread anthropics/claude-code#91870). On a desktop the first click on a pane that does not hold the keyboard only focuses it.
9. A change of the view keeps the ring's index too (tested live 2026-10-09, 200 columns): with the ring on the first Cost row, a click on the `1: Items` tab or the hotkey `1` drew the Items tab with `[ x: stop ]` at that index, and Enter stopped the agent. `$.ui.focus` on another key than the one the ring sits on moves it, also right after the state write that changes the view: the element is awaited until the new tree draws it. Rabe moves the ring after each change of the view (see architecture). Calling `$.ui.focus` on the search Input on every keystroke keeps the text and the caret.
10. When a resize moves the pane between dock and inline (110 columns), the engine takes the keys from it: the next digit typed into the prompt. A resize that keeps the seat keeps the keys. `$.ui.open({ focus: true })` 500 ms after the drawing that shows the new seat gives them back; Rabe does this only when the pane held the keys before the move (see architecture).
11. A change to a file of the hooks module reloads it in the running session (the transcript says `rabe: reloaded (13 hooks: …)`; tested live 2026-10-09). The pane stays open with the keys and the ring keeps its index, but the module's values start anew, so Rabe's hold and arming are gone; the next drawing is fresh. Rabe therefore starts disarmed after a reload (see Arming in architecture). The test kit fails a plugin's own `$.ui.focus`, as a refused call does.
12. A hook beneath Rabe's may move a `ui.focus` onto another element of Rabe's (`next({ ...e, element })`), refuse it, or answer `{}` without `next`, which keeps the ring where it was (d.ts:4030). Where the ring went is in `next.trace` (d.ts:6565): one entry per link beneath, nearest first, the engine's last, each with its `tier`, its `outcome` and what it `received`; it ends short of the engine at a link that answered itself. So only a last entry of the engine's that `returned` says where the ring landed: its `received.element`. Live (2.1.295, 2026-10-09) a person's Tab reads `[engine, core, returned, <element>]`. The test kit's own hooks stand in for the engine as one link of plugin `test` in tier `builtin` (beneath its core rejects `ui.focus`: no implementation), so a test puts the hook that rewrites or swallows into an inline plugin of its own (`append` tier). No person or administrator installs into `builtin` or `core`.
13. Rabe's own `$.ui.focus` called from a Button's or Input's closure (the `$` of the `ui.render` hook that drew it) moves the ring but runs none of Rabe's hooks, not even a `.catch` (tested live 2.1.295, 2026-10-09): Rabe's `ui.focus` hook never saw its landings, so every change of the view through a press counted as refused and left stop and delete dim, for clicks and keys alike. The same call from the `$` of a `ui.scroll` or `ui.press` hook does run Rabe's `ui.focus` hook (origin `plugin`, trace to the engine). A plugin's `$` has no `press`: only a surface (a click, Enter, a hotkey) and the test kit raise `ui.press`. `UiPressArgument` has no field that tells a click from Enter or a hotkey. A click on a Button moves no ring and gives the pane no keys (item 4); while the pane does not hold the keys, `$.ui.focus` is refused (item 8).

Only Button and Markdown links take a press, so a row is one pressable thing, with no second control inside it. Other mods draw selectable lists the same way, one plain Button per row in a keyed Box (agentpane, pr-pulse, the github-issues picker of claude-code-mods, agent-flow). A `Select` is refused above 64 options. A `Client` would give ← → and pointer drags, but only after a click, and has no focus ring, hotkeys or Button styling, so Rabe does not use one.

Where the window stands comes from the Pane's `scroll.offset` (d.ts `SiteScroll`): the first row of the tree it showed when the hook was asked. A scroll through `ui.scroll` asks again; on the terminal the engine's own moves (following the focus, a clamp) do not, so a draw may read the offset from before the focus moved. Rabe adds what the engine does to keep the focused row in view (see the split in architecture).

The test kit cannot answer a plugin's `$.ui.focus` (nothing beneath the plugins answers it, and a test hook on `ui.focus` is not reached), so the focus moves of the arrow fix and after a change of the view are checked only live; `landing` names the keys in a pure function with its own test.

### The Claude desktop app

Checked by the maintainer in the Claude desktop app on Windows with Rabe 0.1.0. The pane draws its text fallback, plain text and buttons, and it reads close to the terminal's pane. A plugin installed while the app runs does not load until `/reload-plugins` or a new session, as in the terminal.

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
| Files changed | the `detail.edits` of agent and Codex items and `rabe.edits` for the main session: `{ path, at, via, change }` per change (`via` `edit`, `write`, `shell` or `codex`) | agents source (`Edit`, `Write`, Bash), Codex source (rollout); no line counts |
| Session cost | `Model.usd`, from `$.session.usage().cost.usd` (d.ts:11635), the dollars `/cost` totals | `pane.tsx` and `band.tsx` on each draw; absent where the host keeps no ledger |
| Previous session | `Model.previous`, from `$.store` key `previous:<cwd>` | `pane.tsx` on `session.end`, from the items and `$.session.usage()` |

A file the source cannot read leaves the value as it was, and the view shows `n/a`.

## Files written outside Edit and Write

An agent can write files through Bash (`cat > ~/.agents/skills/x/SKILL.md <<'EOF'`), and Codex through its own patch tool. Neither is an `Edit` or `Write` call, so the Effects tab once missed them (issue #9).

- **Candidates, then the disk.** The command text alone never proves a write: `false && touch x || true` and `cp missing out; true` succeed without writing, `touch -c absent` and `rm -f absent` change nothing, `cp src dir` writes `dir/src`, `sed -i q a b` never touches `b`, and `HOME=/tmp` moves `~`. So `hooks/writes.ts` only proposes candidates, each a write or a delete, and the file system decides. A false entry can show a false conflict, so a missed file is the better error.
- **Bash calls.** Before the call runs, the Bash `tool.call` hook stats each absolute candidate (kind, size, mtime). A failed stat alone does not mean the path is missing: in 2.1.295 the error is a `HooksError` without `code`, and its message is free text that any `fs.stat` hook can set (a denial can end in `ENOENT`). So the path counts as missing only when `$.fs.list` of its parent folder succeeds and does not name it, or the parent is missing by the same rule. A listing that fails or is denied (no permission, the parent is a file) or that still names the path, also in another letter case or Unicode form (case-insensitive and normalizing disks such as macOS or Windows), leaves it unknown. Each folder is listed once per look, and the listings count toward the 1 s limit. `$.fs.exists` is no help: it also answers false for a file in a folder it may not read. After a call that ran to its end it stats them again. A path is written when it was not there and is a file now, or its mtime or size changed; deleted when it was there and is gone; else nothing. A stat error leaves that path out. Over 20 candidates, or looks that take over 1 s, record nothing for the call. Main session and agents work the same way.
- **Codex commands.** A rollout is read after the command, so there is no look before. A candidate counts when it is a file now and its mtime lies within the command's run (`started_at_ms` to `completed_at_ms` plus 2 s). A poll stats each path once, and its checks stop after 1 s in all: a path whose stat has not come back is left out. A delete leaves nothing to look at, so deletes come only from `FileChange` records, which stay the main Codex source. `mv` keeps the old mtime, so a Codex `mv` target is missed.
- **Shell commands.** What the parser proposes: `>`, `>>`, `>|`, `&>`, `&>>` and `N>`/`N>>` redirections to a file (not `/dev/…`, not a dup like `>&2`; `<`, `<>` and `<<<` never), and a fixed table of commands with their options: `tee`, `sed -i` (also `--in-place`, `-e`/`--expression`, `-f`), `touch` (`-r`/`--reference`, `-d`), `rm`, and `cp`, `mv`, `install`, `ln` (`-t`/`--target-directory`, `-T`). `mv` and `rm` delete. `rtk proxy`, `command`, `builtin`, `env`, `nice`, `nohup`, `time`, `sudo` and `VAR=val` are unwrapped first. `~/` takes `HOME` from `$.env`; when the command assigns `HOME` anywhere, every `~` is skipped. `cp a b` proposes both `b` and `b/a`, since `b` may be a folder; multi-file `sed -i` proposes every file.
- **What it skips.** Words are read with bash quoting (single, double, backslash, `$'…'`), and command substitutions keep their own quotes. Only commands that surely run count: the list joined by `&&`, `;` and newlines, up to the first `||`, `&`, `if`, `while`, `until`, `for`, `case`, `function`, `{ }` or `( )` group, `[[`, `[` or `test`, `exit` or `exec`; nothing after that counts, and a list sent to the background counts not at all. In a pipeline only redirections and `tee` count. A here-doc body is skipped up to its delimiter after bash quote removal (`<<E"OF"` ends at `EOF`); with no delimiter nothing from the here-doc on counts. A path with `$`, `` ` ``, a glob (`*`, `?`, `[`), braces, `~user`, a bare `~` or a process substitution is skipped. A command with an option the table does not know (`cp --parents`, `rm -i`), or with a word that could expand into an option, is skipped. A substitution that holds a here-doc or a `case` makes the whole line count nothing. After a `cd` that the next command does not depend on through `&&`, relative paths are skipped.
- **The Bash call has no cwd.** The `tool.call` input carries none (d.ts:12595), and the shell's cwd can change between calls, so a relative path cannot be looked at and is skipped. A `cd /abs` in the same command makes the paths after it absolute. Codex's `CommandExecution` has its `cwd`.
- **Limits.** The tab marks these `via shell`. A file written and put back to the same mtime and size within one command is missed. A file whose name is not on the command line stays invisible, since only candidates are looked at: a script's `open(…, 'w')` in Python, a build tool, a formatter, `git checkout`, a `curl -o`. A command that failed (`isError`, or a Codex exit code other than 0) records nothing, even when it wrote a file before it failed. A Codex file changed again after its command ended falls out of that command's window.
- **The main session.** Its `Edit`, `Write` and Bash calls (no `agentId`) go to `$.state` key `rabe.edits`, so the tab shows its files and a file the main session and an agent both changed as a conflict.

## Files outside the project

Tested: `$.fs.stat` and `$.fs.read` read files under `~/.codex/sessions` and `/tmp/claude-<uid>/…/tasks/` without a prompt or a denial.

## Still to test at runtime

- Does Rabe's own turn line (`✻ Brewed for 5s`, one empty line above) sit where the engine's did, in every transcript layout?
- Which words does the hint use for agents, workflows and teammates in its task part? `stripTasks` drops parts like `1 background agent`; others stay.
- Is the pane readable in light terminal themes? Plain text and the background use the terminal's default; chips, panels and the selected row use fixed dark 256-color backgrounds.
- A subagent's monitor ends from its output file only once Rabe knows some task output path (a shell's, or a monitor end notification's), since the Monitor result carries none. Does a subagent ever start a monitor before any such path is known?

- Does `$.session.usage().cost` count the subagents' requests as well as the main thread's? Rabe labels it the session cost either way.
- Does `CronList` also list `ScheduleWakeup` wakeups, and with which id?
- Is a `prompt.submit` raised for a task notification delivered into a running turn, as for one dequeued when idle?
- What does the output file of a monitor that hit its timeout end with?

- Do `TaskStop` and `CronList` run without a prompt in auto mode too?
- Does the pane's `x: stop` on a Codex job act during a turn? It runs `/rabe-stop` through `$.command.run`, which the API says is "queued and run once the session is idle" (d.ts `command.run`); the command is registered with `immediate: true`, which may or may not apply to a plugin's call.
- How much does a band redraw every second cost while the user types?
