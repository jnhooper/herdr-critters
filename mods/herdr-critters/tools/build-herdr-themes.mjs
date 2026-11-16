#!/usr/bin/env node
// Writes one Herdr theme per critters theme: ~/.config/herdr-app/themes/critters-<id>.json.
// Run after adding or changing a theme in ../themes/:
//
//   node ~/.config/herdr-app/mods/herdr-critters/tools/build-herdr-themes.mjs
//
// Herdr picks the files up live; they also show in Settings → Look.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THEMES } from "../themes/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const home = process.env.HERDR_APP_HOME ?? resolve(here, "../../..");
const PREFIX = "critters-";
const hex = /^#[0-9a-f]{6}$/i;

// Herdr panel colors from a critters theme: the sidebar is the theme's background,
// terminals and cards sit on the local scene's card color.
function herdrTheme(look) {
  const C = look.colors;
  const scene = look.scenes[look.localScene];
  const S = Object.fromEntries(Object.entries(look.status).map(([k, v]) => [k, v.color]));
  const ansi = look.herdr?.ansi;
  if (!Array.isArray(ansi) || ansi.length !== 16) throw new Error(`${look.id}: herdr.ansi needs 16 colors`);
  const colors = {
    chrome: C.bg,
    canvas: C.bg,
    surface: scene.card,
    popover: scene.card,
    raised: scene.edge,
    hover: C.divider,
    selected: scene.edge,
    border: C.btnEdge,
    input: scene.box,
    foreground: C.text,
    muted: C.sub,
    dim: C.head,
    accent: C.focus,
    accent_foreground: C.bg,
    solid: C.text,
    solid_foreground: C.bg,
    working: S.working,
    blocked: S.blocked,
    done: S.done,
    idle: S.idle,
    ...(look.herdr.colors ?? {}),
  };
  const out = {
    background: look.herdr.background ?? scene.card,
    foreground: look.herdr.foreground ?? C.text,
    selection: look.herdr.selection ?? scene.box,
    cursor: look.herdr.cursor ?? C.focus,
    ansi,
    colors,
  };
  for (const [k, v] of Object.entries({ ...out, ...colors, ...Object.fromEntries(ansi.map((c, i) => [`ansi${i}`, c])) })) {
    if (typeof v === "string" && !hex.test(v)) throw new Error(`${look.id}: ${k} must be #rrggbb, got ${v}`);
  }
  return out;
}

for (const look of THEMES) {
  const file = join(home, "themes", `${PREFIX}${look.id}.json`);
  const text = JSON.stringify(herdrTheme(look), null, 2) + "\n";
  const same = existsSync(file) && readFileSync(file, "utf8") === text;
  if (!same) writeFileSync(file, text);
  console.log(`${same ? "same " : "wrote"} ${file}`);
}
