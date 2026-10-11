---
title: Rabe user guide
description: Options, price table format, troubleshooting, privacy and platform notes for Rabe users.
tags: [user-guide, options, troubleshooting]
keywords: [user guide, options, configuration, troubleshooting, faq, privacy, platform, pricesfile, timelinehours, hidebuiltintasks]
---

# Rabe user guide

Use this guide to configure Rabe and solve common problems. For the details of what Rabe can read, see [What Rabe can see](feasibility.md).

## Options

Set these options in the `/plugin` menu. Rabe's plugin manifest defines their defaults and descriptions.

| Option | Default | What it does | Example |
|---|---:|---|---|
| `hideBuiltinTasks` | `true` | Hides Claude Code's shell and monitor count and “↓ to manage” in the prompt hint, and “still running” at the end of a turn. Rabe's band shows the shell and monitor counts. It cannot hide the agent list under the prompt. | Set to `false` to keep Claude Code's counts. |
| `pricesFile` | empty | Reads your CSV price table before Rabe's built-in table. An empty value uses only Rabe's table. | Set to `~/prices.csv` or an absolute path such as `/home/me/prices.csv`. |
| `timelineHours` | `4` | When `/rabe` opens, this sets the Timeline window. Older finished items fold into one line. Set to `0` to show the whole session. | Set to `12` to open on the last 12 hours. |

### Price table format

Set `pricesFile` to a readable CSV file. Use the same columns as `data/prices.csv`. Each price row needs `provider`, `model`, `input` and `output`. Rates are USD per million tokens. Use `claude` for Claude models and `openai` for Codex models.

Other columns are optional. `aliases` holds names separated by semicolons. Claude cache rates use `cache_read`, `cache_write_5m` and `cache_write_1h`. OpenAI cache rates use `cache_read`, `cache_write` and `cache_write_minutes`. Long-context rates use `long_context_tokens`, `long_scope` and the matching `long_*` rate columns. Empty cache rates use the input rate. See the comments and header in [`data/prices.csv`](../data/prices.csv) for the complete format.

```csv
provider,model,aliases,input,output,cache_read,cache_write_5m
claude,claude-opus-5-5,,4,20,0.2,5
```

Rabe searches your rows first. A row that matches a built-in model by ID or alias replaces that built-in row. If Rabe cannot read the file, every estimate shows `n/a`. Rabe does not fall back to built-in prices.

## Troubleshooting

### Rabe does not show

The band appears only while background work runs. Type `/rabe` to open the pane at any time. If neither appears, check that Rabe is installed, that Claude Code is version 2.1.296, and that you reloaded the plugin after installing or updating it. Run `/reload-plugins` or start a new session; Claude Code does not load plugin changes into the current session before then.

### The pane changes layout at narrow terminal widths

Claude Code docks the pane beside the transcript or places it inline, depending on terminal width. Around 110 terminal columns, resizing can move it between those layouts. The detail appears beside the list when the pane has at least 90 body columns. At smaller widths, select a row and press Enter to open its detail. In a docked terminal pane, drag its left edge to make it wider.

### Values show `n/a`

`n/a` means Rabe could not get that value from the available API or files. Missing fields, unreadable files, unsupported model names and work that started before Rabe loaded can cause it. See [What Rabe can see](feasibility.md) for each data source and its limits.

### The cost estimate looks wrong

Rabe estimates worker costs from token counts and its price table. The session total comes from Claude Code's `/cost` data. Check that the model has a matching row and that its rates match your billing plan. Use `pricesFile` for custom rates. Rabe's table uses standard global API list prices. It does not cover plan billing, Bedrock, Vertex, batch, fast or regional rates. If Rabe cannot read a configured price file, every estimate shows `n/a`.

### Keys go to the prompt

Rabe can catch only lowercase letters bound to controls in the current view. A control's letter goes to the prompt on views without that control. The focused search or message field takes all keys. Clicks need Claude Code's fullscreen layout. Type `/tui fullscreen` to enable it. If the pane lost keyboard focus, press `ctrl+x tab`. Then move to a row with Tab or an arrow key.

## FAQ

### What can Rabe not see?

Rabe cannot get every value from Claude Code or Codex. It estimates worker costs and guesses shell ports from output. Rabe cannot recover all work that started before it loaded. The [feasibility guide](feasibility.md) lists sources and limits.

### What does Rabe read, and does it send data anywhere?

Rabe reads subagent metadata and workflow scripts for phase names. It reads shell and monitor output files. It also reads Codex job and session files and the installed-plugin list. Rabe reads its built-in price table and your optional table. It checks the size and modification time of possible shell write targets. It does not read their contents. Rabe makes no network requests. After you stop, delete or message an item, the next prompt to Claude carries a short note naming it by kind and id. The `/rabe:report-bug` and `/rabe:feedback` commands can create a public GitHub issue only after you approve the draft.

### Which platforms does Rabe support?

Rabe is built and tested with Claude Code 2.1.296. Use the terminal UI in a terminal session. The maintainer checked the Claude desktop app on Windows with Rabe 0.1.0. In that check, the app drew a plain-text pane with buttons. Other platform combinations are not documented as tested.

### How do I update Rabe?

Run `claude plugin update rabe`, then `/reload-plugins`. You can also start a new session instead of reloading.
