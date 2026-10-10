<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="rabe" width="308" height="84">
</picture>

# rabe

**See what Claude Code runs in the background.**

Rabe (German for raven) is a Claude Code mod. It shows your subagents, Codex jobs, background shells, monitors, cron jobs and workflows in one place. A short band above the prompt shows what runs now. The `/rabe` command opens a pane with the full detail.

![Rabe in a Claude Code session: the band above the prompt is one line of counts, two claude, three shells, one monitor and one cron, with the cost; /rabe opens the pane with the items grouped by kind, the arrow keys move through the list and the detail beside it follows with the agent's id and estimated cost, a click selects the shell an agent started, indented under that agent, and a second click opens it, b goes back, the Effects tab shows a file an agent wrote through the shell (via shell), one the main session wrote, the worktree and a port, the Cost tab shows the estimate in dollars per agent and the session id, the Timeline tab shows the bars, who started what and the previous session with its cost and background tokens on separate labelled lines, and Esc closes the pane](docs/assets/demo.gif)

Status: early development. See [releases](https://github.com/lorenzh/rabe/releases) and the [changelog](CHANGELOG.md) for the current version.

## What Rabe shows

| Kind | In the band | In the pane |
|---|---|---|
| Claude subagents | Count (`claude`) | Tokens, share of the session, the prompt it got, each turn with its tool calls, the agent id (`c` copies it) and the full path of its transcript |
| Workflows | Count (`workflow`) | Phases in order, the agents of each phase in start order with tokens and time; select an agent to open it |
| Codex jobs (from the Codex plugin) | Count (`codex`) | Model, effort and sandbox, tokens, the prompt, each message and command with its exit code, the thread id (`c` copies `codex resume <thread id>`) |
| Background shells | Count (`shell`) | Output lines, exit code, the guessed port |
| Monitors | Count (`monitor`) | Each line with the time Rabe received it |
| Cron jobs and `/loop` wakeups | Count (`cron`) | The next five runs |
| Cost | Session cost and tokens of the background work | Cost tab: tokens and an estimate in dollars (`≈ $0.16`) per worker, workers that look stuck |

The band is one line of counts, one chip per kind with failures from the last 10 minutes first, then the cost, under an empty row so the status line above does not touch it. When Claude Code gives the band only one row, the empty row goes. The names are in the pane. When nothing runs, it draws nothing.

The pane has four tabs:

- **Items**: all items grouped by kind, with a search field. Shells and monitors that an agent started show under the name of that agent. A Codex job shows under the agent that started it, also when it starts while the pane is open. The Codex plugin starts its jobs through a Claude agent that only passes the request on (`codex:codex-rescue`); that agent has no row of its own, and its tokens and cost count toward the job. Rabe links the two only when the evidence fits one job: the agent's command named the job, or the job started while the command ran and has its prompt or its thread. A link made by the prompt is checked again when the command returns: if it names another job or thread, the link moves to that job, and while two jobs fit, neither is linked. In the job's detail, `f` opens the agent, with its turns, id and transcript. If the pane is 90 columns or wider, the selected item shows beside the list.
- **Cost**: the session cost as `/cost` totals it, this session's id (`c` copies `claude --resume <id>`), the estimated dollars of the Claude agents and of the Codex jobs, and per agent and Codex job a bar of tokens and its estimate. Agents that look slow or stuck show under "Load".
- **Effects**: files that agents, Codex jobs and the main session changed, with who changed each and how (`edit`, `write`, `codex add`, `deleted`), a warning when two of them change the same file, the git worktrees files changed in with their branch and who worked there (the main session included), and open ports with the `ssh -L` command to reach them. Files written through shell commands (`cat > file <<'EOF'`, `>>`, `tee`, `sed -i`, `cp`, `mv`, `touch`, `rm`) show as `via shell`, checked on disk: Rabe takes the files named on the command line and lists one only when its size or modification time changed, or it appeared or went away, while the command ran. Claude Code does not tell Rabe the folder a Bash command runs in, so only absolute paths count (or paths after a `cd /absolute/folder` in the same command): `cat > notes.md` shows nothing. A command after `||`, inside `if` or a loop, in the background, or with a glob or `$var` in its path shows nothing, and neither does a file a script writes on its own (Python's `open(…, 'w')`, a build tool). Enter or a click on a file opens the agent or Codex job that changed it last, or copies the path of a main-session file; on an `ssh -L` line it copies the line (`c` copies the first). In a Git repository each file shows relative to the worktree that holds it; Rabe reads the worktrees with `git worktree list` in the terminal, and without Git it shows the worktrees of agents only.
- **Timeline**: a bar per item over the last 4 hours, who started what, and a summary of the previous session in this project with its id (`c` copies `claude --resume <id>`; a summary saved by Rabe 0.3 or older shows `n/a`). Its cost and duration are the whole session's, its tokens only the background items'; each line says which. Items that ended before the window fold into one line (`+37 older items, ended before 10:20`); a bar that started earlier is cut at the left edge with `◂`. `w` widens the window for the open pane, from 4 hours to 12 hours to the whole session. The option `timelineHours` in `/plugin` sets the hours; `0` shows the whole session.

## Install

Type this at a Claude Code prompt:

```
/plugin install rabe --marketplace lorenzh/rabe
```

Then run `/reload-plugins` or start a new session: a plugin you install does not load in the running session. The Claude desktop app needs this too.

## Usage

The band shows by itself while background work runs. Type `/rabe` to open the pane. In the terminal the pane docks beside the transcript. Drag its left edge to make it wider.

| Key | What it does |
|---|---|
| ↑ / ↓ | Move to the previous / next row; the detail beside the list follows |
| Enter | Open the row that has the focus, also after a click selected another row |
| Click on a row | Select the row; click it again to open it. A click on the row that has the focus opens it at once |
| Tab / Shift+Tab | Move the focus through rows, tabs and buttons |
| `b` | Go back to the list |
| `1` to `4` | Switch tab |
| `s` | Search |
| `x` | Stop the selected item |
| `g` | Stop the group the selected row is in (the rows the search shows), or the workflow run of the selected run or workflow agent |
| `r` | Remove the selected row once it is done, failed or stopped |
| `a` | Remove every done, failed or stopped row the search shows |
| `m` | Send a message to an agent |
| `f` | Open the Claude agent that forwarded a Codex job (it has no row of its own); `b` then goes back to the job's row |
| `c` | Copy the command, the prompt, the `ssh -L` line, an agent's id, or the command that resumes a session or a Codex thread. If the clipboard cannot be reached (for example over SSH in a terminal without OSC 52), a message shows the text to select |
| `d` | Delete a cron job |
| `w` | On the Timeline tab: show more time (4 h, 12 h, the whole session, then 4 h again) |
| Mouse wheel | Scroll the pane |
| Esc | Close the pane |

The buttons under the tabs show the keys of the current tab. A key that cannot act now is dim, and pressing it does nothing. A letter with no button goes to the prompt.

With the mouse, click a row once to select it and again to open it. Click a tab to switch to it, a group name to fold the group, a button to press it, or a row on the other tabs to open it. The wheel scrolls the pane. A click does not move the focus, so Enter still opens the row that has the focus. A click also does not give the pane the keys: `ctrl+x tab` does. The mouse works only in Claude Code's fullscreen layout: type `/tui fullscreen` to turn it on. Without it, use the keys.

On the list, the stop keys `x` and `g` and the remove key `r` work only after you move onto a row yourself, with an arrow, Tab or a click. Until then, and after the view or the selected row changes without you, they are dim, so a key press never stops something you did not pick. If they stay dim after a click, the pane does not have the keys yet: press `ctrl+x tab`, then move onto the row with Tab or an arrow.

While the pane is open, rows and buttons keep their places, so Enter acts on what you see under the focus. An item that starts after you open the pane goes into the group of its kind, after the rows already there; on the Effects tab, a new file or port goes into its section the same way. When it comes above the focused row, Rabe moves the focus back onto that row; until then, Enter on a row does nothing. A row that is gone stays as a dim `gone` slot. Type `/rabe` again to sort the lists.

Removed rows stay off the list, the Cost and Timeline tabs, a workflow's agent rows and the band's counts for the rest of the session. They still count in a workflow's phases and tokens, in the cost totals and on the Effects tab, so a summary never loses work that ran. Running items are never removed; an item that runs again shows again. While the pane is open, a removed row stays as a dim `gone` slot; when it was the selected row, the keys go dim until you move onto a row again.

Commands:

- `/rabe`: open the pane.
- `/rabe-stop codex:<job id>`: cancel a running Codex job. `x` in the pane does the same.
- `/rabe:report-bug`: write a bug report for this repository.
- `/rabe:feedback`: write an idea or a comment for this repository.

The two report commands show you a draft first. They create a public GitHub issue only after you say yes. Without the `gh` CLI they give you a link to open instead.

### The cost estimate

Claude Code reports tokens per agent but no dollars, so Rabe estimates them: the tokens of each model request times the list price of its model in `data/prices.csv` (USD per million tokens, standard API prices, checked 2026-10-09). The pane marks the estimate with `≈`. The session cost from `/cost` stays the real total. Rabe prices:

- Claude agents per request: uncached input, cache reads, cache writes (at the 5-minute price, since Claude Code does not report which writes last an hour; subagents write 5-minute entries almost always), and output. Haiku 5.5 prices a whole request at its long-context rates once the prompt is over 100k tokens.
- Codex jobs per request from the Codex session file: input less cached input at the input price, cached input at the cached price, cache writes at the write price, and output (reasoning included). Above 272k of prompt a request takes the model's long-context rates. A job that resumes a Codex thread (`--resume-last`) counts only the requests made after it started, not those of the jobs before it on that thread.

The estimate shows `n/a` when Rabe cannot know it: a model that is not in the table, an agent that started before Rabe loaded, a Codex session file over 4 MiB (Rabe reads only its start and end) or one that is gone or cannot be read, a request over the long-context limit of a model that OpenAI bills per session (GPT-5.4, GPT-5.5), or a request without its counts. A Codex job that counts its forwarding agent is `n/a` when the job or the agent has no estimate, and so are its tokens when one of them has none. A total is `n/a` when one of its workers has no estimate, also a worker without token data (for example a finished Codex job whose session file is gone), since a smaller sum would read as the whole cost. Codex plan billing, Bedrock, Vertex, batch, fast or regional rates are not in the table.

Your own prices: set the option `pricesFile` in `/plugin` to a CSV file in the format of `data/prices.csv` (an absolute path, or one that starts with `~/`). Its rows come first, by model ID or alias, so they change a price Rabe knows and add models it does not. A row for a model replaces Rabe's row of that model with all its names: a row for `claude-opus-4-5-20251101` also prices `claude-opus-4-5`, and the other way round. A file that is set but cannot be read makes every estimate `n/a`. The header names the columns, so a file can hold only the ones it needs; a row needs `provider` (`claude` or `openai`), `model`, `input` and `output`. For example, your own rate for one model:

```csv
provider,model,aliases,input,output,cache_read,cache_write_5m
claude,claude-opus-5-5,,3.2,16,0.16,4
```

Rabe hides Claude Code's own count of background work, because the band shows it. That is the `2 shells, 1 monitor · ↓ to manage` part under the prompt, and `still running` at the end of a turn. To keep them, turn off the option `hideBuiltinTasks` in `/plugin`. Rabe cannot hide the agent list under the prompt.

The option `timelineHours` (default 4) sets how many hours the Timeline tab shows when the pane opens; `0` shows the whole session.

## Where the data comes from

Rabe gets most data from the mod API: hooks for tool calls, agent starts, agent steps and task notifications. The rest comes from files that Claude Code and Codex write while they work. These files have no documentation and can change in any release. A value that Rabe cannot read shows as `n/a`.

Rabe cannot see some things:

- Dollars per agent or per Codex job. No source gives them; Rabe estimates them from its price table (see The cost estimate).
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
- Its own price table `data/prices.csv`, and the file the option `pricesFile` names.
- The size and modification time of the files a shell command names, before and after the command, to see which ones it wrote. Rabe does not read their content.

Rabe keeps its items in the session state of Claude Code. When a session ends, Rabe keeps a short summary for the next session in the same project. The summary holds the session id, counts per kind, tokens, cost and the names of failed items. It runs `tail` and `grep` to read files over 4 MiB, and `git worktree list` every 10 seconds in the session's folder to know the worktrees. When you stop a Codex job, it runs the Codex plugin's own cancel script.

## Requirements

- Claude Code 2.1.296. We build and test Rabe with this version. Other versions can show `n/a` where a file changed.
- A terminal for the colored band and pane. The Claude desktop app draws the same pane with plain text and buttons (tested by the maintainer on Windows with Rabe 0.1.0).
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
