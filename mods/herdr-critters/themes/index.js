// The themes the mod ships. Order is the cycle order of the header button.

import cyber from "./cyber/theme.js";
import deepsea from "./deepsea/theme.js";
import edo from "./edo/theme.js";
import garden from "./garden/theme.js";
import noir from "./noir/theme.js";
import retro from "./retro/theme.js";
import y2k from "./y2k/theme.js";

// Theme packs installed separately into this folder (themes/<id>/theme.js), added after the
// shipped ones when present. A missing pack is skipped.
const OPTIONAL = ["crawler"];
const extra = [];
for (const id of OPTIONAL) {
  try { extra.push((await import(`./${id}/theme.js`)).default); } catch {}
}

export const THEMES = [retro, edo, y2k, noir, deepsea, garden, cyber, ...extra];
export const DEFAULT_THEME = "retro";
export const themeById = (id) => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME);
