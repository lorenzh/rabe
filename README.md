<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="rabe" width="308" height="84">
</picture>

# rabe

**See what Claude Code runs in the background.**

Rabe (German for raven) is a Claude Code mod. It shows your subagents, Codex jobs, background shells, monitors, cron jobs and workflows in one place: a short band above the prompt, and a full view with `/rabe`.

Status: early development. Rabe tracks Claude subagents, workflows, Codex jobs started through the Codex plugin (`/codex:rescue`, `/codex:review`), background shells (with exit code and a guessed port), monitors (with each output line and when it arrived), cron jobs and `/loop` wakeups. `/rabe-stop codex:<job id>` cancels a running Codex job. [What Rabe can see](docs/feasibility.md) lists where each piece of data comes from; [How Rabe is built](docs/architecture.md) describes the code.

## What you see

- **The band** above the prompt shows one row per kind while something runs: Claude agents, Codex jobs, workflows, shells with their ports, failures from the last 10 minutes, monitors, cron countdowns, and the token cost. It draws nothing when nothing runs, and one line when the rows do not fit.
- **`/rabe`** opens a pane with four tabs (`1` to `4`):
  - **Items**: every item grouped by kind, failures first, with a filter row and a search field. Enter opens an item: the turns of a Claude agent or a Codex job, the phases and agents of a workflow, the output of a shell or monitor, the next runs of a cron job.
  - **Cost**: tokens and estimated dollars per agent and Codex job.
  - **Effects**: worktrees and open ports, with the `ssh -L` command to reach a port.
  - **Timeline**: when each item ran, and who started what.

Keys: press Tab first (nothing holds the focus when the pane opens), then Tab or Down to move and Enter to open. Letters act on the selected item: `s` search, `x` stop, `g` stop group, `f` follow, `m` message an agent, `c` copy, `d` delete a cron job, `b` back. Esc closes the pane.

## Install

Type this at a Claude Code prompt:

```
/plugin install rabe --marketplace lorenzh/rabe
```

## Develop

Install the development tools with [Bun](https://bun.sh) 1.4, then run Claude Code with the mod loaded from this folder. It reloads when you save a file.

```sh
bun install
claude --plugin-dir .
```

Run all checks (lint, type check, manifest validation and tests), as CI does:

```sh
bun run check
```

Contributor and agent rules are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)
