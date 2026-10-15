---
title: Cost groupings
description: How hooks/ui/groups.ts builds the model and harness rows of the Cost tab, including partial totals.
tags: [architecture, ui, cost, modules]
keywords: [groups, groupRows, GroupRow, grouping, model, harness, partial, n/a, held order]
---

# Cost groupings

`hooks/ui/groups.ts` is pure. `groupRows(by, items, main)` turns the items into the rows of the `model` and `harness` groupings of the Cost tab. [View behavior](views.md) describes the tab and its buttons.

- Each worker counts once. A forwarder's spend is in its Codex job's row (`withForwarder`).
- Tokens are `-1`, drawn `n/a`, when no worker of the row has a known count.
- When only some workers have one, the total leaves the others out and the row is `isPartial`. The view adds the word `(partial)` to the row's name, not only a colour. The main session's rows are always `isPartial`.
- Worker and main-session model rows name a model by the same short id (`claude-` dropped), so `sonnet-5-5` and `main session · sonnet-5-5` read apart. In a pane under 44 columns the grouping rows use narrower number columns and the last header reads `COUNT`; in a wider one it reads `WORKERS`, with a space after `COST`. The name column shrinks to as little as 5 cells so the numbers stay whole in the narrowest pane (26 columns).
- The same narrow rule holds for the agent grouping and the head: under 44 columns the worker rows use the narrower number columns; under 60 a worker row whose name does not fit stacks (name, then the numbers on a joined line). The totals head wraps whole parts (session, claude, codex, tokens, running, n/a) onto more lines when they do not fit, and the sort line, the no-token note and the footer wrap at spaces, so nothing is cut at a 26-column pane.
- Where a name and its marker do not fit the name column, the row stacks: the name on one line, the bar and numbers on a second line (`joins`), so no value is dropped and the pane scrolls both lines into view together. A stacked name drops `claude-` and shortens `main session · ` to `main · `, so a partial worker group and the main session's row of one model still read apart. A name still too long for the line loses its middle (`…`), so `(partial)` and the end that tells two models apart stay.
- Dollars are `n/a` when one worker has none.
- The main session has its own rows (per model, or one for the harness). They come from `hooks/main-usage.ts` (see [Main-session usage](main-usage.md)) and are always partial.
- `heldRows` and `orderIds` keep the order of the open pane through `stable`. The grouping is part of the pane's scope (`scopeOf`), so a change of grouping starts a new hold.
