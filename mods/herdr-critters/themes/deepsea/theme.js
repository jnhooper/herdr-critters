// The deepsea look: a bioluminescent ocean at night. Every color, scene, word, font
// and name the view uses. The palette is fixed on purpose, it doesn't follow the Herdr theme.

export default {
  id: "deepsea",
  label: "DEEPSEA",
  art: "mods/herdr-critters/themes/deepsea/art",
  // The art is raster (soft gel, drawn with skia-python), so its files are PNG.
  artExt: "png",
  fonts: { pixel: "Silkscreen", mono: "VT323" },
  colors: {
    bg: "#070b18",
    head: "#5a6a92",
    machine: "#3ff0ff",
    focus: "#3ff0ff",
    text: "#e6f6ff",
    sub: "#8a9cc0",
    badgeBg: "#040812cc",
    idleEdge: "#6a7aa0",
    idleMark: "#c8d8f4",
    idleBox: "#3a4668",
    btnEdge: "#1e2a48",
    divider: "#121a30",
    clear: "#00000000",
    // Appended to a status color for the sprite box border.
    statusEdgeAlpha: "99",
  },
  // A scene per machine: this machine gets the local scene, others take the rest in turn.
  scenes: {
    abyss: { card: "#0c1430", edge: "#1a2a58", box: "#24387a", label: "#7ffcff" },
    reef: { card: "#1a1030", edge: "#36204e", box: "#4a2c6a", label: "#ffb8f4" },
    vent: { card: "#1e1018", edge: "#40202a", box: "#5a2c34", label: "#ffc08a" },
    trench: { card: "#0a1c20", edge: "#173a3c", box: "#205050", label: "#9fffd8" },
  },
  localScene: "abyss",
  remoteScenes: ["reef", "vent", "trench"],
  // Herdr's matching theme (themes/critters-deepsea.json, made by tools/build-herdr-themes.mjs).
  // Panel colors come from the colors and scenes above; `ansi` is the terminal's 16 colors,
  // `colors` (optional) overrides any Herdr theme color by name.
  herdr: {
    ansi: [
      "#070b18", "#ff4f8b", "#6bffb0", "#ffc08a", "#5a8cff", "#d77aff", "#3ff0ff", "#c8d8f4",
      "#5a6a92", "#ff7aa8", "#9fffd8", "#ffd8b0", "#8ab0ff", "#ffb8f4", "#7ffcff", "#e6f6ff",
    ],
  },
  status: {
    working: { word: "DIVE", color: "#3ff0ff" },
    blocked: { word: "SOS!", color: "#ff4f8b" },
    done: { word: "DOCK", color: "#6bffb0" },
    idle: { word: "DRIFT", color: "#8a96b8" },
  },
  // Every agent's name, a deep sea creature to follow: 4 to 6 letters each.
  names: ["lumen", "bloom", "inky", "kraken", "coil", "pinch", "nudi", "gulper", "pearl", "glim", "rolly", "krill"],
};
