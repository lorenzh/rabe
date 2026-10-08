---
description: Send feedback or an idea for Rabe as a GitHub issue in lorenzh/rabe, after you check the draft
argument-hint: "[your idea or comment]"
allowed-tools: Bash(gh auth status), Bash(gh issue create:*)
---

Help the person send feedback about Rabe, the Claude Code mod, as an issue in the public repository `lorenzh/rabe`.

What they said: $ARGUMENTS

Steps:
1. If the feedback is empty or unclear, ask what they would like and why it would help them, in one short message.
2. Write a draft with a short title and two sections, matching `.github/ISSUE_TEMPLATE/feedback.yml`: Your feedback, and Example (a situation where it would have helped, if they gave one).
3. Keep private data out: no home paths, user or project names, prompts, tokens or email addresses, unless the person asks for them.
4. Show the full draft and ask: "Create this issue in lorenzh/rabe? It will be public." Do nothing more until they say yes. Apply any changes they ask for and show the draft again.
5. After a yes: if `gh auth status` succeeds, run `gh issue create --repo lorenzh/rabe --label feedback --title "<title>" --body "<body>"` and give them the issue link. Otherwise give them this link to open, with the title and texts URL-encoded: `https://github.com/lorenzh/rabe/issues/new?template=feedback.yml&labels=feedback&title=<title>&feedback=<feedback>&example=<example>`.
