---
title: Shared poll loop
description: Scheduling rules, poll changes, repeated session starts, and publication of one completed pass.
tags: [architecture, sources, state]
keywords: [poll, loop, scheduler, backoff, delayOf, nextStep, collect, Pollers, session.start, every]
---

# Shared poll loop

`register.tsx` owns the timer and state writes. `loop.ts` holds scheduling rules and collects changes without using `$`.

`delayOf` selects two seconds while work runs or items change. After five quiet passes it selects ten seconds. `nextStep` selects a poll, redraw or skip. A running item wakes an idle loop on the next timer tick.

Each poll receives staged items and returns `Change | undefined`. The loop composes these changes in source order. Later polls see the ended-item cap applied. A failed poll leaves the other polls running. Each poll can set an `every` gap or opt out of the initial pass. Agents use a three-second minimum gap; worktrees use a ten-second gap. Codex, shells and monitors skip the initial pass.

The loop collects the final list and its changes. Its local `write` and `forget` helpers use the registry's pure `commit` and `prune` rules. When the state version matches, the write compares the collected list with the original snapshot. Each source reuses its staged result for its own start list, so collection does not replay its changes. This avoids replaying a large agent list or writing unchanged items. If an event changed state, the write replays poll changes against the latest items. A version conflict retries the write. Dropped items lose their lines and turns.

Each named poll also leaves a record of its last run (duration, files and bytes read, failures) in `rabe.diag`; see [Diagnostics](diagnostics.md).

A repeated session start cancels the old timer. The loop clears the poll list before sources bind new callbacks. Each pass uses a snapshot of that list. A generation check prevents an old pass from publishing items after another start.

See [sources](sources.md) for source hooks and [UI rendering](ui.md) for the shared redraw request. `hooks/loop.test.ts` tests scheduling and failed polls. `hooks/register.test.ts` tests repeated starts, publication and event writes during a poll.
