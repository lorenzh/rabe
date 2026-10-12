---
title: Pane data
description: The pure helpers extracted from pane.tsx and their boundary with the mod API.
tags: [architecture, modules]
keywords: [pane-data, pane-data.ts, pane.tsx, refactor, modules]
---

# Pane data

`hooks/ui/pane-data.ts` contains pure helpers: text filtering and validation of stored session summaries.
`clipText` and `toastText` form a security boundary before clipboard and toast API calls.
Stored-summary validation removes legacy failed titles before the pane writes them back.
It changes no behaviour.

`pane.tsx` keeps actions, focus and store calls. The imported helpers receive data only.

See [UI rendering](ui.md) for behaviour and [the module map](../architecture.md) for sizes.
