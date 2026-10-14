---
title: Claude agents and workflows
description: Data available for Claude subagents, git worktrees, and workflow runs.
tags: [feasibility, agents, workflows]
keywords: [Claude subagents, git worktrees, workflows, SubagentStart, agent list, agent name, idle, isTeammate, teammateId, waiting, meta.json, transcript, task-notification, worktreePath, worktreeBranch, workflowPhase, CronDelete, isDeleted, rabe.edits, main session, via shell, FileChange, Edit, Write, turn.step, session.usage, cost.usd, cache write, ephemeral_5m_input_tokens, ephemeral_1h_input_tokens, tool.check]
---

# Claude agents and workflows

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
| Files written through Bash | From the Bash result's `bashEditDiff.changedFiles` when Claude Code sends it (auto mode or `bashEditDiffEnabled` in user settings). Otherwise candidates from the Bash `tool.call` input `command`, each checked with `$.fs.stat` before and after the call ran: a result without `isError`, not `interrupted`, without `backgroundTaskId` (a background command has not finished). Tested in 2.1.295: a command that exits with code 1 comes back with `isError`, so its writes are not counted; a background teammate's here-doc into `/tmp` and its `>>` showed. See [Files written outside Edit and Write](files.md#files-written-outside-edit-and-write). |
| Idle and teammate identity | `agent.spawn` carries `isTeammate`; its result and `$.agent.list()` carry `teammateId`. Rabe keeps the identity in `detail.isTeammate`. After a teammate turn completes, Rabe sets idle unless the list reports an end. The poll also finds idle teammates in their own terminal panes. No `TeammateIdle` hook is needed. Only a proven teammate becomes idle. Plain subagents keep their previous behavior even if the list reports `idle`. |
| End | `turn.complete` with `agentId` and `reason` (`answer`, `aborted`, `refusal`, `error`). Also `$.agent.list()` status for agents in the list. An ended agent can resume under the same id (d.ts:531); the list then shows it `pending`, `running` or `waiting` again. A teammate is `idle` after each turn and ends only on list status `completed`, `failed` or `killed`. `waiting` means held on work or approval and stays running in Rabe. A closed terminal pane can leave a stale roster status. Rabe cannot infer an end from that status alone. |
| Cost | `$.session.usage().cost.usd` gives the whole session's dollars as `/cost` totals them; Rabe shows it as the session cost. No source gives dollars per agent, so Rabe estimates them: each `turn.step` usage (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, `model`) times its model's row in the price table (see [Prices](prices.md#prices)). The usage has no split of cache writes into 5-minute and 1-hour entries; the subagent transcripts have one (`cache_creation.ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`), and in the transcripts on the maintainer's machine (2026-10-09) 10,747 of 10,765 subagent responses wrote 5-minute entries only, while the main session writes 1-hour ones. So Rabe bills an agent's cache writes at the 5-minute price; a rare 1-hour write makes the estimate a little low. Claude's `input` counts cache reads, as Codex's `input_tokens` counts `cached_input_tokens`, so the two compare. |
| Turns | Text and tool calls from the `turn.step` result. Rabe keeps the newest 30 turns per agent and at most 16,000 characters per answer. A cut ends with `…`. The transcript `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` has the original answers too, for agents that ran before Rabe loaded. |
| Worktree at start | `classic.SubagentStart` gives the worktree as `cwd`, with `agent_id` and `transcript_path`. An agent started in a plain subfolder also has a `cwd` that is not the session's, so the `cwd` alone does not prove a worktree: Rabe keeps it as `cwd` and takes the worktree from the meta file or git. `agent.spawn` has no cwd. The Agent `tool.call` input shows `isolation: 'worktree'`. `transcript_path` is the session's transcript, not the agent's. The hook runs inside the spawn, before `agent.spawn` returns the `agentId`. Tested. |
| Model and effort per agent | The `turn.step` input has `model` (as resolved for the step) and `effort` (`low` … `max` or a number), absent for a model without effort such as Haiku; the result's `usage.model` names the model that answered, but the result has no effort, so the pair's effort is the request's as Rabe saw it. Rabe keeps each pair that differs from the last, up to six, in `detail.models`, and skips `<synthetic>`. The same fields are in the transcripts (`message.model`, `requestedModel`, `effort`, `perTurnEffort` on every `assistant` record, Claude Code 2.1.296; Haiku records have no `effort`), which Rabe does not read for this. The main session has no row yet, so its changes are not shown. |
| Worktree, branch, phase, parent | `subagents/agent-<id>.meta.json`, written about 1.5 s after the agent starts and rewritten later, so read it after a short delay and again on change. Fields: `worktreePath`, `worktreeBranch`, `cwd`, `parentAgentId`, `workflowPhase`, `description`, `name`, `toolUseId`, `requestShape`. Seen on disk as well: `agentType`, `spawnDepth`, `isFork`, `model`, `requestNonInteractive`. Each field is optional. For a workflow agent, Rabe reads from the workflow's `transcriptDir`, or derives the directory from `scriptPath` when that field is missing; it keeps checking after completion until `workflowPhase` is available. The API has the worktree only in the result of a finished foreground agent (d.ts:16722). |
| Message an agent | `$.session.send({ to: { agentId } })` (d.ts:2849). It also resumes a finished agent. Not for workflow agents. |
| Agent id, transcript | `agent.spawn`'s `agentId` and `classic.SubagentStart`'s `transcript_path` (see above). Rabe shows both and copies the id; in the running session `$.session.send` resumes an agent by message. |
| Stop | `$.tool.call({ tool: 'TaskStop' })` (d.ts:16568). Tested: core allows `TaskStop` and `CronList` without a prompt in manual mode, so no `tool.check` hook is needed. Rabe's own calls carry `origin.plugin === 'rabe'`. Not tested in auto mode. |


## Git worktrees

| Data | Source |
|---|---|
| The repository's worktrees and their branches | `git worktree list --porcelain` through `$.process.run` (d.ts:3487), in the session's folder, with a 5 s timeout, at the start and every 10 s. Each block has `worktree <path>`, `HEAD <sha>`, then `branch refs/heads/<name>` or `detached`, maybe `locked` or `prunable`; a bare repository's entry has `bare`. The first block is the main worktree. Without `-z`, git quotes a path with unusual characters; Rabe leaves such a path out rather than unquote it. Git for Windows prints drive paths with forward slashes (`C:/Users/me/repo`) and UNC paths (`//host/share/repo`), while the Edit and Write results carry `C:\Users\…`; Rabe compares a Windows path with `/` and in lower case (`pathKey` in `model.ts`), and a POSIX path as it is. Not checked live on Windows. |
| Which worktree a file is in | The worktree with the longest path that is a prefix of the file's absolute path. A subagent's meta file names its own worktree (`worktreePath`), but the main session and an agent without isolation can edit any worktree through absolute paths (issue #19); only git knows them all. |

Limits: `$.process` is CLI only, so the desktop app shows worktrees from agent metadata alone, as do a folder that is not a Git repository and a machine without `git`. On Windows, Rabe keeps git's drive and UNC paths and matches them to file paths whatever their slashes and letter case (see the table); this is not checked live on Windows. A worktree made and removed between two polls is not listed, and its files show relative to their editor's folder. Paths are compared as text: a symlinked path to a worktree does not match it.


## Workflows

| Data | Source |
|---|---|
| Run id, name, script path, transcript folder | Workflow tool result (d.ts:21251). |
| Agents of a run | `agent.spawn` with `workflow: { runId, agentIndex }` (d.ts:357). |
| Phase of each agent | `workflowPhase` in the agent's meta file. |
| Phase names | The `meta.phases` block of the script at `scriptPath`. Rabe accepts only this session’s `<claude dir>/projects/<project>/<session>/workflows/scripts/` folder with the project folder encoded from `$.session.root()`. It checks the resolved file against the resolved script folder before reading. An unexpected or unresolved path leaves phases unknown. Each phase is a string or `{ title, detail }`. |
| Agent files | Workflow agents write their transcript and meta file to `transcriptDir`, which is `<session>/subagents/workflows/<runId>/`. The same folder has `journal.jsonl` (one record per agent start and result, with phase). `<session>/workflows/<runId>.json` has the run's status, phases and totals, but is written only when the run ends. |
| End | The task notification: a `prompt.submit` with origin `task-notification` whose text holds `<task-id>` (the run's `taskId`) and `<status>` (`completed`, `failed`, `killed`). The text format is not documented. |
| Retries | Not reported: a retried agent does not raise `agent.spawn` again (d.ts:345). |
| Stop | The whole run with `TaskStop` on its task id. A single workflow agent cannot be stopped: `TaskStop` takes background tasks, teammates and named background agents only (d.ts:16568), so Rabe offers only `g: stop run` on a workflow agent. |

Agent metadata is cached by path, size and modification time in session state. A changed file is read whole. An unchanged file causes no content read or cursor write. Agent turns and tokens still come from API events. Rabe does not poll agent transcript contents. See [incremental file reads](../architecture/reading.md).
