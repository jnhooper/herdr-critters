// Worktree removals asked for by the wt-remove dialog. The dialog closes at once and puts
// a request in shared "wtremove.queue"; this (in the Spaces list, which stays open) does
// the work and says how it went with a toast.
//
// A request: { id, space, root, main, branch, on, claudes: [{ address, name, working }],
//              force }. Steps: quit each Claude session working in the worktree (Ctrl-C
// twice, the way Claude quits), stop the dev server if it runs from there, `wt remove`
// from the main checkout (your worktrunk hooks run; a merged branch is deleted), then
// close the space.

import { exec, hc, run, spaces, shared, setShared, notify } from "herdr";

export const QUEUE_KEY = "wtremove.queue";

const base = (p) => (p ?? "").replace(/\/+$/, "").split("/").pop();
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const sleep = (s) => exec("sleep", [String(s)]);

async function front(address) {
  const g = await hc(["get", address]).catch(() => null);
  return g?.code === 0 ? JSON.parse(g.stdout).foreground ?? null : null;
}

async function quitClaude(c) {
  const isClaude = (f) => f && /claude/i.test((f.argv ?? []).join(" "));
  if (c.working) { await hc(["interrupt", c.address]).catch(() => {}); await sleep(1); }
  await hc(["keys", c.address, "ctrl+c"]).catch(() => {});
  await sleep(0.3);
  await hc(["keys", c.address, "ctrl+c"]).catch(() => {});
  for (let n = 0; n < 8; n++) {
    await sleep(0.5);
    if (!isClaude(await front(c.address))) return;
  }
  const f = await front(c.address);
  if (isClaude(f) && f.pid) await exec("kill", ["-TERM", String(f.pid)]).catch(() => {});
}

async function remove(req) {
  for (const c of req.claudes ?? []) await quitClaude(c);
  for (const st of Object.values(shared("devserver.state") ?? {})) {
    if (st?.address && st.cwd && (st.cwd === req.root || st.cwd.startsWith(`${req.root}/`))) {
      await hc(["keys", st.address, "ctrl+c"]).catch(() => {});
      await sleep(2);
      await hc(["kill", st.address]).catch(() => {});
    }
  }
  const cmd = `command wt remove --foreground${req.force ? " --force" : ""} ${shq(req.root)}`;
  const r = await exec("/bin/zsh", ["-lic", cmd], { cwd: req.main, on: req.on ?? undefined, timeout: 600000 });
  if (r.code !== 0) {
    const why = `${r.stderr}\n${r.stdout}`.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim())
      .filter((l) => l && !/can't change option: zle/.test(l)).slice(-2).join(" ");
    throw new Error(why || "wt remove failed.");
  }
  if (spaces().some((s) => s.id === req.space)) run("space.close", { id: req.space, confirmed: true });
  const out = `${r.stdout}\n${r.stderr}`;
  return /& branch/i.test(out) ? `Branch ${req.branch} deleted.` : `Branch ${req.branch} kept (not merged).`;
}

// Called often by the Spaces mod: starts any request it isn't already doing.
export class RemoveWorker {
  constructor() { this.doing = new Set(); }

  // Space ids being removed now (for "removing…" in the list).
  removing() { return new Set((shared(QUEUE_KEY) ?? []).map((r) => r.space)); }

  tick(cx) {
    for (const req of shared(QUEUE_KEY) ?? []) {
      if (this.doing.has(req.id)) continue;
      this.doing.add(req.id);
      cx.spawn(async (cx) => {
        try {
          const detail = await remove(req);
          notify({ title: `Removed ${base(req.root)}`, body: detail, timeout: 5000 });
        } catch (e) {
          notify({ title: `Couldn't remove ${base(req.root)}`, body: String(e?.message ?? e), level: "error" });
        }
        setShared(QUEUE_KEY, (shared(QUEUE_KEY) ?? []).filter((r) => r.id !== req.id));
        this.doing.delete(req.id);
        cx.notify();
      });
    }
  }
}
