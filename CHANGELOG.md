# Changelog

All notable changes to Rabe. The format follows [Keep a Changelog](https://keepachangelog.com/), and Rabe uses [semantic versioning](https://semver.org/). How a release is made: [RELEASING.md](RELEASING.md).

## [Unreleased]

### Fixed

- The Timeline legend says "scheduled run" for cron ticks. Ticks come from the schedule, without actual firing times or idle delays. ([#49](https://github.com/lorenzh/rabe/pull/49), fixes [#34](https://github.com/lorenzh/rabe/issues/34))
- The Cost tab says "sorted by tokens when opened" while it holds the opening order. New workers follow the held rows. ([#49](https://github.com/lorenzh/rabe/pull/49), fixes [#33](https://github.com/lorenzh/rabe/issues/33))
- Deleted cron jobs say `deleted`, hide future runs and keep delete dim. Delete errors show plain text. The previous-session summary counts only crons still running at session end. ([#49](https://github.com/lorenzh/rabe/pull/49), fixes [#28](https://github.com/lorenzh/rabe/issues/28))
- The Effects tab finds shell writes on independent lists after `||`, including later lines with here-docs. Conditional writes stay hidden. ([#49](https://github.com/lorenzh/rabe/pull/49), fixes [#27](https://github.com/lorenzh/rabe/issues/27))

## [0.4.1] - 2026-10-10

### Fixed

- The previous-session summary on the Timeline tab names the scope of each figure: `session ≈ $0.01 · 1m44s` for the whole session's cost and duration, `background 0 tok` for the tokens of the background items. It read as if background work cost $0.01 with no tokens. ([#47](https://github.com/lorenzh/rabe/pull/47), fixes [#46](https://github.com/lorenzh/rabe/issues/46))

## [0.4.0] - 2026-10-10

### Added

- Remove finished and failed items from the list: `r` removes the selected row once it is done, failed or stopped, and `a` removes every such row the search shows. Running items stay. Removed rows stay off the list, the Cost and Timeline tabs, a workflow's agent rows and the band's chips for the session; workflow phases, token counts, the cost totals and the Effects tab still count them. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#13](https://github.com/lorenzh/rabe/issues/13))
- The Cost tab, the detail and the band show an estimate in dollars (`≈ $0.16`) per Claude agent and per Codex job: the tokens of each model request times the list price of its model in `data/prices.csv`, with cache reads and writes, long-context rates and Codex cached input. A model Rabe does not know, an agent that started before Rabe loaded, or a Codex session file over 4 MiB, gone or unreadable shows `n/a`, and so does a total with any worker that has no estimate, also one without token data. The option `pricesFile` names your own price table in the same format, whose rows come first; a row for a model also prices that model's aliases in Rabe's table, except a name another of your rows names itself. A Codex job you stop keeps its estimate only while its session file is the one Rabe priced. A Codex job that resumes a thread counts only its own requests, tokens and file changes, not those of the jobs before or after it on that thread. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#15](https://github.com/lorenzh/rabe/issues/15))
- The pane shows the ids you need to pick work up again, and `c` copies the command: this session's id on the Cost tab and the previous session's id on the Timeline tab (`claude --resume <id>`), a Codex job's thread (`codex resume <thread id>`), and an agent's id and transcript. When the clipboard cannot be reached, a message shows the text to select. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#23](https://github.com/lorenzh/rabe/issues/23))

### Changed

- While the pane is open, an item that starts goes straight into the group of its kind in the Items list (AGENTS, SHELLS, MONITORS or CRON; a shell or monitor under the agent that started it) instead of a NEW group at the end; on the Effects tab, a new file or port goes into FILES or PORTS instead of a NEW section. When it comes above the focused row, Rabe moves the focus back onto that row, and Enter does nothing until it has. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#24](https://github.com/lorenzh/rabe/issues/24))
- A Codex job started through the Codex plugin's forwarding agent (`codex:codex-rescue`) shows as one row: the agent that only passed the request on has no row of its own, and its tokens and cost count toward the job; when the job or the agent has no estimate or no token count, the job shows `n/a` for it, not the part that is known. The one-line summary under a list below 90 columns counts them the same way and shows `cost n/a` when the sum is unknown. A job started by an agent that also did other work shows indented under that agent, also when it starts while the pane is open. Rabe links them only when the evidence fits one job: the agent's command names the job, or the job started while the command ran and has its prompt or its thread. A link the prompt made moves when the command returns another job or thread, and goes while two jobs fit. In the job's detail, `f` opens the agent with its turns, id and transcript. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#14](https://github.com/lorenzh/rabe/issues/14))
- The Timeline tab shows the last 4 hours. Items that ended before fold into one line, and a bar that started earlier is cut at the left edge with `◂`, so a long session stays readable. `w` widens the window for the open pane (4 h, 12 h, the whole session). The new option `timelineHours` sets the hours; `0` shows the whole session as before. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#20](https://github.com/lorenzh/rabe/issues/20))
- Rabe is built and tested with Claude Code 2.1.296 (was 2.1.295). ([#45](https://github.com/lorenzh/rabe/pull/45))

### Fixed

- The Effects tab lists every git worktree files changed in, with its branch and who changed files there, the main session included, and shows each file relative to its worktree. Before, it knew only the worktrees of isolated agents, so a worktree the main session or a plain agent edited by its full path was missing and its files showed with their full path. An agent started in a subfolder shows in the worktree that holds the folder, not as a worktree of its own, and its tree reads `n/a` when Rabe cannot tell it. The WORKTREES count now matches its rows. Windows drive and UNC paths match their worktree whatever their slashes and letter case. The conflict warning names a tree only when Git or the agent's worktree shows that it holds the file. Rabe reads the worktrees with `git worktree list`; without Git it works as before. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#19](https://github.com/lorenzh/rabe/issues/19))

### Removed

- Code nobody reached: the Effects tab's ` · cwd n/a` mark (every file path Rabe records is absolute) and the names the band built for each kind but no longer draws. Nothing changes on screen. ([#44](https://github.com/lorenzh/rabe/pull/44), fixes [#22](https://github.com/lorenzh/rabe/issues/22))

## [0.3.0] - 2026-10-09

### Added

- The Effects tab shows the files Codex jobs changed (added, updated or deleted) and the files the main session changed, with who changed each file and how. ([#16](https://github.com/lorenzh/rabe/pull/16))
- A price table of Claude and OpenAI models in `data/prices.csv`, for a later cost estimate per agent. No code reads it yet. ([#18](https://github.com/lorenzh/rabe/pull/18))

### Changed

- On the Effects tab, Enter or a click on a file opens the agent that changed it last; when the main session changed it last, it copies the file path instead. ([#16](https://github.com/lorenzh/rabe/pull/16))
- The band above the prompt is always one line of counts and the cost, with an empty row above it so the status line does not touch it; the empty row goes when the band has only one row. ([#17](https://github.com/lorenzh/rabe/pull/17))

### Fixed

- The Effects tab shows files that agents write through shell commands (`cat > file <<'EOF'`, `>>`, `tee`, `sed -i`, `cp`, `mv`, `touch`), marked `via shell`. Rabe takes the files named on the command line and checks each on disk: it lists a file only when it appeared, went away, or changed size or modification time while the command ran, so `touch -c`, `rm -f` of a missing file and failed copies show nothing, and `cp src dir` shows `dir/src`. Before, it showed only `Edit` and `Write` calls, so a subagent that wrote its files through Bash left it empty. ([#16](https://github.com/lorenzh/rabe/pull/16), fixes [#9](https://github.com/lorenzh/rabe/issues/9))

## [0.2.0] - 2026-10-09

### Added

- The arrow keys and the mouse work in the pane. ↑ and ↓ move from row to row and Enter opens a row. Click another row to select it; click the selected or focused row to open it. A click does not move the focus, so Enter still opens the row that has the focus. Rows, tabs and controls are buttons. The mouse needs Claude Code's fullscreen layout (`/tui fullscreen`). ([#11](https://github.com/lorenzh/rabe/pull/11))
- The detail beside the list follows the focus, without Enter. ([#11](https://github.com/lorenzh/rabe/pull/11))
- Shells and monitors an agent started show under that agent in the Items tab and in the band. ([#11](https://github.com/lorenzh/rabe/pull/11))
- In a workflow run's detail you can move through its agents and open one. On the Effects tab, Enter or a click on a file opens the agent that edited it last, and on an `ssh -L` line copies the line. ([#11](https://github.com/lorenzh/rabe/pull/11))

### Changed

- Colors come from the xterm 256-color palette and go to the terminal as exact palette entries, so the band, the panel and the selected row keep distinct colors under tmux, which reduced the old hex colors to the same grey. ([#11](https://github.com/lorenzh/rabe/pull/11))
- A cron job's next run shows as its clock time (`next 15:00`) instead of a countdown that read like one; a wakeup that waits for the session shows `due`. ([#11](https://github.com/lorenzh/rabe/pull/11))
- While the pane is open, rows keep their places: items that start later go to a NEW group at the end, and a row that is gone stays as a dim `gone` slot. `/rabe` sorts the lists again. ([#11](https://github.com/lorenzh/rabe/pull/11))
- In the Items list, a workflow run is stopped with `g` (stop run) instead of `x`; with one of its agents selected, `g` also stops that run. ([#11](https://github.com/lorenzh/rabe/pull/11))
- `g` (stop group) stops only the rows the search shows, not hidden rows of the same kind. ([#11](https://github.com/lorenzh/rabe/pull/11))
- Stop and delete stay dim until Rabe knows where the focus is. On the list, `x` and `g` work only after you move onto a row yourself, with an arrow, Tab or a click. ([#11](https://github.com/lorenzh/rabe/pull/11))

### Fixed

- Shells and monitors a subagent started end when their output file says so. ([#11](https://github.com/lorenzh/rabe/pull/11))
- After you change the tab, the search, a fold or the open item, the focus moves to a safe place, so Enter never presses a button that moved into the old place. ([#11](https://github.com/lorenzh/rabe/pull/11))
- The Timeline axis names each clock time once. ([#11](https://github.com/lorenzh/rabe/pull/11))

### Removed

- `j` and `k` in the pane; use ↑ and ↓. ([#11](https://github.com/lorenzh/rabe/pull/11))

## [0.1.0] - 2026-10-09

The first public version.

### Added

- A band above the prompt with the running background work: Claude subagents and workflows, Codex plugin jobs, background shells, monitors, cron jobs and loops, and the session cost. ([#5](https://github.com/lorenzh/rabe/pull/5))
- `/rabe`, a pane with the tabs Items, Cost, Effects and Timeline, a detail view for each kind, and turn views for Claude agents and Codex jobs. ([#5](https://github.com/lorenzh/rabe/pull/5))
- Stopping shells, agents, workflow runs and Codex jobs from the pane, and `/rabe-stop` for Codex jobs. ([#5](https://github.com/lorenzh/rabe/pull/5))
- The option `hideBuiltinTasks` (on by default), which hides Claude Code's own background-task hints while Rabe shows the same work. ([#5](https://github.com/lorenzh/rabe/pull/5))
- `/rabe:report-bug` and `/rabe:feedback`, which draft an issue for this repository and ask before they send it, and issue templates. ([#6](https://github.com/lorenzh/rabe/pull/6))

### Fixed

- Workflow agents no longer offer stop and message, which Claude Code does not support for a single workflow agent; their detail offers stopping the run. ([#8](https://github.com/lorenzh/rabe/pull/8))

[Unreleased]: https://github.com/lorenzh/rabe/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/lorenzh/rabe/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/lorenzh/rabe/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lorenzh/rabe/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lorenzh/rabe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lorenzh/rabe/releases/tag/v0.1.0
