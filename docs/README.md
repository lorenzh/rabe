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
- [Testing](testing.md): unit, hook and UI tests, live checks with `scripts/live-check.sh`, and CI.

## Architecture

- [Architecture overview](architecture.md): module map and links to detailed behavior.
- [State and items](architecture/state.md): item model, registry, state writes, and turns.
- [Sources](architecture/sources.md): source contract, source modules, and source tests.
- [Price estimate](architecture/prices.md): price lookup and cost estimates.
- [UI rendering](architecture/ui.md): view contract, renderer, palette, cells, sizing, and band.
- [Pane interaction state](architecture/interaction.md): pure transitions for focus, held order, regain, opening and arming.
- [Focus and keys](architecture/focus-and-keys.md): pane behavior, key controls, and focus moves.
- [Focus order and arming](architecture/focus-order.md): held order, append-only slots, target-bound keys, and arming.
- [View behavior](architecture/views.md): tabs, cron schedules, workflow agent counts, inert stop controls, removed items, session summaries, full command and prompt details, and copy controls.

## Feasibility

- [Feasibility overview](feasibility.md): overview and links to the source limits.
- [Claude agents and workflows](feasibility/agents.md): agent, worktree, and workflow data with script path limits.
- [Codex and background work](feasibility/background-work.md): Codex jobs, shells, monitors, cron jobs and task output path limits.
- [User interface limits](feasibility/ui.md): API limits for rendering and input.
- [Price data](feasibility/prices.md): price inputs and view data.
- [Files and runtime limits](feasibility/files.md): script edits from Bash diffs, confirmed shell writes, coverage settings, and open runtime questions.
