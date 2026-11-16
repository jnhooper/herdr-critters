import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, nextCommand, focused, readTextFile, appHome } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The first mod a layout node shows (a panel can be a column: dev-server's head over its terminal).
function firstMod(node) {
  if (node?.content?.mod) return node.content.mod;
  for (const child of node?.children ?? []) {
    const m = firstMod(child);
    if (m) return m;
  }
  return null;
}

// The side panel's buttons are the layout's `panel-body` stack: one button per child, in order.
// Adding a panel is adding a child there, e.g. { "id": "notes", "type": "block", "content": { "mod": "notes" } }.
// Each button is drawn from its mod's mod.json "panel" section:
//   "panel": { "label": "Server", "icon": "server.svg", "dot": "devserver.dot" }
// icon is a file in the mod's folder; dot names a shared key the mod sets to a theme color
// name ("done", "working", ...) to show a small dot on the button, or null for none.
// A child with no mod (a terminal block) uses the mod named by its id.
// Herdr's own Files and Changes can't carry that section, so they're known here, and they follow
// the person's panel choice in Herdr's settings (shared "workspace.panels").
const SHIPPED = {
  files: { label: "Files", icon: "mods/files/file.svg" },
  changes: { label: "Changes", icon: "mods/changes/changes.svg" },
};

function panelsOf(root) {
  const chosen = shared("workspace.panels") ?? ["files", "changes"];
  return (find(root, "panel-body")?.children ?? [])
    .map((node) => ({ id: node.id, mod: firstMod(node) ?? node.id }))
    .filter((p) => !(p.id in SHIPPED) || chosen.includes(p.id));
}

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    cx.timer.every(700, (cx) => this.loadMeta(cx));
    this.meta = { ...SHIPPED };
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    this.loadMeta(cx);
    // Keys reach the panel buttons as commands: "critters-tabs.<panel id or mod>" (bound in
    // keys.json, e.g. "critters-tabs.server"). Each does what clicking its button does.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const p = panelsOf(layout()).find((p) => p.id === c || p.mod === c);
        if (p) this.togglePanel(p.id);
        // "remove": the space menu's Remove worktree, for the focused space. The dialog says so
        // when the space isn't a worktree (a main checkout, or no repo).
        else if (c === "remove") {
          const space = focused()?.space;
          if (space) openOverlay({ mod: "wt-remove", kind: "dialog", width: 460, height: 332, props: { space: space.id ?? space } });
        }
        cx.notify();
      }
    });
  }

  // Each panel mod's button, from its mod.json (read once per mod; a missing or broken one
  // gets a plain button with the mod's title or name).
  loadMeta(cx) {
    this.loading ??= new Set();
    for (const { mod } of panelsOf(layout())) {
      if (mod in this.meta || this.loading.has(mod)) continue;
      this.loading.add(mod);
      cx.spawn(async (cx) => {
        let json = {};
        try { json = JSON.parse((await readTextFile(`${appHome()}/mods/${mod}/mod.json`)) ?? "{}"); } catch {}
        const p = json.panel ?? {};
        this.meta[mod] = {
          label: p.label ?? json.title ?? mod,
          // A file in the mod's folder, or a path from the app home ("mods/changes/changes.svg").
          icon: !p.icon ? null : p.icon.startsWith("mods/") ? p.icon : `mods/${mod}/${p.icon}`,
          dot: p.dot ?? null,
        };
        this.loading.delete(mod);
        cx.notify();
      });
    }
  }

  // Open the side panel on `id`, or close it if it's already showing `id`. A panel that is a
  // terminal block takes the keyboard, so its keys work straight away.
  togglePanel(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (panel && !panel.hidden && body?.active === id) { run("layout.hide", { id: "panel" }); return; }
    run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" });
    const t = find(layout(), id)?.content?.terminal;
    if (t) run("pane.focus", { terminal: t });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const shownPanels = panelsOf(root);
    this.syncPanel(space, panel, body, shownPanels.map((p) => p.id));
    const panelButton = ({ id, mod }) => {
      const on = panel && !panel.hidden && body?.active === id;
      const m = this.meta[mod] ?? { label: mod };
      const dot = m.dot ? shared(m.dot) : null;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => this.togglePanel(id))
        .when(Boolean(m.icon), el => el.child(svg(m.icon).size(14)))
        .child(m.label)
        .when(typeof dot === "string" && Boolean(t[dot]), el => el.child(div().size(6).rounded(3).bg(t[dot])));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // + rides at the end of the tab row, right after the last tab.
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item))
        .child(button("tab-new", "+", () => openOverlay({ mod: "critters-new-menu", kind: "popup", width: 250, height: 543 }))))
      .children(shownPanels.map(panelButton))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/critters-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/critters-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/critters-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
