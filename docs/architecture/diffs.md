---
title: File diffs
description: How Rabe records bounded diffs of file operations at record time, caps them, evicts them and keeps them private.
tags: [architecture, diffs, effects, privacy]
keywords: [diffs, diffs.ts, rabe.diffs, RabeDiff, keep, forget, prune, isEvicted, isTruncated, MAX_DIFF_LINES, MAX_DIFF_UNITS, MAX_TOTAL_UNITS, structuredPatch, unified_diff, record time, eviction, privacy]
---

# File diffs

The Effects tab shows the diff of the selected file. `hooks/diffs.ts` is the pure module that builds these diffs and `$.state` holds them under `rabe.diffs`, a record by editor id (an item id, or `main`), oldest first.

## Capture at record time

Views read session state only, never files, and a file can change or vanish after an edit. The sources therefore take a diff when the operation is recorded, from data the operation already carries: the `structuredPatch` of an Edit or Write result, the hunks of a Bash edit, the `unified_diff` of a Codex file change, or the `content` of an added file. No source reads a file or runs a process for a diff. A change that carries no usable data gets no diff, and the view says `diff n/a`.

## Caps

- A diff holds at most 200 lines and 8192 code units; a cut diff has `isTruncated`.
- An editor keeps its newest 100 diffs, the same limit as its edits.
- All diffs together hold at most 262144 code units. Over that, `keep` empties the oldest diffs first and marks each `isEvicted`; the entry and the edit metadata stay.

## Eviction with items

When an item leaves the list, the cap of ended items or a removal, each source's `forget` prunes `rabe.lines`, `rabe.turns` and `rabe.diffs` for the dropped ids. The three keys are pruned independently: an item without turns still loses its diffs. An id that is back in the list keeps its entries (`prune`). A late Edit result of an agent that is no longer in the list records no diff. A recorder that wrote its diff while an eviction ran calls `forget` for its editor after the write, so cleanup that finished first cannot leave an orphan diff; the same holds for a Codex job. A Codex job not yet in the list is staged by the same poll, so its first diffs skip the membership check and its cleanup; the commit drops them again if the cap pushes the job out.

## Privacy

A diff holds file content, so it stays in session state. It is not written to disk, a log, the clipboard or a toast by the diff module. The same security rules as for other file content apply: the text is data, drawn as plain text, never run (see [`docs/security.md`](../security.md)).
