---
title: Price data
description: How Rabe reads price data and supplies it to views.
tags: [feasibility, prices]
keywords: [prices.csv, pricesFile, views, price table, cache write, long context, aliases, session.usage, cost.usd, costUsd, last_token_usage, cache_write_input_tokens, ephemeral_5m_input_tokens, ephemeral_1h_input_tokens]
---

# Price data

## Prices

`data/prices.csv` holds the list prices in USD per million tokens for Claude and OpenAI models. The sources read it at run time: `$.fs.read` of `data/prices.csv` under `$.plugin.root`, the plugin's own folder (d.ts `plugin.root`); the d.ts names it as the place for files a plugin ships, so nothing is embedded at build time. It is read again for each priced step and each Codex session file parsed, so an edit to the user's file counts from the next step. The test kit has no files of its own: tests answer the read with a test hook.

The user's own table is the `userConfig` option `pricesFile` (type `file`), a path to a CSV in the same format; `~/` takes `HOME` from `$.env`. Its rows are searched first. A user's row that names a model of Rabe's table by ID or alias replaces that row and takes its other names, so an override of `claude-opus-4-5-20251101` also prices the alias `claude-opus-4-5` (and the other way round), and Rabe's rate is never found under the other name. A file that is set but cannot be read gives no prices at all: Rabe does not fall back to its own rates when the user said they differ.

How Rabe prices (`hooks/prices.ts`):

- A row needs `provider`, `model`, `input` and `output`, each rate a number of 0 or more, and `long_scope` empty, `request` or `session`; any other row is left out, so its model shows `n/a`.
- A model is found by its exact ID or an alias, within its provider (`claude` for agents, `openai` for Codex jobs).
- Claude, per response: `input_tokens` at `input`, cache reads at `cache_read`, cache writes at `cache_write_5m` (an agent) or at `cache_write_1h` (the main session; the main loop's entries live 1 hour), output at `output`.
- Codex, per request: `input_tokens − cached_input_tokens − cache_write_input_tokens` at `input`, cached at `cache_read`, writes at `cache_write`, output at `output`. That writes are part of `input_tokens`, as cached input is, follows the OpenAI usage format (the details break the input down) and is not yet seen in a file; a request whose counts do not add up has no price.
- Long tier: a request whose prompt (uncached, reads and writes) is over `long_context_tokens` takes the `long_*` rates for all its tokens when `long_scope` is `request`. For `session` OpenAI does not say which requests the higher rates cover, so the job's estimate is `n/a`. A missing long input or output rate is `n/a` too.
- A job or an agent is the sum of its requests. One request without a price makes the sum `n/a` for good. An agent Rabe did not see start (its `startedAt` is absent), or one whose tokens were counted before its cost (an item from Rabe 0.3.0 after a reload), stays `n/a`. A Codex session file over 4 MiB is read as head and tail only, so its job is `n/a`. A session file that is gone (by the job's end or while it runs) or cannot be read makes the job `n/a` too, not the last cost Rabe saw: the job may have spent more since.
- A total (Claude, Codex, the sum, a workflow's panel) is `n/a` when any of its workers has no estimate, with or without tokens: a worker without token data (an agent that ended before its first step reached Rabe, a job without its session file) spent an unknown amount.

- Source: the Claude pricing page (https://platform.claude.com/docs/en/about-claude/pricing), the OpenAI pricing page (https://developers.openai.com/api/docs/pricing), the OpenAI prompt caching guide and model pages. Checked on 2026-10-09.
- Scope: standard global API list prices. Codex plan billing differs (the Enterprise token rate card charges no cache writes and exempts `gpt-6-astra` from the long-context rates), and so do fast, priority, batch, flex and regional rates and Bedrock or Vertex.
- Format: lines that start with `#` are comments, and the next line is the CSV header. A reader must skip the comment lines; ordinary CSV readers do not. Empty cells keep their commas.
- `model` is the ID that Claude Code or Codex reports (for example `claude-opus-5-5`, `claude-haiku-4-5-20251001`, `gpt-6.1-sol`). `aliases` lists other names for the same row, separated by `;` (for example `gpt-5.6` for `gpt-5.6-sol`).
- Cache writes: Claude rows fill `cache_write_5m` and `cache_write_1h`. OpenAI rows fill `cache_write` and `cache_write_minutes` (30 for GPT-5.6 and later); older OpenAI models have no cache-write charge. An empty `cache_read` or `cache_write` bills at the input price.
- Long tier: above `long_context_tokens` of total prompt input, cached input included, the `long_*` rates apply to the whole request. `long_scope` is `request` or `session`; OpenAI says "the full session" for GPT-5.4 and GPT-5.5. The GPT-5.5 Pro long tier is on the pricing page only, not on its model page.


## Where the views get their data

The views read no files. The sources keep what the views show in session state:

| Data | Where the views read it | Written by |
|---|---|---|
| Agent turns and full answer text | `rabe.turns` | `turn.step` with `agentId` (agents source); agents that ran before Rabe loaded have no turns |
| Codex steps, prompt, model | the item's `detail` (`steps`, `prompt`, `model`, `effort`) | the Codex source, from the Codex session file |
| Shell and monitor output | `rabe.lines` | the shells and monitors sources, from the task output file |
| Git worktrees | `rabe.worktrees` (`Model.worktrees`) | the worktrees source, from `git worktree list --porcelain` |
| Files changed | the `detail.edits` of agent and Codex items and `rabe.edits` for the main session: `{ path, at, via, change }` per change (`via` `edit`, `write`, `shell` or `codex`) | agents source (`Edit`, `Write`, Bash), Codex source (rollout); no line counts |
| Cost estimate per worker | `costUsd` of agent and Codex items (absent: `n/a`) | agents source (each `turn.step`), Codex source (each parse of the session file), with `data/prices.csv` and the option `pricesFile` |
| Session cost | `Model.usd`, from `$.session.usage().cost.usd` (d.ts:11635), the dollars `/cost` totals | `pane.tsx` and `band.tsx` on each draw; absent where the host keeps no ledger |
| Previous session | `Model.previous`, from `$.store` key `previous:<cwd>` | `pane.tsx` on `session.end`, from the items, `$.session.usage()` and `e.resume.id`, what `claude --resume` takes (`SessionResume`; it resumes a session that wrote a transcript) |
| This session's id | `Model.sessionId`, from `$.session.id()` (the transcript file's name, which `claude --resume` takes) | `pane.tsx` on each draw |

A file the source cannot read leaves the value as it was, and the view shows `n/a`.
