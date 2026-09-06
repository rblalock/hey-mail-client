#!/usr/bin/env bash
set -euo pipefail
data_root="${XDG_DATA_HOME:-$HOME/.local/share}"
[[ "$data_root" = /* ]] || data_root="$HOME/.local/share"
# Only the installed app files are removed. Mail, Pi, settings, and sessions stay.
rm -f -- "$HOME/.local/bin/hey-agent" "$data_root/applications/dev.heyagent.desktop" "$data_root/icons/hicolor/scalable/apps/dev.heyagent.desktop.svg" "$data_root/hey-agent-desktop/icon.png" "$data_root/hey-agent-desktop/HEY-Agent.AppImage" "$data_root/hey-agent-desktop/uninstall.sh"
rmdir -- "$data_root/hey-agent-desktop" 2>/dev/null || true
if command -v update-desktop-database >/dev/null; then update-desktop-database "$data_root/applications"; fi
printf 'HEY Agent removed. Your settings, sessions, HEY login, and Pi configuration are preserved.\n'
