#!/bin/sh
# Copy the critters mods, their Herdr themes and the layout into the Herdr app home, and add
# the layout's keys. A symlink doesn't work: Herdr doesn't load a mod's images through one.
# Run again after each change. Each mod folder is replaced; the layout is copied only when
# you don't have one yet, so your own changes to it stay (delete layouts/critters.json to
# take this one); keys you already bound are never replaced.
set -eu
repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

# Three mods share collapse.js (mods can't import across folders).
for mod in pane-collapse-menu herdr-critters; do
  cmp -s "$repo/mods/pane-collapse/collapse.js" "$repo/mods/$mod/collapse.js" ||
    { echo "mods/*/collapse.js differ; make them equal first." >&2; exit 1; }
done

for mod in "$repo"/mods/*/; do
  name="$(basename "$mod")"
  mkdir -p "$home/mods/$name"
  # mod.json first: a mod folder without one gets placed in the window by Herdr.
  cp "$mod/mod.json" "$home/mods/$name/mod.json"
  # A theme pack installed separately (themes/<id> not in this repo) is kept.
  rsync -a --delete --filter="P /themes/*/" --exclude jsconfig.json --exclude gpui-kit.d.ts "$mod" "$home/mods/$name/"
  herdr-app check "$home/mods/$name"
done

mkdir -p "$home/themes" "$home/layouts"
cp "$repo"/themes/critters-*.json "$home/themes/"
[ -e "$home/layouts/critters.json" ] || cp "$repo/layouts/critters.json" "$home/layouts/"

# Add the keys from keys.json that are not bound yet. Never replace a binding.
python3 - "$repo/keys.json" "$home/keys.json" <<'PY'
import json, os, sys
src, dest = sys.argv[1:3]
theirs = json.load(open(dest)) if os.path.exists(dest) else {}
added = False
for section, binds in json.load(open(src)).items():
    have = theirs.setdefault(section, {})
    for key, action in binds.items():
        if key not in have:
            have[key] = action
            added = True
            print(f"keys.json: added {section} {key} = {action}")
        elif have[key] != action:
            print(f"keys.json: kept {section} {key} = {have[key]} (not {action})")
if added:
    tmp = dest + ".tmp"
    with open(tmp, "w") as f:
        json.dump(theirs, f, indent=2)
        f.write("\n")
    os.replace(tmp, dest)
PY

echo "Installed. Switch to it with: herdr-app do layout.switch --name critters"
echo "The worktree dialogs use worktrunk (wt): https://github.com/max-sixty/worktrunk"
