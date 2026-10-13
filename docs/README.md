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
- [Agent instructions](../AGENTS.md): rules for coding agents and project changes.
- [Release steps](../RELEASING.md): checks and compatibility review before a release.
- [Changelog](../CHANGELOG.md): changes by version.
- [Security guidelines](security.md): threat model, path checks, title privacy, stored summaries, clipboard limits and stop refusals.
- [Testing](testing.md): unit, hook and UI tests, live checks with `scripts/live-check.sh`, issue #118 checks with and without agent teams, and CI.

## Architecture

- [Architecture overview](architecture.md): module map, the shared poll loop, pure scheduling rules, repeated starts, idle backoff, and links to detailed behavior.
- [Incremental file reads](architecture/reading.md): atomic output cursors, UTF-8 limits, stat-only idle polls, bounded parsing, desktop rollout reads, and metadata caches without process access.
- [Shared poll loop](architecture/loop.md): scheduling rules, source changes, repeated starts, and one completed write.
- [State and items](architecture/state.md): item model, idle teammates, registry, state writes, and turns.
- [Diagnostics](architecture/diagnostics.md): per-source poll records in `rabe.diag`, incremental bytes and unchanged-file skips, `/rabe-diag`, fixed error categories and report failures.
- [Sources](architecture/sources.md): poll callbacks that return changes, source modules, and source tests.
- [Codex data](architecture/codex-data.md): Codex job parsing and incremental rollout parsing with restored step checks.
- [Agent items](architecture/agent-items.md): metadata cache recovery that preserves newer event fields, transcripts and turns.
- [Price estimate](architecture/prices.md): price lookup and cost estimates.
- [UI rendering](architecture/ui.md): view contract, renderer, palette, cells, sizing, and band.
- [Pane interaction state](architecture/interaction.md): pure transitions for focus, nested presses, queued arrow bursts and wraparound, refused moves, held order, regain, opening and arming.
- [Focus and keys](architecture/focus-and-keys.md): pane behavior, key controls, split-list copy, message and delete actions, and focus moves.
- [Focus order and arming](architecture/focus-order.md): held order, append-only slots, gone rows that leave the lists, target-bound keys, and arming.
- [View behavior](architecture/views.md): tabs, cron schedules, workflow agent counts, inert stop controls, removed items, idle labels, live-item sorting, idle detail activity and Timeline windows, session summaries, full command and prompt details, and copy controls.
- [Pane data](architecture/pane-data.md): clipboard and toast security checks, plus stored-summary validation.
- [Shell words](architecture/shell-words.md): shell words, quoting, here-doc bodies and the write detector boundary.
- [Touched files](architecture/touched.md): file edits, conflicts, worktree rows and private list helpers.

## Feasibility

- [Feasibility overview](feasibility.md): overview, confirmed cron fire identity and turn-end limits, stat-only idle reader benchmark, and links to the source limits.
- [Claude agents and workflows](feasibility/agents.md): agent and teammate identity, worktree, and workflow data with script path limits.
- [Codex and background work](feasibility/background-work.md): Codex jobs, foreground Bash calls, direct codex exec runs, shells, monitors, cron jobs, polling intervals, and task output path limits.
- [User interface limits](feasibility/ui.md): API limits for rendering and input, and the pinned header spike (overflow clipping with a negative `marginTop`).
- [Price data](feasibility/prices.md): price inputs and view data.
- [Files and runtime limits](feasibility/files.md): script edits from Bash diffs, confirmed shell writes, coverage settings, and open runtime questions.
