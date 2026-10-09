# Changelog

All notable changes to Rabe. The format follows [Keep a Changelog](https://keepachangelog.com/), and Rabe uses [semantic versioning](https://semver.org/). How a release is made: [RELEASING.md](RELEASING.md).

## [Unreleased]

### Added

- The arrow keys and the mouse work in the pane: ↑ and ↓ move from row to row, Enter or a click opens a row, and the tabs and controls are buttons. (#TBD)
- The detail beside the list follows the focus, without Enter. (#TBD)
- Shells and monitors an agent started show under that agent in the Items tab and in the band. (#TBD)
- Workflow agents can be walked and opened from the run's detail, and Effects files and `ssh -L` lines are rows you can press. (#TBD)

### Changed

- `j` and `k` no longer move in the pane; use ↑ and ↓. (#TBD)
- A cron job's next run shows as its clock time (`next 15:00`) instead of a countdown that read like one; a wakeup that waits for the session shows `due`. (#TBD)

### Fixed

- Shells and monitors a subagent started end when their output file says so. (#TBD)
- After a change of the tab, the search, a fold or the open item, the focus moves to a safe place, so Enter never presses a button that came to the old place. Rows found while the pane is open go to the end. (#TBD)
- Stop and delete stay dim until Rabe knows where the focus is. On the list, `x` and `g` act only after you move the focus onto a row that is still there; a `gone` row or a group heading does not count, nor a move another plugin sends to another row. (#TBD)
- The Timeline axis names each clock time once. (#TBD)

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

[Unreleased]: https://github.com/lorenzh/rabe/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lorenzh/rabe/releases/tag/v0.1.0
