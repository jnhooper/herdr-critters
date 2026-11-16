// Keeps the critters look and Herdr's own theme in step.
//
// One source of truth: Herdr's theme. Every critters theme has a matching
// Herdr theme, `themes/critters-<id>.json` (made by tools/build-herdr-themes.mjs),
// so picking either one, here or in Herdr's Settings → Look, changes both.
//
// Mods can't import each other's files, so this mod publishes the active look
// as shared state (LOOK_KEY). Any other mod reads `shared("critters.look")` to
// draw in the same fonts, scenes, art and status words; `theme()` already
// carries the matching colors.

import { settings, shared, setShared, run, layout } from "herdr";
import { THEMES, themeById } from "./index.js";

export const THEME_KEY = "herdr-critters.theme";
export const LOOK_KEY = "critters.look";
export const HERDR_PREFIX = "critters-";

export const herdrThemeName = (look) => `${HERDR_PREFIX}${look.id}`;

// Herdr's theme decides when it is a critters one; otherwise the last critters pick
// stays (so a plain Herdr theme still shows the critters you had).
export function activeTheme() {
  const name = settings()?.theme;
  if (typeof name === "string" && name.startsWith(HERDR_PREFIX)) return themeById(name.slice(HERDR_PREFIX.length));
  return themeById(shared(THEME_KEY));
}

// What other mods get: everything they need to draw, without the name lists.
const published = (look) => {
  const { names: _names, herdr: _herdr, ...rest } = look;
  return { ...rest, ext: look.artExt ?? "svg", herdrTheme: herdrThemeName(look) };
};

// Called on render; writes only when something changed (a write re-renders every mod).
export function publish(look) {
  if (shared(THEME_KEY) !== look.id) setShared(THEME_KEY, look.id);
  const next = published(look);
  if (JSON.stringify(shared(LOOK_KEY)) !== JSON.stringify(next)) setShared(LOOK_KEY, next);
}

// `app.theme` only fills the light or dark half of a layout's theme, so a light
// critters theme (edo, y2k, garden) wouldn't show in dark mode. Instead the shown
// layout's root theme becomes this one name, for both appearances. The tree comes
// from layout(), the live one, so panels, sizes and other clicks are kept.
export function applyTheme(look) {
  setShared(THEME_KEY, look.id);
  const tree = layout();
  if (tree && typeof tree === "object") run("layout.set", { layout: { ...tree, theme: herdrThemeName(look) } });
  else run("app.theme", { name: herdrThemeName(look) });
}

export const nextTheme = (look) => THEMES[(THEMES.indexOf(look) + 1) % THEMES.length];
