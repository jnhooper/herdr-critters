// The right panel's Changes slot as tuicr (a code review TUI), one per space.
//
// A layout block can show a live herdr-core terminal ({ terminal: "t7" }), so each space
// gets its own background tuicr terminal, started in its focused pane's folder, and the
// `changes` block is pointed at the shown space's one. tuicr shows a snapshot of the
// uncommitted changes and exits when there are none (or outside a repo); then the block
// goes back to Herdr's own Changes mod, which handles those cases and has the commit box.
//
// tuicr restarts for a fresh snapshot when Changes is opened (or its space shown) and the
// worktree has changed since; while it stays on screen it is left alone.

import { spaces, panes, focused, exec, hc, run, layout, settings, themes, terminals } from "herdr";

const FALLBACK = { mod: "changes" };
const LABEL = "herdr.tuicr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Where the shown space is now, as the Changes mod reads it: its focused pane's folder.
// With the keyboard in a layout terminal block (tuicr itself) there's no focused pane, so the
// space's last pane folder is kept; falling back to the space's folder there would look like a
// move, restart tuicr and take the focus away from it.
const lastCwd = {};
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = space?.machine ?? null;
  if (space && pane?.cwd) lastCwd[space.id] = pane.cwd;
  return { space, cwd: pane?.cwd || (space && lastCwd[space.id]) || space?.folder, on };
}

// Uncommitted Markdown at the worktree's root (CLAUDE.md, PLAN.md, ...) is notes, not code to
// review: the same rule as removing a worktree. tuicr hides it through a .tuicrignore at the
// worktree's root (written when missing; git ignores that file through the repository's shared
// info/exclude), and a worktree with only notes changed counts as clean.
const isNote = (line) => { const p = line.slice(3).replace(/^"|"$/g, ""); return !p.includes("/") && /\.md$/i.test(p); };
async function ensureIgnore(cwd, on) {
  const script = `root=$(git rev-parse --show-toplevel) || exit 0
common=$(git rev-parse --path-format=absolute --git-common-dir) || exit 0
[ -e "$root/.tuicrignore" ] || printf '%s\\n' '/*.md' '/.tuicrignore' > "$root/.tuicrignore"
mkdir -p "$common/info"; grep -qxF .tuicrignore "$common/info/exclude" 2>/dev/null || echo .tuicrignore >> "$common/info/exclude"`;
  await exec("/bin/sh", ["-c", script], { cwd, on }).catch(() => {});
}

const live = (address) => terminals().some((t) => t.address === address && t.state !== "finished" && t.state !== "lost");
const sameContent = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export class TuicrChanges {
  constructor() {
    // space id -> { address, cwd, status }
    try { this.entries = JSON.parse(localStorage.getItem("tuicr") ?? "{}"); } catch { this.entries = {}; }
    this.busy = false;
    this.last = null; // what was shown at the last look: space, folder, visible
  }

  save() { localStorage.setItem("tuicr", JSON.stringify(this.entries)); }

  // Point the `changes` block at `content` (a terminal, or the Changes mod).
  // Herdr drops a layout block whose terminal ends (tuicr quit), so a missing `changes`
  // block is put back in the panel stack, after Files.
  show(content) {
    const tree = layout();
    const body = find(tree, "panel-body");
    if (!body) return;
    const node = find(tree, "changes");
    if (node && sameContent(node.content, content)) return;
    const copy = JSON.parse(JSON.stringify(tree));
    const target = find(copy, "changes");
    if (target) target.content = content;
    else {
      const kids = find(copy, "panel-body").children;
      const at = kids.findIndex((c) => c.id === "files");
      kids.splice(at + 1, 0, { id: "changes", type: "block", content });
    }
    run("layout.set", { layout: copy });
  }

  kill(spaceId) {
    const e = this.entries[spaceId];
    if (e?.address) hc(["kill", e.address]).catch(() => {});
    delete this.entries[spaceId];
    this.save();
  }

  // Called often (cheap unless something changed). `force`: the Changes button was pressed.
  tick(cx, force = false) {
    const tree = layout();
    const node = find(tree, "changes");
    if (!node) { this.show(FALLBACK); return; }
    // Spaces that are gone take their tuicr with them.
    const ids = new Set(spaces().map((s) => s.id));
    for (const id of Object.keys(this.entries)) if (!ids.has(id)) this.kill(id);

    const panel = find(tree, "panel"), body = find(tree, "panel-body");
    const visible = Boolean(panel && !panel.hidden && body?.active === "changes");
    const { space, cwd, on } = location();
    const key = JSON.stringify([space?.id, cwd, visible]);

    // Shown tuicr quit (q, or nothing to review): back to the Changes mod.
    if (node.content?.terminal && !live(node.content.terminal)) {
      for (const [id, e] of Object.entries(this.entries)) if (e.address === node.content.terminal) delete this.entries[id];
      this.save();
      this.show(FALLBACK);
      return;
    }
    if (!visible || !space || !cwd || this.busy) { this.last = key; return; }
    // You're in tuicr: never swap it out from under you (it refreshes when you come back).
    if (node.content?.terminal && focused()?.terminal === node.content.terminal) return;
    if (!force && key === this.last) return;
    this.last = key;
    this.busy = true;
    cx.spawn(async () => {
      try { await this.refresh(space, cwd, on, force); } catch {}
      this.busy = false;
    });
  }

  async refresh(space, cwd, on, force) {
    const st = await exec("git", ["--no-optional-locks", "status", "--porcelain=v1", "-uall"], { cwd, on });
    const code = st.code === 0 ? st.stdout.split("\n").filter((l) => l.trim() && !isNote(l)).join("\n") : "";
    if (st.code !== 0 || !code) {
      // Not a repo, or nothing changed but notes: tuicr has nothing to show.
      this.show(FALLBACK);
      if (this.entries[space.id]) { await exec("sleep", ["0.3"]); this.kill(space.id); }
      return;
    }
    const status = code;
    const e = this.entries[space.id];
    if (e && live(e.address) && e.cwd === cwd && e.status === status && !(force && e.status !== status)) {
      this.show({ terminal: e.address });
      return;
    }
    const old = e?.address;
    await ensureIgnore(cwd, on);
    const light = themes().find((t) => t.name === settings().theme)?.light;
    const args = ["run", "--bg", "--json", "--cwd", cwd, "--label", `${LABEL}=${space.id}`];
    if (on) args.push("--on", on);
    args.push("--", "tuicr", "-w", "--no-update-check", "--appearance", light ? "light" : "dark");
    const r = await hc(args);
    const address = r.code === 0 ? JSON.parse(r.stdout).address : null;
    if (!address) { this.show(FALLBACK); return; }
    this.entries[space.id] = { address, cwd, status };
    this.save();
    this.show({ terminal: address });
    // The old snapshot ends only once the block shows the new one.
    if (old) { await exec("sleep", ["0.3"]); hc(["kill", old]).catch(() => {}); }
  }
}
