#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  printf 'Usage: bash install.sh /path/to/HEY-Agent-VERSION-ARCH.AppImage\n' >&2
  exit 1
fi
if [[ $EUID -eq 0 ]]; then
  printf 'Run this installer as your normal desktop user, without sudo.\n' >&2
  exit 1
fi
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
data_root="${XDG_DATA_HOME:-$HOME/.local/share}"
[[ "$data_root" = /* ]] || data_root="$HOME/.local/share"
install_dir="$data_root/hey-agent-desktop"
desktop_dir="$data_root/applications"
launcher="$HOME/.local/bin/hey-agent"
for resource in hey-agent icon.png uninstall.sh; do
  [[ -f "$source_dir/$resource" ]] || { printf 'Missing installer resource: %s\n' "$resource" >&2; exit 1; }
done
if [[ -e "$launcher" ]] && ! grep -q '^# HEY_AGENT_DESKTOP_LAUNCHER$' "$launcher"; then
  printf 'An unrelated launcher already exists at %s; move it before installing.\n' "$launcher" >&2
  exit 1
fi
mkdir -p "$install_dir" "$desktop_dir" "$HOME/.local/bin"
install -m 755 -- "$1" "$install_dir/HEY-Agent.AppImage.new"
mv -f -- "$install_dir/HEY-Agent.AppImage.new" "$install_dir/HEY-Agent.AppImage"
install -m 755 "$source_dir/hey-agent" "$launcher"
install -m 755 "$source_dir/uninstall.sh" "$install_dir/uninstall.sh"
install -m 644 "$source_dir/icon.png" "$install_dir/icon.png"
# An absolute icon path avoids theme overrides and stale placeholder SVGs.
icon_path="${install_dir//\\/\\\\}/icon.png"
# Desktop Exec uses its own escaping rules, including literal percent signs.
exec_path="${launcher//\\/\\\\}"
exec_path="${exec_path//\"/\\\"}"
exec_path="${exec_path//\$/\\\$}"
exec_path="${exec_path//\`/\\\`}"
exec_path="${exec_path//%/%%}"
printf '[Desktop Entry]\nType=Application\nName=HEY Agent\nComment=Mail, Calendar, and your Pi agent\nExec="%s"\nIcon=%s\nTerminal=false\nCategories=Office;Email;\nStartupWMClass=dev.heyagent\n' "$exec_path" "$icon_path" > "$desktop_dir/dev.heyagent.desktop"
if command -v update-desktop-database >/dev/null; then update-desktop-database "$desktop_dir"; fi
printf 'Installed HEY Agent. Open it from your application launcher, or run:\n  %s\n' "$launcher"
printf 'Settings and sessions are preserved. Close and reopen the app after an update.\n'
