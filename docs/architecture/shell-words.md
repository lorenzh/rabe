---
title: Shell words
description: The pure helpers extracted from writes.ts and their boundary with the mod API.
tags: [architecture, modules]
keywords: [shell-words, shell-words.ts, writes.ts, refactor, modules]
---

# Shell words

`hooks/shell-words.ts` contains pure helpers: shell quoting, expansions, comments and here-doc tokenization.
The split keeps parsing and data changes separate from mod API calls.
It changes no behaviour.

`writes.ts` keeps command options, write candidates and disk-change comparisons. The lexer keeps its existing limits and failure results.

See [Sources](sources.md) for behaviour and [the module map](../architecture.md) for sizes.

The write detector imports `Word` and `Tok`. Other lexer helpers stay private.
The write detector keeps `ShellWrite` private.
