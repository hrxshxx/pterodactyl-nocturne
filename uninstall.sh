#!/usr/bin/env bash
# Removes the Nocturne theme: restores the original files and rebuilds.
#
#   sudo ./uninstall.sh                     # panel in /var/www/pterodactyl
#   sudo ./uninstall.sh /path/to/panel

set -euo pipefail
NOCTURNE_MODE=uninstall exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.sh" "$@"
