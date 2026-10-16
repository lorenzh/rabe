---
title: Rabe documentation
description: Index of the user, contributor, architecture, feasibility, and release documentation.
tags: [documentation, index]
keywords: [docs, architecture, feasibility, guide, reference]
---

# Rabe documentation

Use this index to find the guide that matches your question.

## Project

- [README](../README.md): what Rabe does, setup, privacy, requirements, and feedback.
- [User guide](guide.md): options, the price table format, troubleshooting, privacy and platform notes.
- [Agent instructions](../AGENTS.md): rules for coding agents and project changes.
- [Release steps](../RELEASING.md): checks and compatibility review before a release.
- [Changelog](../CHANGELOG.md): changes by version.
- [Security guidelines](security.md): threat model, path checks, title privacy, stored summaries, clipboard limits and stop refusals.
- [Testing](testing.md): unit, hook and UI tests, live checks with `scripts/live-check.sh`, issue #118 checks with and without agent teams, and CI.

## Architecture

- [Architecture overview](architecture.md): module map, the shared poll loop, pure scheduling rules, repeated starts, idle backoff, and links to detailed behavior.
- [Incremental file reads](architecture/reading.md): atomic output cursors, UTF-8 limits, stat-only idle polls, bounded parsing, shared object-only JSON helpers, desktop rollout reads, and metadata caches without process access.
- [Shared poll loop](architecture/loop.md): scheduling rules, source changes, repeated starts, and one completed write.
- [State and items](architecture/state.md): item model, idle teammates, registry, the shared `parentOf`, `runOf` and `KINDS` helpers, state writes, and turns.
- [Diagnostics](architecture/diagnostics.md): per-source poll records in `rabe.diag`, incremental bytes and unchanged-file skips, `/rabe-diag`, fixed error categories and report failures.
- [Sources](architecture/sources.md): poll callbacks that return changes, source modules, Linux listener parsing in `hooks/ports.ts`, and source tests.
- [Codex data](architecture/codex-data.md): Codex job parsing and incremental rollout parsing with restored step checks.
- [Agent items](architecture/agent-items.md): metadata cache recovery that preserves newer event fields, transcripts, turns, and the model and effort history.
- [Price estimate](architecture/prices.md): price lookup and cost estimates.
- [UI rendering](architecture/ui.md): view contract, renderer, palette, cells, sizing, band, and the shared formatting helpers (`na`, `idOrNa`, `cut`).
- [Pane interaction state](architecture/interaction.md): pure transitions for focus, nested presses, queued arrow bursts and wraparound, refused moves, held order, regain, opening and arming.
- [Focus and keys](architecture/focus-and-keys.md): pane behavior, key controls, split-list copy, message and delete actions, and focus moves.
- [Focus order and arming](architecture/focus-order.md): held order, append-only slots, gone rows that leave the lists, target-bound keys, and arming.
- [View behavior](architecture/views.md): tabs, cron schedules, workflow agent counts, inert stop controls, removed items, idle labels, live-item sorting, idle detail activity and Timeline windows, session summaries, full command and prompt details, and copy controls.
- [Pane data](architecture/pane-data.md): clipboard and toast security checks, the counts-only text answer of `/rabe` where no pane draws, plus stored-summary validation.
- [Shell words](architecture/shell-words.md): shell words, quoting, here-doc bodies and the write detector boundary.
- [Touched files](architecture/touched.md): file edits, conflicts, worktree rows, private list helpers and the diffs the Effects tab shows for the selected file.
- [File diffs](architecture/diffs.md): how diffs of file operations are captured at record time, capped, evicted with their items and kept private.
- [Cost groupings](architecture/groups.md): model and harness rows of the Cost tab, partial totals and held order.
- [Main-session usage](architecture/main-usage.md): per-model sums of the main session's steps for the partial Cost rows.

## Feasibility

- [Feasibility overview](feasibility.md): overview, confirmed cron fire identity and turn-end limits, stat-only idle reader benchmark, and links to the source limits.
- [Claude agents and workflows](feasibility/agents.md): agent and teammate identity, worktree, and workflow data with script path limits.
- [Codex and background work](feasibility/background-work.md): Codex jobs, foreground Bash calls, direct codex exec runs, shells, monitors, cron jobs, polling intervals, silent-server ports on Linux, and task output path limits.
- [User interface limits](feasibility/ui.md): API limits for rendering and input, the pinned header spike (overflow clipping with a negative `marginTop`), and sessions without a terminal (desktop app, VS Code, `claude -p`, Agent SDK).
- [Price data](feasibility/prices.md): price inputs and view data.
- [Files and runtime limits](feasibility/files.md): script edits from Bash diffs, confirmed shell writes, coverage settings, and open runtime questions.

## Research

- [0.10.0 design decisions](research/0-10-0-decisions.md): research report and recommendations for #199 (main-session tokens per model), #218 (dropped message submit) and #162 (diff in the Effects tab).
