# Changelog

All notable changes to Rabe. The format follows [Keep a Changelog](https://keepachangelog.com/), and Rabe uses [semantic versioning](https://semver.org/). How a release is made: [RELEASING.md](RELEASING.md).

## [Unreleased]

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
