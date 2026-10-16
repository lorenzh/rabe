---
title: Cost estimate
description: How Rabe estimates costs from model prices and usage.
tags: [architecture, cost, prices]
keywords: [prices.csv, pricesFile, cost estimate, tokens]
---

# Cost estimate

## The cost estimate

`hooks/prices.ts` is pure. `parsePrices(text)` reads a table in the format of `data/prices.csv` (see [feasibility](../feasibility.md)): it skips `#` lines, takes the next line as the header and keeps a row only when every rate is a number of 0 or more and `input` and `output` are set. `withOverride(base, own)` puts the user's rows first; a user's row that shares a name (ID or alias) with a built-in row of its provider replaces it and takes its names, so an override reaches every alias, except a name another user row of that provider names itself, which keeps that row's price; `findPrice(prices, provider, model)` takes the first row whose `model` or one of whose `aliases` is the ID. `claudeUsd(prices, usage, model)` prices one Claude response and `codexUsd(prices, requests)` a Codex job, the sum of its requests. Both share one rule per request: a prompt over `long_context_tokens` takes the `long_*` rates for every token when `long_scope` is `request`; a `session` scope, a missing rate or an unknown model gives `undefined`, never a guess. An empty cache column bills at the input price.

The agents and Codex sources each load the table with their own top-level `prices($, file)` (the scanner never follows `$` across an import): the built-in file under `$.plugin.root`, then the user's file first when `pricesFile` is set; a user's file that cannot be read gives an empty table, so every cost is `n/a`. The table is read when a price is needed, not kept: a module value would be one more thing a reload resets, and the read is small.

An agent's cost is the sum of its steps (`addCost` in `hooks/sources/agent-items.ts`): the first step sets it, each later one adds to it, and one step without a price, an agent without `startedAt` (Rabe did not see it start) or tokens without a cost (counted before the cost, an item from 0.3.0 after a reload) leave it absent for good.

The views read `costUsd` only. `spend` in `lists.ts` sums tokens and dollars of a list of workers and `spendBy` does so per key; `totals` uses them for the Claude agents and the Codex jobs apart (`isWorker`, `harnessOf`); a worker without a cost, with or without tokens, makes its side and the whole sum `undefined`, since a smaller sum would read as the cost. Workers without tokens also count under the head's `n/a`. The detail's cost panel (`costBox`) calls the same `spend` for an item or the agents of a workflow. Costs are drawn `≈ $0.16` (`cost` in `lists.ts`).
