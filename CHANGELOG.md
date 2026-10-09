# Changelog

All notable changes to Rabe. The format follows [Keep a Changelog](https://keepachangelog.com/), and Rabe uses [semantic versioning](https://semver.org/). How a release is made: [RELEASING.md](RELEASING.md).

## [Unreleased]

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

[Unreleased]: https://github.com/lorenzh/rabe/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lorenzh/rabe/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lorenzh/rabe/releases/tag/v0.1.0
