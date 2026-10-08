<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="rabe" width="308" height="84">
</picture>

# rabe

**See what Claude Code runs in the background.**

Rabe (German for raven) is a Claude Code mod. It shows your subagents, Codex jobs, background shells, monitors, cron jobs and workflows in one place: a short band above the prompt, and a full view with `/rabe`.

Status: early development. Nothing works yet beyond an empty `/rabe` pane. [What Rabe can see](docs/feasibility.md) lists where each piece of data comes from.

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

## Feedback and bugs

In Claude Code, `/rabe:report-bug` and `/rabe:feedback` draft an issue for this repo. You check the draft before anything is sent. They use the `gh` CLI when you are logged in, and otherwise give you a link to a prefilled issue. You can also [open an issue](https://github.com/lorenzh/rabe/issues/new/choose) directly.

## License

[MIT](LICENSE)
