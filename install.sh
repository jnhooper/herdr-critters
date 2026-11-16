#!/bin/sh
# Copy the critters mods, their Herdr themes and the layout into the Herdr app home.
# A symlink doesn't work: Herdr doesn't load a mod's images through one. Run again after
# each change. Each mod folder is replaced; the layout is copied only when you don't have
# one yet, so your own changes to it stay (delete layouts/critters.json to take this one).
set -eu
repo="$(cd "$(dirname "$0")" && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

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

echo "Installed. Switch to it with: herdr-app do layout.switch --name critters"
echo "The worktree dialogs use worktrunk (wt): https://github.com/max-sixty/worktrunk"
