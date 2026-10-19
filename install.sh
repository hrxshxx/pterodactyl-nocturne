#!/usr/bin/env bash
# Installs the Nocturne theme on an existing Pterodactyl 1.11.x panel.
#
#   sudo ./install.sh                       # panel in /var/www/pterodactyl
#   sudo ./install.sh /path/to/panel
#
# What it does: backs up the four files it changes, patches them, rebuilds the
# panel's frontend with yarn, and clears Laravel's view cache. The panel stays
# up throughout: the new bundle is written next to the old one and only takes
# over once the build finishes. Re-run it after editing nocturne.config.json or
# after upgrading the panel.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL="${1:-/var/www/pterodactyl}"
MODE="${NOCTURNE_MODE:-install}"

say() { printf '\033[38;5;141mnocturne\033[0m: %s\n' "$*"; }
die() { printf '\033[31mnocturne\033[0m: %s\n' "$*" >&2; exit 1; }

[[ -f "$PANEL/artisan" && -f "$PANEL/package.json" ]] || die "$PANEL doesn't look like a Pterodactyl panel (no artisan/package.json)."

# --------------------------------------------------------------- toolchain ---

command -v php >/dev/null || die "php is not on PATH."
command -v node >/dev/null || die "Node.js 16 or newer is required to build the panel frontend.
  Debian/Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 16 )) || die "Node.js $(node -v) is too old; 16 or newer is required."

if ! command -v yarn >/dev/null; then
    say "yarn not found; installing it globally with npm."
    npm install -g yarn >/dev/null
fi

# Upstream builds with webpack 4, which needs the legacy OpenSSL provider on Node 17+.
if (( NODE_MAJOR >= 17 )); then
    export NODE_OPTIONS="${NODE_OPTIONS:-} --openssl-legacy-provider"
fi

# ------------------------------------------------------------------- patch ---

if [[ "$MODE" == "uninstall" ]]; then
    node "$HERE/scripts/apply.mjs" "$PANEL" --restore
else
    node "$HERE/scripts/apply.mjs" "$PANEL"
fi

# ------------------------------------------------------------------- build ---

OWNER="$(stat -c '%U:%G' "$PANEL" 2>/dev/null || stat -f '%Su:%Sg' "$PANEL")"

cd "$PANEL"

say "installing frontend dependencies (first run takes a few minutes)…"
yarn install --frozen-lockfile --ignore-engines --network-timeout 600000 >/dev/null

# Upstream's build:production wipes public/assets before building, which takes
# the panel offline for minutes. Calling webpack directly skips that: the
# manifest only points at the new files once they exist.
say "building the panel frontend…"
if ! NODE_ENV=production ./node_modules/.bin/webpack --mode production >/tmp/nocturne-build.log 2>&1; then
    tail -n 30 /tmp/nocturne-build.log >&2
    die "the build failed (full log: /tmp/nocturne-build.log). Small VPSes may need 2 GB of RAM or swap for webpack."
fi

php artisan view:clear >/dev/null

if [[ "$(id -u)" == "0" ]]; then
    chown -R "$OWNER" "$PANEL/public" "$PANEL/resources" "$PANEL/tailwind.config.js" "$PANEL/.nocturne-backup" 2>/dev/null || true
fi

if [[ "$MODE" == "uninstall" ]]; then
    say "removed. The panel is back to its original look."
else
    say "installed. Hard-refresh the panel (Ctrl/Cmd+Shift+R) to see it."
fi
