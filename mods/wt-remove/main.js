// Remove a space's worktree with worktrunk (`wt remove`), as a dialog: props { space }.
//
// Uncommitted .md files at the worktree's root (CLAUDE.md, PLAN.md, ...) are notes: they
// go with the worktree. Any other uncommitted change is listed, and only "Remove anyway"
// removes it then. `wt remove` runs your worktrunk remove hooks (dropping the branch's
// databases) and deletes the branch if it's merged. A dev server running from the
// worktree (the dev-server mod's) is stopped first, and every Claude session working in
// it (in any space) is quit the way Claude quits (Ctrl-C twice), its conversation kept.
// The space is closed afterwards. The dialog closes as soon as you confirm: the Spaces list
// does the work (critters-spaces/wt-remove-worker.js) and a toast says how it went.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, exec, hc, theme, shared, setShared, props, closeOverlay } from "herdr";
import { critters, pixel } from "./critters-look.js";

const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop();
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// A note: a Markdown file at the worktree's root.
const isNote = (path) => !path.includes("/") && /\.md$/i.test(path);

export default class WtRemove extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus(); // Enter and Esc reach the dialog without a click
    this.info = null; // { root, main, branch, notes, others }
    this.error = null;
    this.busy = false;
    cx.spawn(async (cx) => {
      try { this.info = await this.look(); } catch (e) { this.error = String(e?.message ?? e); }
      this.handle.focus();
      cx.notify();
    });
  }

  space() { return spaces().find((s) => s.id === props()?.space); }

  // The worktree: where the space's first terminal is now, as Herdr reads a space's repo.
  async look() {
    const s = this.space();
    if (!s) throw new Error("That space is gone.");
    const tabs = new Set((s.tabs ?? []).map((t) => t.id));
    const cwd = panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
    const on = s.machine ?? undefined;
    const git = (args) => exec("git", args, { cwd, on });
    const top = await git(["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) throw new Error(`${base(cwd)} isn't in a git repository.`);
    const root = top.stdout.trim();
    const common = (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"])).stdout.trim();
    if (common === `${root}/.git`) throw new Error(`${base(root)} is the repository's main checkout, not a worktree.`);
    const main = common.endsWith("/.git") ? common.slice(0, -5) : common;
    const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    // -z: paths exactly as they are; -uall: every untracked file, not just its folder.
    const st = await exec("git", ["--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall"], { cwd: root, on });
    if (st.code !== 0) throw new Error(st.stderr.trim() || "git status failed.");
    const entries = st.stdout.split("\0").filter(Boolean);
    const paths = [];
    for (let i = 0; i < entries.length; i++) {
      const code = entries[i].slice(0, 2), path = entries[i].slice(3);
      paths.push({ code, path });
      if (code[0] === "R" || code[0] === "C") i++; // a rename's source follows
    }
    // Claude sessions working inside the worktree, wherever their terminal is.
    const names = { ...(shared("critters.names") ?? {}), ...(shared("critters.shown") ?? {}) };
    const ls = await hc(["ls", "--json"]);
    const claudes = (ls.code === 0 ? JSON.parse(ls.stdout).terminals ?? [] : [])
      .filter((t) => t.state === "live" && /claude/i.test(t.agent ?? "") && t.cwd && (t.cwd === root || t.cwd.startsWith(`${root}/`)))
      .map((t) => ({ address: t.address, name: names[t.address] ?? t.address, working: t.status === "working" }));
    return {
      root, main, branch, on, claudes,
      notes: paths.filter((p) => isNote(p.path)).map((p) => p.path),
      others: paths.filter((p) => !isNote(p.path)),
    };
  }

  close() { closeOverlay(props()?.overlay); }

  // Hand the removal to the Spaces list (it stays open), close at once; a toast reports.
  go(cx) {
    const i = this.info;
    if (!i) return;
    const req = {
      id: `${Date.now()}-${props()?.space}`, space: props()?.space, root: i.root, main: i.main,
      branch: i.branch, on: i.on ?? null, claudes: i.claudes, force: i.notes.length + i.others.length > 0,
    };
    setShared("wtremove.queue", [...(shared("wtremove.queue") ?? []).filter((r) => r.root !== i.root), req]);
    this.close();
  }

  render(cx) {
    const t = theme(), L = critters();
    const s = this.space(), i = this.info;
    const risky = i?.others.length > 0;
    const stops = s ? agents().filter((a) => a.space === s.id) : [];
    const title = `Remove worktree ${s?.name ?? ""}?`;
    const line = (text, color) => div().text_size(12).text_color(color ?? t.muted).child(text);
    const btn = (id, label, color, action) => h_flex().id(id).h(28).px(12).items_center().rounded(L ? 0 : 6).border(1)
      .border_color(color).text_color(color).cursor_pointer().hover((el) => el.bg(t.hover)).on_click(action)
      .child(L ? pixel(L, div(), 10, color).child(label.toUpperCase()) : div().text_size(12.5).font_semibold().child(label));

    return v_flex().id("wt-remove").size_full().bg(t.popover).p(16).gap(8)
      .track_focus(this.handle)
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => {
        if (e.key === "escape") this.close();
        else if (e.key === "enter" && i && !risky) this.go(cx);
      })
      .child(L ? pixel(L, div(), 11, L.colors.machine).child(title.toUpperCase()) : div().text_size(14).font_semibold().text_color(t.foreground).child(title))
      .when(!i && !this.error, (el) => el.child(line("Looking at it…", t.dim)))
      .when(Boolean(i), (el) => el
        .child(line(`wt remove ${base(i.root)}: its hooks run, and branch ${i.branch} is deleted if it's merged.`))
        .when(i.notes.length > 0, (e2) => e2.child(line(`Drops uncommitted notes: ${i.notes.join(", ")}`, t.dim)))
        .when(i.claudes.length > 0, (e2) => e2.child(line(`Quits Claude: ${i.claudes.map((c) => c.name).join(", ")}. Their conversations stay saved.`, t.dim)))
        .when(stops.length > i.claudes.length, (e2) => e2.child(line(`Closes the space and stops what runs in it.`, t.dim)))
        .when(risky, (e2) => e2
          .child(line(`Other uncommitted changes: they will be lost.`, t.blocked))
          .child(v_flex().id("wt-others").gap(2).py(4).max_h(108).overflow_y_scrollbar().text_size(11).font_family("JetBrains Mono").text_color(t.blocked)
            .children(i.others.slice(0, 40).map((p, n) => div().id(`o-${n}`).h(18).flex_none().flex().items_center().truncate().child(`${p.code} ${p.path}`)))
            .when(i.others.length > 40, (l) => l.child(div().h(18).flex_none().flex().items_center().child(`+${i.others.length - 40} more`))))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.blocked).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end().items_center()
        .child(div().id("wt-cancel").text_size(12).text_color(t.dim).cursor_pointer().hover((x) => x.text_color(t.foreground)).on_click(() => this.close()).child("Cancel"))
        .when(Boolean(i), (el) => el.child(this.busy
          ? div().text_size(12).text_color(t.dim).child("Removing…")
          : btn("wt-go", risky ? "Remove anyway" : "Remove", risky ? t.blocked : t.accent, (_e, cx) => this.go(cx)))));
  }
}
