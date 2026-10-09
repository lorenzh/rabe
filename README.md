<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="rabe" width="308" height="84">
</picture>

# rabe

**See what Claude Code runs in the background.**

Rabe (German for raven) is a Claude Code mod. It shows your subagents, Codex jobs, background shells, monitors, cron jobs and workflows in one place. A short band above the prompt shows what runs now. The `/rabe` command opens a pane with the full detail.

![Rabe in a Claude Code session: the band above the prompt lists two agents, three shells (one of them started by an agent), a monitor, a cron job and the cost; /rabe opens the pane, the arrow keys move through the list and the detail beside it follows, a click on the agent's shell opens it, then the Cost and Timeline tabs show, and Esc closes the pane](docs/assets/demo.gif)

Status: early development. Version 0.1.0.

## What Rabe shows

| Kind | In the band | In the pane |
|---|---|---|
| Claude subagents | Name and run time | Tokens, share of the session, the prompt it got, each turn with its tool calls |
| Workflows | Current phase and agent count | Phases in order, the agents of each phase in start order with tokens and time; select an agent to open it |
| Codex jobs (from the Codex plugin) | Name and run time | Model, effort and sandbox, tokens, the prompt, each message and command with its exit code |
| Background shells | Command and the port it serves | Output lines, exit code, the guessed port |
| Monitors | Name | Each line with the time Rabe received it |
| Cron jobs and `/loop` wakeups | Prompt and countdown to the next run | The next five runs |
| Cost | Session cost and tokens of the background work | Cost tab: tokens per worker, workers that look stuck |

The band puts failures from the last 10 minutes first. Shells and monitors that an agent started come after the others, with the name of that agent. When nothing runs, it draws nothing. When its rows do not fit, it draws one line of counts.

The pane has four tabs:

- **Items**: all items grouped by kind, with a search field. Shells and monitors that an agent started show under the name of that agent. If the pane is 90 columns or wider, the selected item shows beside the list.
- **Cost**: the session cost as `/cost` totals it, and a bar of tokens per agent and Codex job. Agents that look slow or stuck show under "Load".
- **Effects**: files that agents edited, a warning when two agents edit the same file, worktrees, and open ports with the `ssh -L` command to reach them. Enter or a click on a file opens the agent that edited it last; on an `ssh -L` line it copies the line (`c` copies the first).
- **Timeline**: a bar per item over the session, who started what, and a summary of the previous session in this project.

## Install

Type this at a Claude Code prompt:

```
/plugin install rabe --marketplace lorenzh/rabe
```

## Usage

The band shows by itself while background work runs. Type `/rabe` to open the pane. In the terminal the pane docks beside the transcript. Drag its left edge to make it wider.

| Key | What it does |
|---|---|
| ↑ / ↓ | Move to the previous / next row; the detail beside the list follows |
| Enter or a click | Open the row that has the focus, or the row you click |
| Tab / Shift+Tab | Move the focus through rows, tabs and buttons |
| `b` | Go back to the list |
| `1` to `4` | Switch tab |
| `s` | Search |
| `x` | Stop the selected item |
| `g` | Stop the group the selected row is in (the rows the search shows), or the workflow run of the selected run or workflow agent |
| `m` | Send a message to an agent |
| `c` | Copy the command, the prompt or the `ssh -L` line |
| `d` | Delete a cron job |
| Mouse wheel | Scroll the pane |
| Esc | Close the pane |

The buttons under the pane show the keys that work on the current tab. A letter with no button goes to the prompt.

With the mouse, click a row to open it, a tab to switch to it, or a group name to fold the group. The wheel scrolls the pane. The mouse works only in Claude Code's fullscreen layout: type `/tui fullscreen` to turn it on. Without it, use the keys.

The rows keep their order while the pane is open, so the row under the focus does not move. Items that start after you open it go to a NEW group at the end, and on the Effects tab a port whose shell ends keeps its row, marked `ended`. Only a file an agent edits for the first time still adds a row above the ports. Type `/rabe` again to sort the lists.

Commands:

- `/rabe`: open the pane.
- `/rabe-stop codex:<job id>`: cancel a running Codex job. `x` in the pane does the same.
- `/rabe:report-bug`: write a bug report for this repository.
- `/rabe:feedback`: write an idea or a comment for this repository.

The two report commands show you a draft first. They create a public GitHub issue only after you say yes. Without the `gh` CLI they give you a link to open instead.

Rabe hides Claude Code's own count of background work, because the band shows it. That is the `2 shells, 1 monitor · ↓ to manage` part under the prompt, and `still running` at the end of a turn. To keep them, turn off the option `hideBuiltinTasks` in `/plugin`. Rabe cannot hide the agent list under the prompt.

## Where the data comes from

Rabe gets most data from the mod API: hooks for tool calls, agent starts, agent steps and task notifications. The rest comes from files that Claude Code and Codex write while they work. These files have no documentation and can change in any release. A value that Rabe cannot read shows as `n/a`.

Rabe cannot see some things:

- Dollars per agent or per Codex job. No source gives them, and Rabe has no price table yet.
- Work that started before Rabe loaded shows only what the agent list, `CronList` and the files tell.
- The port of a shell is a guess from its output.
- Codex jobs started outside the Codex plugin, and Codex sessions that Codex already deleted.
- Retries inside a workflow. Rabe can stop a whole workflow run, but not one agent of it.

[What Rabe can see](docs/feasibility.md) lists each source and each limit.

## Privacy

Rabe runs on your computer only. It makes no network requests and sends nothing. The two report commands create an issue only after you approve the draft.

Rabe reads these files:

- The meta files of subagents, next to the session transcript in `~/.claude/projects/`.
- The script of a workflow run, for its phase names.
- The output files of background shells and monitors, under `/tmp/claude-<uid>/`.
- The Codex plugin's job files under `~/.claude/plugins/data/codex-openai-codex/`, and `~/.claude/plugins/installed_plugins.json`.
- Codex session files under `~/.codex/sessions/` (or `CODEX_HOME`).

Rabe keeps its items in the session state of Claude Code. When a session ends, Rabe keeps a short summary for the next session in the same project. The summary holds counts per kind, tokens, cost and the names of failed items. It runs `tail` and `grep` to read files over 4 MiB. When you stop a Codex job, it runs the Codex plugin's own cancel script.

## Requirements

- Claude Code 2.1.295. We build and test Rabe with this version. Other versions can show `n/a` where a file changed.
- A terminal for the colored band and pane. The Claude desktop app shows the same content as text and buttons.
- Optional: the Codex plugin (`codex@openai-codex`) for Codex jobs, and the `gh` CLI for the report commands.

## Development

Install the tools with [Bun](https://bun.sh) 1.4. Then start Claude Code with the mod from this folder. When you save a file, the mod reloads.

```sh
bun install
claude --plugin-dir .
```

Run all checks (lint, type check, manifest check and tests), as CI does:

```sh
bun run check
```

[AGENTS.md](AGENTS.md) has the rules for contributors and coding agents. [How Rabe is built](docs/architecture.md) describes the code.

## Feedback and bugs

In Claude Code, `/rabe:report-bug` and `/rabe:feedback` draft an issue for this repo. You check the draft before anything is sent. They use the `gh` CLI when you are logged in, and otherwise give you a link to a prefilled issue. You can also [open an issue](https://github.com/lorenzh/rabe/issues/new/choose) directly.

## License

[MIT](LICENSE)
