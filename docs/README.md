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
- [Security guidelines](security.md): threat model and security rules for changes and review.
- [Testing](testing.md): unit, hook and UI tests, live checks with `scripts/live-check.sh`, and CI.

## Architecture

- [Architecture overview](architecture.md): module map and links to detailed behavior.
- [State and items](architecture/state.md): item model, registry, state writes, and turns.
- [Sources](architecture/sources.md): source contract, source modules, and source tests.
- [Price estimate](architecture/prices.md): price lookup and cost estimates.
- [UI rendering](architecture/ui.md): view contract, renderer, palette, cells, sizing, and band.
- [Focus and keys](architecture/focus-and-keys.md): pane behavior, key controls, and focus moves.
- [Focus order and arming](architecture/focus-order.md): held order, append-only slots, target-bound keys, and arming.
- [View behavior](architecture/views.md): tabs, details, removed items, and session summaries.

## Feasibility

- [Feasibility overview](feasibility.md): overview and links to the source limits.
- [Claude agents and workflows](feasibility/agents.md): agent, worktree, and workflow data.
- [Codex and background work](feasibility/background-work.md): Codex jobs, shells, monitors, and cron jobs.
- [User interface limits](feasibility/ui.md): API limits for rendering and input.
- [Price data](feasibility/prices.md): price inputs and view data.
- [Files and runtime limits](feasibility/files.md): observed file writes and open runtime questions.
