---
title: Touched files
description: The pure helpers extracted from lists.ts and their boundary with the mod API.
tags: [architecture, modules]
keywords: [effects, touched, touched.ts, lists.ts, refactor, modules, diffs, diffs.ts, rabe.diffs, RabeDiff, structuredPatch, unified_diff, bashEditDiff, SPLIT_COLUMNS]
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

## Diffs of the selected file

The Effects tab shows what the selected file's latest recorded operation changed (issue #162). Rabe records the diff when the operation happens and never reads the file or runs `git diff` (see [security](../security.md)).

`hooks/diffs.ts` is pure. It turns an Edit or Write `structuredPatch`, a `bashEditDiff` file's hunks, a Codex `unified_diff` and the `content` of an added file into one `RabeDiff` (`lines` with `@@` headers and `+`, `-` or space markers, `added`, `removed`, `hunks`). A diff holds at most 200 lines and 8192 code units and says so with `isTruncated`. `keep` adds diffs to the `$.state` key `rabe.diffs`, a record by editor id (an item id, or `main`), skips an operation recorded twice, keeps the newest 100 per editor and, over 262144 code units in all, empties the oldest diffs first and marks them `isEvicted`. The edit metadata in `RabeEdit` stays. The key is pruned with `forget` when items are removed, as `lines` and `turns` are.

The agents source records Edit and Write results and Bash diffs; the Codex source records the diffs of each rollout parse (they are not kept in the rollout cursor). A change matches a file by editor, path and the time of the edit: if the latest edit has no diff with that time, the view says `diff n/a: content not recorded` and never shows an older operation. A Write with an empty patch and no original is `diff n/a: file too large`; a delete is `deleted`.

`effects.ts` draws the diff beside the list at `SPLIT_COLUMNS` (90) columns or more, as plain text from the first row the pane shows, so the focus order has no new Button. Below that it draws one summary line at the end of the view and Enter opens the editor as before. Tabs expand to four spaces and every line goes through `fitLine`, so long lines end in an ellipsis.
