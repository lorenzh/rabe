---
title: Touched files
description: The pure helpers extracted from lists.ts and their boundary with the mod API.
tags: [architecture, modules]
keywords: [effects, touched, touched.ts, lists.ts, refactor, modules]
---

# Touched files

`hooks/ui/touched.ts` contains pure helpers: file edits, conflicts and worktree rows.
The split keeps parsing and data changes separate from mod API calls.
It changes no behaviour. Only helpers imported by existing tests keep re-exports at the old path.
Production callers import the pure module directly.

`lists.ts` keeps item grouping and ordering. It imports the file helpers for the held Effects order.

See [UI rendering](ui.md) for behaviour and [the module map](../architecture.md) for sizes.

`Editor` and `TreeRow` stay private.
In `lists.ts`, `GROUPS`, `groupOf`, `isForwarder`, `nest`, `sortItems` and `nextRun` stay private.
The list types `PhaseState`, `Totals` and `TreeLine` stay private too.
