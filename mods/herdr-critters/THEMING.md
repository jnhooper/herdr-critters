# Critters theming across Herdr

One switch changes the whole window: the critters art, the Spaces list, and
Herdr's own colors (terminal, tabs, pane frames, Files/Changes, status bar).

## How it fits together

```
themes/<id>/theme.js         the one source: colors, scenes, fonts, art, status words,
                             and `herdr.ansi` (the terminal's 16 colors)
        │
        ├─ tools/build-herdr-themes.mjs ──► ~/.config/herdr-app/themes/critters-<id>.json
        │                                   (Herdr's theme; every shipped panel follows it)
        │
        └─ themes/sync.js (in this mod, on render)
              activeTheme(): Herdr's theme if it's critters-<id>, else the last pick
              publish():     shared "critters.look" = the active look (fonts, art, scenes)
              applyTheme():  sets the shown layout's root theme to critters-<id>
                             (one name for light and dark, clicks kept)
```

Herdr's theme is the source of truth, so switching works from either side:
the theme button in the Agents header, or Settings → Look → `critters-<id>`.

## Add a theme

1. Make `themes/<id>/theme.js` (copy one) with its art in `themes/<id>/art/`,
   including a `herdr: { ansi: [16 colors] }` block (optional `colors` to override
   any Herdr color by name, `background`/`foreground`/`selection`/`cursor` for the terminal).
2. Import it in `themes/index.js` and add it to `THEMES`.
3. `node ~/.config/herdr-app/mods/herdr-critters/tools/build-herdr-themes.mjs`

## Make another panel match

Mods can't import each other's files, so copy `mods/critters-spaces/critters-look.js`
into the mod and use it:

```js
import { theme } from "herdr";
import { critters, sceneFor, pixel, mono, art } from "./critters-look.js";

const L = critters();          // null until herdr-critters has published: draw plain then
const t = theme();             // already the matching critters-<id> colors
pixel(L, div(), 11, L.colors.head).child("FILES");
image(art(L, "icon-dither"));
```

For a shipped panel: `herdr-app do mod.clone '{"name":"tabs","as":"critters-tabs"}'`,
restyle it, and point `layouts/critters.json` at the clone.

## Mods in this setup

- `herdr-critters`: the Agents list, the theme registry and the sync.
- `critters-spaces`: a clone of Herdr's `spaces` mod, restyled from the published look.
  Without a published look it draws exactly like the original.
- `critters-tabs`: a clone of Herdr's `tabs` mod with a **PR** button beside Files/Changes.
- `pr-comments`: the right panel's PR view (stack child `pr` in `panel-body`): the PR for the
  focused terminal's branch via `gh pr view`, its unresolved review threads, then the
  conversation and resolved threads folded. Works in worktrunk worktrees (any checkout).
  "Send to agent" / "Send all" paste threads into the space's agent with `hc send`
  (focused agent, else the only one, else a picker; none: Claude in a new tab).
