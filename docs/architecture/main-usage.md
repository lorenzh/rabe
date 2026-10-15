---
title: Main-session usage
description: How hooks/main-usage.ts sums the main session's steps per model for the partial Cost rows.
tags: [architecture, cost, modules]
keywords: [main-usage, addMain, mainUsage, RabeMainUsage, partial, cache write, turn.step]
---

# Main-session usage

`addMain` in `hooks/main-usage.ts` is a pure function. The `turn.step` hook of a step without an `agentId` calls it and stores the result in `rabe.mainUsage` (see [Sources](sources.md)).

- The sum is per model: steps, input tokens (input, cache write and cache read), output tokens, cached tokens and dollars.
- The price uses the 1-hour cache-write rate (see [Price estimate](prices.md)).
- One step without a price sets `isUnpriced` for that model for good, and its dollars stay `n/a`.
- Only steps seen since Rabe loaded count, so the Cost tab labels these rows `(partial)`.

The function reads no file and takes no `$`.
