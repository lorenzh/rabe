<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="rabe" width="308" height="84">
</picture>

# rabe

**See what Claude Code runs in the background.**

Rabe (German for raven) is a Claude Code mod. It shows your subagents, Codex jobs, background shells, monitors, cron jobs and workflows in one place: a short band above the prompt, and a full view with `/rabe`.

Status: early development. Rabe tracks Claude subagents, workflows, Codex jobs started through the Codex plugin (`/codex:rescue`, `/codex:review`), background shells (with exit code and a guessed port), monitors (with each output line and when it arrived), cron jobs and `/loop` wakeups. The band counts what runs, and `/rabe` lists it on the Items tab. `/rabe-stop codex:<job id>` cancels a running Codex job. [What Rabe can see](docs/feasibility.md) lists where each piece of data comes from; [How Rabe is built](docs/architecture.md) describes the code.

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
