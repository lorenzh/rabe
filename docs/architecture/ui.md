---
title: UI rendering
description: The view contract, renderer, palette, cell engine, sizing, and status band.
tags: [architecture, ui, rendering]
keywords: [View, renderer, palette, cell engine, band]
---

# UI rendering

## The views

The band and the pane read the sources' session values and draw. Neither writes items, and no view reads a file. The Items list and the band's chips leave out the ended items the person removed (`kept(items, removed)` in `lists.ts`, from `rabe.removed` as `Model.removed`; see Removing ended items); everything else counts them. The agent turns come from `rabe.turns`, Codex steps from the item's `detail.steps`, and shell and monitor output from `rabe.lines`. Views are pure functions. Only `band.tsx`, `pane.tsx` and `builtin.tsx` touch `$`; `pane.tsx` turns an action into `$` calls in its top-level `act($, action, surface)`.

| File | What it holds |
|---|---|
| `ui/cells/grid.ts` | The cell engine for charts: a grid, text, spans, bars, wrap, paste, the `cells` encoding; `safe`, `fit` and `wrap` also serve the lines |
| `ui/cells/palette.ts` | The 256-color palette (`C`, `CHIP`), `DEFAULT` (the terminal's own color), `xterm`, `paint`, `tone(item)` |
| `ui/view.ts` | The view contract: `Model`, `Size`, `Selection`, `Action`, `NONE`, `Press`, `Part`, `Line`, `Node`, `ViewButton`, `ViewInput`, `Drawn`, `Piece`, `View`; `layout`, `rowKeys`, `stepRow`, `landing`, `controlRows`, `canStop`, `taskIdOf`; the arming: `Arming`, `DISARMED`, `ArmEvent`, `arm`, `landingOf`, `isDestructive`, `LIST_KEYS`, `targetsOf` |
| `ui/render.tsx` | `hold(pieces, held, inPlace)`: the append-only focus order, rows of the Items list seated in their group; `shifts`: whether an element moved in the focus order; `render(ui, surface, drawn, act)`: the same tree on every surface |
| `ui/views/band.ts` | `bandView`: the band's rows, as one chart |
| `ui/views/pane.ts` | `paneView` and `TABS`: the tab row, the toolbar, the tab's view or the open item, the hint; `fallbackOf`: the open item or selected row the drawing could not show; `isLiveRow`: a row the Items list draws, not a gone slot; `selectsOnPress`: a press that selects a row instead of opening it; `seatsRows`: the views whose new rows `hold` seats in place (the Items list and Effects) |
| `ui/views/items.ts` | `itemsView`: grouped list, split or one-line summary, list controls, search |
| `ui/views/detail.ts` | `detailView`, `detailLines` and `bodyLines`: one item in full, per kind; `resumeButton`, the `c: copy resume` control the Cost and Timeline tabs use too |
| `ui/views/cost.ts`, `effects.ts`, `timeline.ts` | The other tabs |
| `ui/views/lines.ts` | `fitLine`, `beside`, `text`, `itemLine`, `headLines`, `focusOn`, `plain`: shared row drawing |
| `ui/lists.ts` | Pure grouping, sorting, the held order (`stable`, `orderOf`), `byParent`, the forwarders folded into their Codex jobs (`isForwarder`, `shown`, `forwarderOf`, `rowOf`, `withForwarder`, `nest`), the files agents, Codex jobs and the main session changed (`touched`, `byConflict`), labels, the band's count per kind (`bandRows`), totals, phases, tree, bars |
| `ui/facts.ts` | The fact lines of one item (model, worktree, ids, who started it, run time, exit code; an agent's transcript as the `long` fact) |
| `ui/format.ts` | Durations, ages, token and dollar amounts |
| `ui/fixtures.ts` | Fake items, `screen(ui)` and `raster(drawn)` / `gridOf(drawn)` for the tests; nothing else imports it |

### The view contract

Each view is a pure function from the model, the size and the selection to the lines of its body and its controls:

```ts
type Model = { items: RabeItem[]; turns: Record<string, RabeTurn[]>; lines: Record<string, RabeLines>; now: number; usd?: number; previous?: RabePrevious; edits?: RabeEdit[]; cwd?: string; worktrees?: RabeWorktree[]; sessionId?: string; removed?: string[] }
type Size = { columns: number; rows: number; surface: RenderSurface; hasInput: boolean; window?: { top: number; rows: number } }
type Selection = { tab: RabeTab; query: string; folded: string[]; selected: string; open: string; order?: RabeOrder; isFocused: boolean; isArmed: boolean; isListArmed: boolean; window?: RabeWindow }

type Span = [text: string, style?: { fg?: number; bg?: number }]
type Press = { key: string; label: string; action: Action; hotkey?: string; autoFocus?: true; dim?: true; bg?: number }
type Part = Span | Press                       // isPress(part) tells them apart
type Line = { spans: Part[]; right?: Span[]; bg?: number }
type Node = Line | { chart: Grid }

type ViewButton = { key: string; label: string; action: Action; hotkey?: string; autoFocus?: true; dim?: true }
type ViewInput = { key: string; label: string; placeholder: string; submitLabel: string; value?: string; isLive?: boolean; action: (text: string) => Action }
type Drawn = { nodes: Node[]; buttons: ViewButton[]; inputs?: ViewInput[]; toolbar?: number }
type Piece = Node | { button: ViewButton } | { input: ViewInput }   // layout(drawn): document order
type View = (model: Model, size: Size, selection: Selection) => Drawn
```

- **A line** is one row of the body: Text parts and plain Buttons, then a part at the right end. A view passes each line through `fitLine(line, columns)`, which makes it exactly `columns` cells wide, as a grid row was: parts cut with `…`, the right part at the end, spaces between, every character through `safe`, a Press with a `hotkey` counted with the `c: ` the engine draws before its label, and the line's `bg` moved onto each part, so two fitted lines can stand side by side. `beside(left, leftWidth, gap, right, rightWidth)` sets two columns of lines next to each other (the split, the Timeline's lower half).
- **A selectable row** is a line with one `Press`: a plain Button whose label is the row's name, keyed by a stable id (`row:<item id>`; a group header `group-<group>`; a tab `tab-<tab>`). The Effects tab's rows are not items, so their ids are their own: `row:file:<path>` for a file (it opens the agent that edited it last) and `row:ssh:<port>` for an `ssh -L` line (it copies the line). The other parts (marker, glyph, port, exit code, time) are Text. A row is one pressable thing: only Buttons take a press, so a row has no second control inside it. `itemLine(item, now, isSelected)` builds the Items row; the Cost, Effects and Timeline rows are built the same way.
- **Focus.** A Button takes no color. `dim` draws a name dim at rest and full under the focus or the pointer; the views dim every row but the selected one. The selected row also has an orange `▌` and the `selected` background, so it reads as selected while the pane does not hold the keys. `focusOn(lines, selected)` gives `autoFocus` to the selected row, else the first: the focus starts there when the pane takes the keys, and Enter presses it. Of several `autoFocus` elements the first drawn wins, so a view sets one.
- **The split shows no Buttons.** The detail beside the list goes through `plain`, which turns its Buttons into Text, so the arrow keys and Tab walk the list alone. The full detail (Enter) keeps its rows pressable (a workflow's agents).
- **Charts** (`{ chart: grid }`) are cells nobody presses: a Raster on the terminal, text lines elsewhere. Only the band uses one now. The Cost and Timeline bars and the time axis are block glyphs in Text parts of their rows: a chart is a whole node, so it cannot stand in a row beside the row's Button, and Text draws the same cells on the terminal and also on the desktop.
- **Controls.** `buttons` are drawn `[ label ]` in a row before the node at `toolbar` (the pane's toolbar, under the tab row), else after the body. The label carries the key (`x: stop`), since the engine does not draw hotkeys. Hotkeys are one digit or one lowercase letter. A control with `autoFocus` takes the focus (the detail's `b: back`). A control that cannot act now keeps its slot: `dim`, the action `NONE` (`{ type: 'none' }`, a press does nothing) and a bound hotkey that does nothing. The list's `x: stop` and `g` (`g: stop group` or `g: stop run`) and the detail's `m: message` and stop are always drawn for the kinds that have them. A control of a detail that acts on an item names that item in its key; the list's `x` and `g` keep the keys `stop` and `stop-group` (see Target-bound keys). A stop never comes first: the list's toolbar starts with `s: search` (where the surface has `Input`), the detail with `b: back`, so the first element after the tabs is never a stop in any view (see The append-only focus order).
- **Inactive keys.** `paneView` binds a dim control's own hotkey with the action `NONE`. It adds no controls for letters the view does not own. Every focusable control has a visible label. Tab and the engine's arrows stop on blank Buttons. No Button prop makes them unfocusable. `hold` appends new controls after the held focus sequence. Missing controls keep their visible labels in slots without hotkeys. The hint names only actions that can run. The binding table below names each view's letters.
- `inputs` are drawn after the controls where the surface has `Input` (`size.hasInput`). A focused Input takes every key, also the hotkeys, so a view offers a control that focuses it (`s: search`, `m: message`) instead of focusing it itself. After a submit the pane moves the ring off the Input again (see Focus and the arrow keys).
- `Action` is what pressing does: `tab`, `open`, `fold`, `query`, `window`, `focus`, `stop`, `delete`, `remove`, `clear`, `copy`, `message` and `none`. `pane.tsx` runs it; the renderer never passes on `none`.

A new view is a file in `hooks/ui/views/` that exports a `View`. A new tab adds its view and label to `TABS` in `views/pane.ts` and its name to `RabeTab`. A new detail adds a case to `bodyLines` in `views/detail.ts`. Neither touches the renderer or `pane.tsx` unless it needs a new `Action`.

### The renderer

`render(ui, surface, drawn, act)` in `ui/render.tsx` is the one place that turns a `Drawn` (or its pieces, `layout(drawn)`, after `hold`) into elements, and it draws the same tree on every surface, in document order:

- Each line is a row `Box`. Its Spans are `Text` (color, background, `wrap="truncate"`), its Presses plain `Button`s (`plain`, `dimColor`, `hotkey`, `autoFocus`, `onPress`). A Button takes no color prop, so each run of parts on one background sits in its own `Box` of that color: the focused Button draws inverse over its label and the Box's background shows around it. A row with exactly one Button is keyed `line:<press key>`, which makes it the hover scope of that Button (`hover: { bold: true }`); an empty line draws one space so it keeps its height.
- A chart is a `Raster` on the terminal, keyed `cells` (the band's `band`), cut by `clamp` to the 512 columns and 256 rows a Raster takes. Elsewhere it is one `Text` per row: the desktop hands out a Raster that draws an empty Box, so the choice is `surface === 'terminal'`.
- Controls side by side in a row Box keyed `controls` (`controls-2` for a second run), and each Input where it stands. A press of an action `none` calls nothing.

### The palette

Every color in `palette.ts` is one of the xterm-256 colors 16 to 255, written as `0x00RRGGBB`: a cube color (each channel 0, 95, 135, 175, 215 or 255) or a grey (8 + 10n). Under tmux the engine reduces a hex color for a Box or Text to 256 colors with a coarse formula (`#203020` and `#402040` both became 59), so two dark backgrounds could fall together. `paint(rgb, surface)` therefore names a Box or Text color as `ansi256(n)` on the terminal, which the engine passes unchanged, and as hex on every other surface; `DEFAULT` (`0x01000000`) is no color, the terminal's own, so plain text and the background follow the person's theme. A Raster's cells keep the exact entry, which the engine's own reduction of Raster colors maps to itself. The 16 base colors are left out, since each theme draws its own.

| Name | xterm | Use |
|---|---|---|
| `dim`, `bright`, `grey` | 245, 255, 252 | Secondary text, emphasis, the cost chip |
| `orange`, `yellow`, `green`, `red`, `blue`, `purple`, `cyan` | 173, 179, 107, 167, 75, 176, 73 | Kinds and states (`tone`), group headers, ports |
| `selected`, `panel`, `raised`, `rule` | 238, 236, 235, 239 | Selected row, cost panel and summary line, the running turn, rules |
| `CHIP.*` | fg 216, 116, 150, 222, 117, 183, 210, 252 on bg 94, 23, 22, 58, 17, 53, 52, 237 | Band chips, legend, conflict and load notes: a light tint of the kind's hue on the dark cube color of that hue (`done` shares `workflow`'s) |

`palette.test.ts` checks that each color is an exact entry and that the colors drawn side by side (the text colors, the row backgrounds, the chip backgrounds and the chip texts) are distinct indexes, so tmux keeps them apart.

### The cell engine

A Raster is a fixed grid of terminal cells. Each cell is exactly `[codePoint, foreground, background]`: a code point is one printable width-1 BMP character, a color is `0x00RRGGBB` or `0x01000000` for the terminal's default. A Raster has no bold, underline or italic. It is a leaf: no press and no focus. Rabe draws only charts with it (the band); the pane is lines of Text and Buttons.

`hooks/ui/cells/grid.ts` builds such grids with plain functions and no `$`. They change the grid they are given and return nothing or the next column:

| Function | What it does |
|---|---|
| `grid(columns, rows, style?)` | A grid of spaces in the default colors (or the style's) |
| `safe(text)` | One cell per character: whitespace becomes a space; a character on the allow list stays; anything else becomes `?` |
| `clamp(g)` | The grid cut to the 512 columns and 256 rows a Raster takes; `render` applies it to every chart. The band passes its view a size within these bounds (`bounded` in `view.ts`) |
| `fit(text, width)` | Pads, or cuts with `…`, to exactly `width` cells |
| `write(g, x, y, text, style?)` | Text from `(x, y)`, clipped at the edge; a style leaves the colors it does not name |
| `spans(g, x, y, [[text, style], …], width?)` | Runs of styled text, the last cut with `…` at `width` |
| `wrap(text, width)` | Lines of at most `width` cells, split at spaces |
| `bar(value, max, width)` | A bar in eighths of a block (`█▉▊▋▌▍▎▏`), padded |
| `paste(g, src, x, y)` | Copies one grid into another, clipped |
| `encode(g)` / `decode(columns, rows, base64)` | The Raster `cells` string: little-endian u32 triplets in padded base64 |
| `lines(g)` | The text of each row, trailing spaces cut: the text fallback and the tests |

`safe` keeps an allow list, not a deny list: a deny list missed characters such as `☰` (U+2630), which the engine takes as wide and refuses, naming the cell's index, so the whole Raster is lost. The list holds code points terminals draw one cell wide: printable ASCII, Latin-1 letters and punctuation, Latin Extended-A and B, Greek, Cyrillic, general punctuation (no spaces, zero-width or format characters), currency signs, arrows, box drawing and block elements, and the glyphs Rabe draws outside those ranges (`GLYPHS`: `◐ ● ▶ ✗ ✓ ⚠ ⟳ ≈` …). Unassigned code points, marks, format and control characters in those ranges are out. Other scripts, emoji and symbols show as `?`. `fitLine` uses it too, so a line's width in cells is its length. `render.test.tsx` draws every character `safe` keeps in one Raster through the pinned engine, which checks each cell. A new glyph in a view goes into `GLYPHS`, or it shows as `?`.

### Sizing

`paneView` gives the tab's view `scroll.bodyRows` less the tab rows and their rule, the hint (1) and the rows its toolbar takes (`controlRows`: Buttons as `[ label ]` with a gap, wrapped at `bodyColumns`, plus one row per Input). It calls the view twice: once to learn its controls, once with the rows left. A body shorter than that is padded, so the hint sits at the bottom. A list longer than that is drawn whole: the pane is then taller than its body and the engine scrolls it, the focus carries the window along (see Focus and the arrow keys), and the wheel scrolls it. `size.rows` bounds the split preview. Every opened detail draws all recorded body lines for scrolling. The split preview keeps the newest lines that fit. It reserves one row for a hidden-text note and the Enter key that opens the full detail. Agent previews visit turns from newest to oldest and stop once the available rows fill. They wrap only a suffix bounded by the remaining rows times the text width. The note says `Older text hidden` without counting unwrapped lines. Other previews count the older lines they hide. With no room left below the facts the preview still draws its note. When the opened detail exceeds the available rows, its hint shows `↑↓ scroll`. Workflow rows keep `↑↓ move`. A workflow draws every agent row. Its head and top are never cut: a fact that wraps, such as an agent's transcript path in a short pane, scrolls like a list, in the full detail and in the split. No view cuts its lines to `size.rows`: what does not fit scrolls, so no row's Button is lost. `size.window` is the part of the view's rows the pane shows, from the Pane's `scroll` (`offset`, `bodyRows`); `paneView` moves its `top` up by the tab rows, the rule and the toolbar, so it counts in the view's rows.

The Items tab splits into list and detail side by side when `bodyColumns` is at least 90 (`SPLIT_COLUMNS`). A docked pane asked for 100 columns gets about 72 at a 200-column terminal, and an inline one at 100 terminal columns gets 96. Below 90 the list fills the width and ends with one summary line of the selected item on the panel background (`◐ review auth.ts · gpt-6.1-sol · ≈ $0.09 · 25k in · running`; a folded job's dollars and input tokens are its sum with its forwarder's, `withForwarder`, as in the Cost tab and the detail; an agent or job without a known sum shows `cost n/a` and no tokens), and Enter opens the full detail in place; `b` goes back. The list keeps an empty line between groups only when the whole list fits. In the split, a list longer than the pane scrolls, and the detail starts at the first row the pane shows (empty lines above it), so it stays in view beside the focus. That row is `size.window.top` moved just enough to keep the focused row in view (`shownFrom`): the engine follows the focus that way and does not ask again (see feasibility).

### The band

A `ui.render` hook on `AbovePrompt`. With no running item, or while a survey holds the band, it calls `next(e)` and draws nothing. Otherwise `bandView` draws an empty line, so the status line above does not touch the band, and one line of count chips, one per kind that has something to show, failed (ended in the last 10 minutes) first, then `claude`, `codex`, `workflow`, `shell`, `monitor` and `cron`, then the cost when any tokens are known. Each chip is `◐ 2 claude` in its kind's colors (`CHIP`). The band uses full labels and the dollar and token cost when they fit; if they do not, it tries readable short labels, then puts the dollar amount first and drops the token part. This adapts to the chip count and available width instead of using a fixed column cutoff. The amount is the session's cost from `$.session.usage().cost.usd`, as `/cost` totals it, when the host has one; else the sum of the items' dollars. The band never grows with the number of items. With a `maxRows` of 1 (a small terminal or a multiline prompt) it leaves out the empty line: a taller tree would give that row to the engine's `n more` mark and hide the chips. Names, ports and the next cron run are in the pane. Nothing in the band is pressed, so it is one chart.

The grid is `bodyColumns` wide and exactly as tall as its lines. The band before drew padded `Text` labels in a row; beside an open pane the band is narrow, a label wrapped its trailing spaces, and the band drew an empty line. The engine owns collapsing (ctrl+x ctrl+a); the hook gets no collapsed flag.
