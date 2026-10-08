<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="rabe" width="308" height="84">
</picture>

# rabe

**See what Claude Code runs in the background.**

Rabe (German for raven) is a Claude Code mod. It shows your subagents, Codex jobs, background shells, monitors, cron jobs and workflows in one place: a short band above the prompt, and a full view with `/rabe`.

Status: early development. Nothing works yet beyond an empty `/rabe` pane.

## Install

Type this at a Claude Code prompt:

```
/plugin install rabe --marketplace lorenzh/rabe
```

## Develop

Run Claude Code with the mod loaded from this folder. It reloads when you save a file.

```sh
claude --plugin-dir .
```

Check the mod and run its tests:

```sh
claude plugin validate .
claude plugin test .
```

After the first load, Claude Code writes the API types to `.claude-plugin/types/`. Then `tsc -p .` type-checks the mod.
