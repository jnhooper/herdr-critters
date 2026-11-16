// Agents as retro cards: a pixel sprite in a scene, a status badge, the space and
// what it's doing. Grouped by machine; each machine has its own scene.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, machines, run, setAgentOrder, layout, shared, setShared, theme, openOverlay, closeOverlay, props, hc, focused, notify, nextCommand } from "herdr";
import { webcrypto } from "crypto";
import { activeTheme, publish, applyTheme } from "./themes/sync.js";
import { THEMES } from "./themes/index.js";
import { live as collapsedPanes, collapse, expand } from "./collapse.js";

// A theme is dark when its background is.
const isDark = (look) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(look.colors.bg.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
};
const THEME_ROW = 26;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, as in the shipped agents mod.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// An agent on another machine has a `machine/` address prefix.
const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null);

// A random item from the OS random source, so picks differ on every start.
const pickRandom = (arr) => arr[webcrypto.getRandomValues(new Uint32Array(1))[0] % arr.length];

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// The session's name: the terminal's core name, else the title the agent gives
// its terminal when that says more than the program's name or a folder.
function sessionName(a, terminal) {
  if (terminal?.name) return terminal.name;
  const live = clean(a.title);
  const generic = !live || live === a.program?.name || live.toLowerCase() === a.program?.key || /^[~/]|^[A-Za-z]:\\/.test(live) || live.includes("@");
  return generic ? null : live;
}

// The line under the name: "space -> session", else the space and its tab.
function detail(a, tabs, session) {
  if (session) return session;
  const tab = tabs.find((t) => t.id === a.tab);
  return tab?.named ? tab.name : tab ? `tab ${tab.name}` : a.program?.name ?? "";
}

// Cards go under their machine or under their space; the choice is shared state.
const GROUP_KEY = "herdr-critters.group";
const groupBy = () => (shared(GROUP_KEY) === "space" ? "space" : "machine");

// Collapsed groups ("space:<id>" / "machine:<name>") and compact cards (by address),
// each a shared map of id -> true.
const COLLAPSED_KEY = "herdr-critters.collapsed";
const COMPACT_KEY = "herdr-critters.compact";
const isSet = (key, id) => Boolean(shared(key)?.[id]);
function toggle(key, id) {
  const map = { ...(shared(key) ?? {}) };
  if (map[id]) delete map[id];
  else map[id] = true;
  setShared(key, map);
}

// The collapse id of the group an agent shows in.
const groupIdOf = (a) => (groupBy() === "space" ? `space:${a.space}` : `machine:${machineOf(a) ?? ""}`);

// A collapsed pane (pane-collapse) parks its terminal, so the agent leaves agents().
// It stays here as a collapsed card, built from its record and its core terminal,
// after the last agent of its space. `parked` holds the record to expand it.
function withCollapsed(list, all, spaceList) {
  const out = [...list];
  const shown = new Set(list.map((a) => a.address));
  const byAddress = new Map(all.map((t) => [t.address, t]));
  for (const rec of collapsedPanes()) {
    const t = byAddress.get(rec.terminal);
    if (shown.has(rec.terminal) || !t?.status) continue;
    const space = spaceList.find((s) => s.id === rec.space);
    const a = {
      address: rec.terminal,
      pane: null,
      space: rec.space,
      space_name: space?.name ?? "",
      tab: rec.tab,
      tab_index: 0,
      tab_name: "",
      status: t.status,
      app: t.report?.app ?? null,
      program: t.program ?? { name: rec.name },
      title: rec.name,
      seq: 0,
      pinned: t.labels?.["herdr.pinned"] === "true",
      focused: false,
      parked: rec,
    };
    let at = out.length;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].space === rec.space) { at = i + 1; break; }
    out.splice(at, 0, a);
  }
  return out;
}

// Puts a collapsed pane back. cx: an event context.
const expandPane = (a, cx) => cx.spawn(async (cx) => { await expand(a.parked, cx); });

// Where a theme's picked names are stored. A theme can set `namesKey` to keep an old key
// (retro keeps "names" so current users keep their names).
const namesKey = (look) => look.namesKey ?? `names.${look.id}`;

// Every agent's one fixed name, whatever the look: shared state (address -> name), drawn
// from every theme's names. Each name is also put on the agent's terminal as the label
// NAME_LABEL, so agents can find each other by it (`critter onyx`, `hc ls --label ...`).
const NAMES_KEY = "critters.names";
const NAME_LABEL = "herdr.critter";
// The name the agents list shows right now, when a theme shows its cast's names instead of the
// fixed one (crawler shows "carl"): also a label, so `critter carl` finds it too.
const SHOWN_LABEL = "herdr.critter.shown";
const SHOWN_KEY = "critters.shown";
const NAME_POOL = [...new Set(THEMES.flatMap((t) => t.names))];
// Names an agent had before names were fixed (retro's), kept when free.
const LEGACY_KEY = "names";

// The art files' type: "svg" by default, "png" for a theme drawn as raster art.
const artExt = (look) => look.artExt ?? "svg";

// A picked critter is one of the theme's own names, or "<theme>:<name>" borrowed from another
// theme once the theme's own are all taken (crawler has 11). Past every critter of every theme
// a name repeats with a number ("carl 2"), drawn with the same art.
const critterName = (picked) => (picked ?? "").split(":").pop().replace(/ \d+$/, "");
function critterArt(picked, look) {
  const [id, name] = (picked ?? "").includes(":") ? picked.split(":") : [null, picked];
  const from = (id && THEMES.find((t) => t.id === id)) || look;
  return { art: from.art, ext: artExt(from), name: (name ?? "").replace(/ \d+$/, "") };
}

export default class RetroAgents extends View {
  init(_props, cx) {
    this.hovered = null;
    this.look = null;
    this.picked = {};
    if (props()?.menu || props()?.themes) return; // popups: no names to keep
    this.labelled = {}; // address -> the names its terminal's labels carry ("fixed|shown")
    this.wanted = new Map(); // address -> [fixed name, shown name]
    cx.timer.every(2000, (cx) => this.syncLabels(cx));
    // "herdr-critters.attention" (keys.json): show the next agent that needs you.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "attention") this.nextAttention();
        cx.notify();
      }
    });
  }

  // The next agent waiting on you (blocked), else the next that finished (done), in the
  // agents list's order, starting after the one shown now; pressed again, it moves on.
  nextAttention() {
    const list = this.order?.length ? this.order.map((ad) => agents().find((a) => a.address === ad)).filter(Boolean) : agents();
    const now = focused()?.agent;
    const pick = (status) => {
      const due = list.filter((a) => a.status === status);
      if (!due.length) return null;
      const at = due.findIndex((a) => a.address === now);
      return due[(at + 1) % due.length];
    };
    const a = pick("blocked") ?? pick("done");
    if (a) run("agent.focus", { terminal: a.address });
    else notify({ title: "Nobody needs you", body: "No agent is waiting on you or has just finished.", timeout: 2500 });
  }

  // One fixed name per agent from every theme's names, never two the same. An agent keeps
  // its name; a new one takes its old retro name when free, else a random free one.
  nicknames(list) {
    const fixed = { ...(shared(NAMES_KEY) ?? {}) };
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "{}");
    const out = new Map();
    const taken = new Set();
    let dirty = false;
    // Agents that already have a name go first, so a newcomer never takes it.
    const ordered = [...list.filter((a) => fixed[a.address]), ...list.filter((a) => !fixed[a.address])];
    for (const a of ordered) {
      let name = fixed[a.address];
      if (!name || taken.has(name)) {
        const old = legacy[a.address];
        const free = NAME_POOL.filter((n) => !taken.has(n));
        name = old && NAME_POOL.includes(old) && !taken.has(old) ? old : pickRandom(free.length ? free : NAME_POOL);
        fixed[a.address] = name;
        dirty = true;
      }
      // Only past every name in the pool: the same name again, with a number.
      let unique = name;
      for (let n = 2; taken.has(unique); n++) unique = `${name}${n}`;
      taken.add(unique);
      out.set(a.address, unique);
    }
    if (dirty) setShared(NAMES_KEY, fixed);
    return out;
  }

  // Put each agent's name on its terminal as a label; only changes are written.
  syncLabels(cx) {
    if (this.syncing) return;
    const todo = [...this.wanted].filter(([address, [name, shown]]) => this.labelled[address] !== `${name}|${shown}`);
    if (!todo.length) return;
    this.syncing = true;
    cx.spawn(async () => {
      for (const [address, [name, shown]] of todo) {
        try {
          const r = await hc(["label", address, `${NAME_LABEL}=${name}`, `${SHOWN_LABEL}=${shown}`]);
          if (r.code === 0) this.labelled[address] = `${name}|${shown}`;
        } catch {}
      }
      this.syncing = false;
    });
  }

  // The status entry for an agent's word; an unknown word reads as idle.
  statusOf(s) {
    return this.look.status[s] ?? this.look.status.idle;
  }

  pixel(el, size, color) {
    return el.font_family(this.look.fonts.pixel).text_size(size).text_color(color);
  }

  // Switch to the active theme; each theme keeps its own picked names, kept across
  // restarts so a name doesn't change under you.
  useTheme(look) {
    if (this.look?.id === look.id) return;
    this.look = look;
    this.picked = JSON.parse(localStorage.getItem(namesKey(look)) ?? "{}");
  }

  // Which critter draws each agent (its sprite), never two the same: the agent's own fixed
  // name when this theme has art for it, else the critter it had here before while free, else
  // a random free one of this theme's, else (all taken) one borrowed from another theme.
  // The name shown is the fixed one, or the critter's when the theme sets `castNames`.
  sprites(list, nick) {
    const out = new Map();
    const taken = new Set();
    const NAMES = this.look.names;
    let dirty = false;
    // Agents whose own name has art here claim it first.
    const own = list.filter((a) => NAMES.includes(nick.get(a.address)));
    for (const a of own) {
      const name = nick.get(a.address);
      if (taken.has(name)) continue;
      if (this.picked[a.address] !== name) { this.picked[a.address] = name; dirty = true; }
      taken.add(name);
      out.set(a.address, name);
    }
    for (const a of list) {
      if (out.has(a.address)) continue;
      let name = this.picked[a.address];
      const borrowed = (n) => n?.includes(":") && THEMES.some((t) => t.id === n.split(":")[0] && t.names.includes(n.split(":")[1]));
      const free = NAMES.filter((n) => !taken.has(n));
      // A borrowed critter goes back once one of the theme's own is free again.
      if (!name || !(NAMES.includes(name) || (borrowed(name) && !free.length)) || taken.has(name)) {
        const shown = new Set([...taken].map(critterName));
        const others = THEMES.filter((t) => t.id !== this.look.id)
          .flatMap((t) => t.names.filter((n) => !NAMES.includes(n) && !shown.has(n)).map((n) => `${t.id}:${n}`))
          .filter((n) => !taken.has(n));
        name = pickRandom(free.length ? free : others.length ? others : NAMES);
        this.picked[a.address] = name;
        dirty = true;
      }
      // Only past every critter of every theme: the same name again, with a number.
      let unique = name;
      for (let n = 2; taken.has(unique); n++) unique = `${name} ${n}`;
      taken.add(unique);
      out.set(a.address, unique);
    }
    if (dirty) localStorage.setItem(namesKey(this.look), JSON.stringify(this.picked));
    return out;
  }

  // The sprite box: scene, sprite, and the corner badge that tells the state at a glance.
  // `name` is the agent's picked name: each name has its own sprite.
  stage(a, scene, w, h, name) {
    const { colors: C, status: STATUS } = this.look;
    const { art, ext, name: file } = critterArt(name, this.look);
    const st = a.status;
    // A theme can set how big its sprites draw (share of the box width) and where their feet
    // land (share of the box height above the bottom); by default 66%, on the scene's ground,
    // its bottom 7 of 30 rows.
    const S = this.look.sprite ?? {};
    const spriteW = Math.round(w * (S.size ?? 0.66));
    const spriteH = Math.round(spriteW * 0.8);
    const left = Math.round((w - spriteW) / 2);
    const top = h - Math.round(h * (S.ground ?? 7 / 30)) - spriteH + 2;
    const sprite = image(`${art}/sprite-${file}-${STATUS[st] ? st : "idle"}.${ext}`).absolute().left(left).top(top).w(spriteW).h(spriteH);
    const badge = div()
      .absolute()
      .top(3)
      .right(3)
      .size(Math.max(12, Math.round(w * 0.2)))
      .flex()
      .items_center()
      .justify_center()
      .bg(C.badgeBg)
      .border(1)
      .border_color(st === "idle" ? C.idleEdge : this.statusOf(st).color);
    // Idle has no corner mark: a sprite shows its own sleepiness (z's drawn into the art).
    const mark = {
      working: () => this.pixel(div(), 9, STATUS.working.color).frames(["▘", "▝", "▗", "▖"], 140),
      blocked: () => this.pixel(div(), 10, STATUS.blocked.color).child("!").loop("opacity", { from: 0.25, to: 1, period: 700 }),
      done: () => div().text_size(10).font_bold().text_color(STATUS.done.color).child("✓"),
    }[st] ?? (() => div());
    return div()
      .relative()
      .w(w)
      .h(h)
      .flex_none()
      .overflow_hidden()
      .border(2)
      .border_color(st === "idle" ? scene.box : this.statusOf(st).color + C.statusEdgeAlpha)
      .child(image(`${art}/scene-${STATUS[st] ? st : "idle"}.${ext}`).absolute().left(0).top(0).w(w - 4).h(h - 4))
      .child(st === "working" ? sprite.loop("top", { from: top, to: top - 3, period: 520 }) : sprite)
      .when(st !== "idle", (el) => el.child(badge.child(mark())));
  }

  // A small icon button on a card; a click does `act` and not the card's own click.
  cardButton(id, tooltip, icon, act) {
    const C = this.look.colors;
    return div()
      .id(id)
      .flex_none()
      .p(2)
      .text_color(C.sub)
      .cursor_pointer()
      .hover((el) => el.text_color(C.text))
      .tooltip(tooltip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        act(cx);
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12));
  }

  // The status word in its box.
  statusBox(a) {
    const s = this.statusOf(a.status);
    return this.pixel(div(), 10, s.color)
      .flex_none()
      .mt(-1)
      .px(5)
      .h(17)
      .flex()
      .items_center()
      .border(1)
      .border_color(a.status === "idle" ? this.look.colors.idleBox : s.color)
      .child(s.word);
  }

  // The card's frame: hover, click to focus, and the edge color.
  cardFrame(a, scene) {
    const { colors: C, status: STATUS } = this.look;
    const edge = a.focused ? C.focus : a.status === "blocked" ? STATUS.blocked.color : scene.edge;
    return h_flex()
      .id(`card-${a.address}`)
      .relative()
      .flex_none()
      .items_center()
      .bg(scene.card)
      .border(2)
      .border_color(edge)
      .cursor_pointer()
      .hover((el) => el.bg(scene.edge))
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click((_e, cx) => (a.parked ? expandPane(a, cx) : run("pane.focus", { pane: a.pane })))
      .on_mouse_down("right", (_e, cx) => this.openMenu(a, cx));
  }

  // Right-click: a popup at the pointer, drawn by this mod with `props().menu`.
  openMenu(a, cx) {
    cx.stop_propagation();
    this.hovered = null;
    openOverlay({ mod: "herdr-critters", kind: "popup", frame: "none", width: 190, height: 118, props: { menu: a.address } });
  }

  // The context menu: pin, card collapse and group collapse for one agent.
  menu(address) {
    const { colors: C } = this.look;
    const a = withCollapsed(agents(), terminals(), spaces()).find((x) => x.address === address);
    const close = () => closeOverlay(props().overlay);
    if (!a) {
      close();
      return div();
    }
    const group = groupIdOf(a);
    // An async act closes the menu when it ends: closing the popup stops its tasks.
    const item = (id, label, act, wait) => this.pixel(h_flex(), 10, C.sub)
      .id(`menu-${id}`)
      .h(26)
      .px(8)
      .items_center()
      .cursor_pointer()
      .hover((el) => el.bg(C.divider).text_color(C.text))
      .on_click((_e, cx) => {
        if (!wait) {
          act();
          close();
          return;
        }
        cx.spawn(async (cx) => {
          await act(cx);
          close();
        });
      })
      .child(label);
    const pane = a.parked
      ? item("pane", "EXPAND PANE", (cx) => expand(a.parked, cx), true)
      : item("pane", "COLLAPSE PANE", () => collapse({ pane: a.pane, terminal: a.address }), true);
    return v_flex()
      .size_full()
      .p(4)
      .bg(C.bg)
      .border(2)
      .border_color(C.btnEdge)
      .child(item("pin", a.pinned ? "UNPIN" : "PIN TO TOP", () => run("terminal.pin", { terminal: a.address, pinned: !a.pinned })))
      .child(pane)
      .when(!a.parked, (el) => el.child(item("card", isSet(COMPACT_KEY, a.address) ? "EXPAND CARD" : "COLLAPSE CARD", () => toggle(COMPACT_KEY, a.address))))
      .child(item("group", isSet(COLLAPSED_KEY, group) ? "SHOW GROUP" : "COLLAPSE GROUP", () => toggle(COLLAPSED_KEY, group)));
  }

  // The theme list: a popup just under the theme button.
  // Where the button is, from the press (a click event carries no position).
  anchorThemes(e) {
    const p = e?.position, l = e?.local_position;
    this.themesAt = p && l ? { x: p.x - l.x, y: p.y - l.y + 18 } : null;
  }

  openThemes() {
    const at = this.themesAt ?? "pointer";
    openOverlay({ mod: "herdr-critters", kind: "popup", frame: "none", width: 220, height: THEMES.length * THEME_ROW + 12, at, props: { themes: true } });
  }

  // Every theme: a swatch of its colors, its name in its own font, dark or light, a check on the shown one.
  themeMenu() {
    const { colors: C } = this.look;
    const close = () => closeOverlay(props().overlay);
    const row = (t) => {
      const on = t.id === this.look.id;
      const scene = t.scenes[t.localScene];
      return h_flex()
        .id(`theme-${t.id}`)
        .h(THEME_ROW)
        .px(6)
        .gap(8)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(C.divider))
        .hover((el) => el.bg(C.divider))
        .on_click(() => {
          close();
          if (!on) applyTheme(t);
        })
        .child(h_flex().flex_none().w(30).h(14).border(1).border_color(C.btnEdge)
          .child(div().flex_1().h_full().bg(t.colors.bg))
          .child(div().flex_1().h_full().bg(scene.card))
          .child(div().flex_1().h_full().bg(t.colors.focus)))
        .child(div().flex_1().min_w(0).truncate().font_family(t.fonts.pixel).text_size(11).text_color(on ? C.text : C.sub).child(t.label))
        .child(this.pixel(div(), 8, C.head).flex_none().child(isDark(t) ? "DARK" : "LIGHT"))
        .child(div().flex_none().w(10).text_size(11).text_color(C.focus).child(on ? "✓" : ""));
    };
    return v_flex()
      .size_full()
      .p(4)
      .bg(C.bg)
      .border(2)
      .border_color(C.btnEdge)
      .children(THEMES.map(row));
  }

  pinButton(a) {
    return this.cardButton(`pin-${a.address}`, a.pinned ? "Unpin" : "Pin to the top", a.pinned ? "pin-off" : "pin",
      () => run("terminal.pin", { terminal: a.address, pinned: !a.pinned }));
  }

  compactButton(a, compact) {
    if (a.parked) return this.cardButton(`compact-${a.address}`, "Expand the pane", "plus", (cx) => expandPane(a, cx));
    return this.cardButton(`compact-${a.address}`, compact ? "Expand the card" : "Collapse the card", compact ? "plus" : "minus",
      () => toggle(COMPACT_KEY, a.address));
  }

  // A collapsed card: one thin line with a small sprite, the name and the status.
  // A collapsed pane's agent always shows as one.
  compactCard(a, scene, name) {
    const { colors: C, fonts } = this.look;
    const hot = this.hovered === a.address;
    return this.cardFrame(a, scene)
      .p(3)
      .gap(8)
      .child(this.stage(a, scene, 36, 30, this.picked[a.address]))
      .child(div().flex_1().min_w(0).font_family(fonts.mono).text_size(fonts.monoSize ?? 20).line_height(fonts.monoLine ?? "18px").text_color(C.text).truncate().child(name))
      .when(hot, (el) => el.child(this.compactButton(a, true)))
      .when(hot || a.pinned, (el) => el.child(this.pinButton(a)))
      .child(this.statusBox(a).mt(0).mr(2));
  }

  card(a, scene, tabs, name, session) {
    if (a.parked || isSet(COMPACT_KEY, a.address)) return this.compactCard(a, scene, name);
    const { colors: C, fonts } = this.look;
    const hot = this.hovered === a.address;
    return this.cardFrame(a, scene)
      .p(6)
      .gap(10)
      .child(this.stage(a, scene, 74, 62, this.picked[a.address]))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(5)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().flex_1().min_w(0).font_family(fonts.mono).text_size(fonts.monoSize ?? 20).line_height(fonts.monoLine ?? "18px").text_color(C.text).truncate().child(name))
              .child(this.statusBox(a)),
          )
          .child(div().text_size(11.5).text_color(C.sub).truncate().child(detail(a, tabs, session))),
      )
      .child(h_flex().absolute().bottom(4).right(4)
        .when(hot, (el) => el.child(this.compactButton(a, false)))
        .when(hot || a.pinned, (el) => el.child(this.pinButton(a))));
  }

  // A small outlined button in the top bar.
  headerButton(id, tooltip, onClick, label) {
    const C = this.look.colors;
    return this.pixel(div(), 9, C.sub)
      .id(id)
      .flex_none()
      .px(3)
      .h(15)
      .flex()
      .items_center()
      .border(1)
      .border_color(C.btnEdge)
      .cursor_pointer()
      .hover((el) => el.text_color(C.text).border_color(C.sub))
      .tooltip(tooltip)
      .on_click(onClick)
      .child(label);
  }

  // A group's header; a click collapses or opens the group.
  header(g, collapsed) {
    const { art, colors: C } = this.look;
    const ext = artExt(this.look);
    const busy = g.members.filter((a) => a.status === "working").length;
    return h_flex()
      .id(`group-${g.id}`)
      .flex_none()
      .h(30)
      .pt(6)
      .px(2)
      .gap(7)
      .items_center()
      .cursor_pointer()
      .tooltip(collapsed ? "Show the agents" : "Hide the agents")
      .on_click(() => toggle(COLLAPSED_KEY, g.id))
      .child(div().flex_none().text_color(C.sub).child(svg(`mods/workspace-chrome/${collapsed ? "chevron-right" : "chevron-down"}.svg`).size(12)))
      .child(image(`${art}/icon-machine-${g.scene.id}.${ext}`).w(15).h(11).flex_none())
      .child(this.pixel(div(), 11, g.color ?? C.machine).font_bold().truncate().child(g.label))
      .child(div().flex_1().min_w(8).h(2).bg(g.scene.edge))
      .child(this.pixel(div(), 11, g.scene.label).flex_none().child(`${busy}/${g.members.length}`));
  }

  // A small stage that focuses the agent's pane on a click.
  miniStage(a, scene) {
    const C = this.look.colors;
    return div()
      .id(`rail-${a.address}`)
      .flex_none()
      .border(2)
      .border_color(a.focused ? C.focus : C.clear)
      .cursor_pointer()
      .on_click((_e, cx) => (a.parked ? expandPane(a, cx) : run("pane.focus", { pane: a.pane })))
      .on_mouse_down("right", (_e, cx) => this.openMenu(a, cx))
      .child(this.stage(a, scene, 36, 30, this.picked[a.address]));
  }

  // The rail: one small stage per agent.
  rail(list, sceneOf) {
    const C = this.look.colors;
    return v_flex()
      .size_full()
      .bg(C.bg)
      .items_center()
      .pt(8)
      .gap(6)
      .overflow_y_scrollbar()
      .children(list.map((a) => this.miniStage(a, sceneOf(a))));
  }

  render() {
    const look = activeTheme();
    publish(look);
    this.useTheme(look);
    if (props()?.themes) return this.themeMenu();
    if (props()?.menu) return this.menu(props().menu);
    const { art, colors: C, status: STATUS } = look;
    const ext = artExt(look);
    const order = [null, ...machines().map((m) => m.name).filter((n) => n !== null)];
    const sceneOf = (a) => {
      const m = machineOf(a);
      const id = m === null ? look.localScene : look.remoteScenes[Math.max(0, order.indexOf(m) - 1) % look.remoteScenes.length];
      return { id, ...look.scenes[id] };
    };

    // agents() comes in machine, space order, so neighbours make a group either way.
    // Pins go first inside their group.
    const bySpace = groupBy() === "space";
    const t = theme();
    const spaceColors = shared("space.colors") ?? {};
    const all = terminals();
    const groups = [];
    for (const a of withCollapsed(agents(), all, spaces())) {
      const m = machineOf(a);
      const key = bySpace ? a.space : m;
      if (groups.at(-1)?.key === key) {
        groups.at(-1).members.push(a);
        continue;
      }
      const scene = sceneOf(a);
      groups.push(bySpace
        ? { key, id: groupIdOf(a), label: (a.space_name || "space").toUpperCase(), color: t[spaceColors[a.space]], scene, members: [a] }
        : { key, id: groupIdOf(a), label: m === null ? "THIS MACHINE" : m.toUpperCase(), scene, members: [a] });
    }
    for (const g of groups) g.members = [...g.members.filter((a) => a.pinned), ...g.members.filter((a) => !a.pinned)];
    const list = groups.flatMap((g) => g.members);
    setAgentOrder(list.map((a) => a.address));
    this.order = list.map((a) => a.address);

    const fixed = this.nicknames(list);
    const drawn = this.sprites(list, fixed);
    // The name each card shows: the fixed one, or with `castNames` the critter's (its cast).
    const names = new Map(list.map((a) => [a.address, look.castNames ? critterName(drawn.get(a.address)) : fixed.get(a.address)]));
    this.wanted = new Map(list.map((a) => [a.address, [fixed.get(a.address), names.get(a.address)]]));
    const shownNow = Object.fromEntries(names);
    if (JSON.stringify(shared(SHOWN_KEY) ?? {}) !== JSON.stringify(shownNow)) setShared(SHOWN_KEY, shownNow);
    if (narrow()) return this.rail(list, sceneOf);

    const tabs = spaces().flatMap((s) => s.tabs);
    const busy = list.filter((a) => a.status === "working").length;
    const byAddress = new Map(all.map((t) => [t.address, t]));

    // A collapsed group shows only its header.
    const rows = groups.flatMap((g) => {
      const collapsed = isSet(COLLAPSED_KEY, g.id);
      return [
        this.header(g, collapsed),
        ...(collapsed ? [] : g.members.map((a) => this.card(a, g.scene, tabs, names.get(a.address), sessionName(a, byAddress.get(a.address))))),
      ];
    });

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(C.bg)
      .border_t(1)
      .border_color(C.divider)
      .child(
        h_flex()
          .flex_none()
          .h(38)
          .px(14)
          .pt(6)
          .items_center()
          .justify_between()
          .child(h_flex().flex_1().min_w(0).overflow_hidden().gap(5).items_center()
            .child(image(`${art}/icon-dither.${ext}`).size(12).flex_none())
            .child(this.pixel(div(), 11, C.head).flex_none().child("AGENTS"))
            .child(this.headerButton("critters-group", bySpace ? "Grouped by space (click: by machine)" : "Grouped by machine (click: by space)",
              () => setShared(GROUP_KEY, bySpace ? "machine" : "space"),
              svg(`mods/workspace-chrome/${bySpace ? "layers" : "monitor"}.svg`).size(10)))
            .child(this.headerButton("critters-theme", "Choose the look of Herdr", () => this.openThemes(),
                h_flex().min_w(0).gap(2).items_center()
                  .child(div().min_w(0).truncate().child(look.label))
                  .child(svg("mods/workspace-chrome/chevron-down.svg").size(9).flex_none()))
              .flex_shrink(1)
              .min_w(24)
              .on_mouse_down("left", (e) => this.anchorThemes(e))))
          .child(this.pixel(div(), 11, busy ? STATUS.working.color : C.head).flex_none().child(`${busy} ${STATUS.working.word}`)),
      )
      .when(list.length === 0, (el) =>
        el.child(v_flex().px(14).pt(10).gap(6)
          .child(this.pixel(div(), 11, C.machine).child("NO PLAYERS YET"))
          .child(div().text_size(11.5).text_color(C.sub).child("Agents show up here when they report their status."))))
      .child(v_flex().id("critters-list").flex_1().min_h(0).px(10).pb(10).gap(8).overflow_y_scrollbar().children(rows));
  }
}
