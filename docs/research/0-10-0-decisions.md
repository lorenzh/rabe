---
title: Rabe 0.10.0 design decisions
description: "Research report and recommendations for issues #199 (main-session tokens per model in the Cost tab), #218 (dropped message submit after a redraw) and #162 (diff in the Effects tab)."
tags: [research, decisions, cost, message-field, diff, data-sources]
keywords: [0.10.0, "#199", "#218", "#162", Cost tab, grouping, tokens per model, turn.step, main session, ledger, cost-state, message field, Enter, submit, redraw, ui.input, toast, Effects tab, diff, structuredPatch, bashEditDiff, unified_diff, Codex rollout, caps, Privacy, hotkeys, research report, two-model research]
---

# Rabe 0.10.0 design decisions

Research report for [#199](https://github.com/lorenzh/rabe/issues/199), [#218](https://github.com/lorenzh/rabe/issues/218) and [#162](https://github.com/lorenzh/rabe/issues/162). It records findings, the disagreements between researchers and how each was checked, and the recommendation. Related: [Files and runtime limits](../feasibility/files.md), [Price data](../feasibility/prices.md), [Focus and keys](../architecture/focus-and-keys.md) and [Security guidelines](../security.md).

## Question
Three open design decisions for Rabe 0.10.0, under the repo rules (no new dependency, views read session state only, no file reads of shell-named paths, `$.process.run` takes argument arrays, docs/security.md):

1. #199: where the main session's tokens per model come from for the Cost tab grouping.
2. #218: what to do with an Enter in the agent message field when a redraw freed its handler.
3. #162: the data source, layout, cap and no-content rows for a diff in the Effects tab.

## Findings
- `turn.step` on the main thread has no `agentId` and carries `usage` with the answering `model`; Rabe's agents hook ignores main steps today (`hooks/sources/agents.ts:456`, `types/claude-code.d.ts:13464-13538`). (A, B)
- The band dollars are `$.session.usage().cost.usd`, which has no tokens and no model (`hooks/ui/lists.ts:416-425`, `types/claude-code.d.ts:10988`). (A, B)
- Agent items keep aggregate tokens and the last step's model only; per-model `requests` exist only for Codex (`hooks/sources/agent-items.ts:255`, `types/index.d.ts:202`). The issue's data note is stale. (A, B)
- Today only agent steps are priced, with cache writes at the 5-minute rate (`claudeUsd`, `hooks/prices.ts:144`; `hooks/sources/agents.ts:377`); main steps are excluded (`hooks/sources/agents.ts:456-458`) and main dollars come from the host ledger. Main-step pricing is a proposal: A's own transcripts over 14 days (one account) showed 1-hour writes, which is not a universal rate. (A; B names the 5-minute assumption, not the measurement)
- Free hotkeys: `e h i j l n o p q t u v y z`; used: `a b c d f g k m r s w x` and digits 1-4 (`docs/architecture/focus-and-keys.md:43-57`). (A, B)
- #218: the catch only recovers `search`; message submits are dropped when the closure never ran (`hooks/ui/pane.tsx:791-805`). `ui.input` carries `element`, `kind` and the whole `value`. `$.session.send` has no idempotency key (`types/claude-code.d.ts:11545`). A plugin cannot replay a press. (A, B)
- #162: Edit and Write results carry `structuredPatch`; shell rows carry hunks only when the host sends `bashEditDiff` (`types/claude-code-tools.d.ts:4441,4548,5450`). `git diff` and file reads answer a different question and conflict with `docs/security.md:57-58`. (A, B)
- Codex rollouts do carry diffs: in my sample of the 150 newest rollouts, 11 `update` changes with `unified_diff` and 4 `add` with `content`; Rabe reads only `type` and `move_path` (`hooks/sources/codex-data.ts:167`). (A; contradicts B)

## Disagreements
- A: the session ledger includes subagents, so main USD = ledger minus agent costs. B: unverified, so subtraction cannot define main-only cost. Checked: `grep -F '"type":"cost-state"' <main transcript>` on a 29 MB main transcript → `modelUsage` lists haiku-5-5, opus-5-5 and sonnet-5-5 with `totalCostUSD` 747; main assistant rows are 2622 opus and 132 sonnet, and the file has 0 sidechain rows. The haiku row suggests side calls are in the ledger, but this file cannot show whether subagents are. Not settled; an open question (see below), and `docs/feasibility/files.md:44` stays open.
- A: ship the main row now from `turn.step` (option d) with the ledger remainder shown. B: split #199, grouping first and main accounting later. Checked: both name the same data source (`turn.step`), so the difference is scope, not facts. The remainder row depends on the unsettled ledger question, so B's split is the safer first step.
- A: Codex rows carry content, so the diff covers them. B: shell and Codex rows have no content. Checked: rollout sample above → Codex changes carry `unified_diff` or `content`, A is right; shell rows without `bashEditDiff` remain content-free, B is right for those.
- Caps: A 200 lines / 16 KB per diff, 100 diffs (about 1.6 MB). B 200 lines / 8192 units per diff, 262144 units total (512 KiB). Checked: no measurement settles it; A's p99 table is from private transcripts and is not reproduced here. B's total is the stricter bound.
- Researcher B's answer says `Model: gpt-6.1-sol`; the `codex exec` header says `model: gpt-6-astra`. The runtime header is used as evidence.

## Options
| Decision | Option | Cost | Risk | Keeps constraints? |
|---|---|---|---|---|
| #199 | (a) read main transcript | L | 14 MiB file with prompts, 4 MiB `$.fs` limit, row duplication, widens README Privacy | Needs security review |
| #199 | (b) USD-only main row | S | cannot place USD per model | Yes |
| #199 | (c) grouping first, main row later | S then M | acceptance "totals equal band" unmet until part 2 | Yes |
| #199 | (d) `turn.step` main counters + ledger remainder | M | misses steps before load or resume; remainder includes side calls | Yes, if ledger scope is checked |
| #218 | apply message submit from the event | S | double send only if the closure also ran | Yes |
| #218 | retry on next drawing | M | no replay API, no idempotency key | Yes, no gain |
| #218 | toast only | S | person retypes; draft may be lost | Yes |
| #162 | keep bounded `structuredPatch` results in a separate state key | M | content in session state | Yes, with caps and privacy line |
| #162 | store old/new text in `RabeEdit` | M | bloats every commit | Yes |
| #162 | `git diff` on selection | M | wrong attribution, git config surface | No (`security.md`) |
| #162 | read files | S | wrong content | No |

## Recommendation
1. **#199: (c), built on A's data source.** Ship the agent/model/harness grouping now, with main steps recorded per model from `turn.step` in a new declared `$.state` key and main tokens priced at the 1-hour write rate. The band stays the ledger figure; grouped rows are a recorded-since-load estimate. Reconciling rows with the band is deferred until coverage (main USD n/a, historical steps missing) and ledger scope (a resumed session's band includes spend absent from every row) are verified, so the acceptance line "totals equal band" is not promised; Codex is shown on top. The owner chose to show the main-session dollar estimate flagged partial (PR #240) instead of n/a. Hotkeys `i` agent, `o` model, `h` harness. Main risk: steps before load or resume are missing, so label the row as partial.
2. **#218: apply the message submit from the event**, as search does, with an event-local slot and a guard so a submit whose closure ran is never sent twice. Add a fixed "Message not sent" toast on refusal and "Delivery unknown" on an exception after send; never resend automatically. Presses stay dropped. Main risk: the 2-in-6 drop rate comes from #213's search trace, not a measured message failure; run the counted live check.
3. **#162: keep bounded `structuredPatch`, `bashEditDiff` hunks and Codex `unified_diff`/`content` per operation in a separate state key**, not in `RabeEdit`. Caps: 200 lines and 8 KB per diff, 256 K units across diffs, oldest evicted first, truncation marked. Show the latest recorded operation with writer and time. Rows without content say "diff n/a: content not recorded". Layout: list beside the diff at 90 columns or more, otherwise one summary line and Enter as today. Add a README Privacy line and get the security review. Main risk: file content held in session state readable by other plugins.

## Open questions
- Does `$.session.usage().cost.usd` count subagent requests? (`docs/feasibility/files.md:44`.) Verify with one controlled subagent request and watch the ledger change, with the main session and other requests isolated; comparing with the same session's `cost-state` would not settle it, since both could exclude subagents.
- Does the `{ agentId: /^/ }` matcher fire when the field is absent? A test-kit test settles it; else match on `model`.
- Does the engine clear an Input's draft on a rejected submit?
- Does the 20,000-node bound (`types/claude-code.d.ts:1413`) apply to `ui.render` trees?
- Do Bash calls in `auto` mode deliver `bashEditDiff` hunks? (`docs/feasibility/files.md:38`.)
- #162: is the "latest recorded operation" enough, or is a net diff across writers wanted?

## Models
Researcher A: claude-opus-5-5, high (pinned agent `gp-opus-5-5-high`). Researcher B: gpt-6-astra, high (`codex exec` runtime header; its answer's own `Model:` line says gpt-6.1-sol). Synthesizer: claude-sonnet-5-5, with the checks listed under Disagreements.
