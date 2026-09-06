# HEY Agent for Linux

Early testing software. The app bundles Electron, its Pi extension, and all six built-in Helpers. It runs independently of this repository or a development server. Personal Helpers are saved locally in Settings; see [Helper setup and testing](helpers-plan.md).

## Requirements on each machine

- A recent Linux desktop on x86-64 (Intel/AMD) or ARM64, using a matching build. The initial verified platform is x86-64 Omarchy.
- HEY CLI 1.4.0 or newer, installed and signed in on that machine.
- Pi installed and configured with a working model. This release is verified with Pi 0.84.4. A standalone Pi binary does not need a separate Node installation; an npm-installed Pi does.
- The HEY skill installed for Pi through HEY's setup flow. The app packages its focused Helpers separately.
- AppImage runtime support, including FUSE 2 (`libfuse.so.2`) and the normal Electron desktop libraries. Omarchy on the test machine already provides these.

For a new machine, follow the [HEY CLI setup](https://github.com/basecamp/hey-cli) and your normal Pi installation/login process. Complete interactive authentication in a terminal. The desktop app uses those local credentials.

## Build

On a machine with the checkout, Node 22.12 or newer, and npm:

```sh
npm ci
npm run package:linux
```

Build on the same CPU architecture as the destination machine. Output includes `release/HEY-Agent-VERSION-x86_64.AppImage` (or `arm64`) and a complete `HEY-Agent-VERSION-linux-x86_64.tar.gz` installer bundle. `VERSION` comes from package.json. `release/build-info.json` records the source revision, whether it had local changes, architecture, and build time. SHA-256 files identify the downloads and all bundled installer files. This build command does not publish anything; see [releasing](releases.md) for local build-and-upload releases without GitHub Actions.

## Install or update

For an official release, download the installer bundle, matching `.sha256`, `release-manifest.json`, and `release-manifest.json.minisig` from [GitHub Releases](https://github.com/rblalock/hey-mail-client/releases). Follow [signature verification](release-signing.md#download-verification) using Minisign and the already trusted public key, and compare the bundle's hash to the authenticated manifest **before extracting or executing it**. A checksum downloaded alongside an unsigned file does not authenticate its publisher. Until the first signed release is published, only the source-build path is available.

For your own local source build, use the bundle and checksum produced by your build machine; signing is not required. Do not confuse GitHub's automatic source-code archive with an installer bundle. On the destination machine, use a fresh folder, replacing `VERSION` below with the release number:

```sh
sha256sum -c HEY-Agent-VERSION-linux-x86_64.tar.gz.sha256
mkdir hey-agent-install
tar -xzf HEY-Agent-VERSION-linux-x86_64.tar.gz -C hey-agent-install
cd hey-agent-install
sha256sum -c SHA256SUMS
bash install.sh ./HEY-Agent-VERSION-x86_64.AppImage
```

Because the repository is private and 0.x releases are marked prerelease, command-line downloads use authenticated `gh`, not a public “latest” URL:

```sh
gh release download vVERSION --repo rblalock/hey-mail-client \
  --pattern 'HEY-Agent-*-linux-x86_64.tar.gz*' \
  --pattern 'release-manifest.json*'
```

For your own source builds, you can copy the loose AppImage and accompanying `install.sh`, `uninstall.sh`, `hey-agent`, and `icon.png` together from `release/`. For the initial local 0.1.0 build:

```sh
bash install.sh ./HEY-Agent-0.1.0-x86_64.AppImage
```

From the build checkout, use:

```sh
bash release/install.sh release/HEY-Agent-0.1.0-x86_64.AppImage
```

No sudo is needed. Open **HEY Agent** from the desktop application launcher or run `~/.local/bin/hey-agent`. It has a separate launcher from HEY's web app and TUI. Close and reopen it after installing an update. The same installer replaces the installed binary; settings and conversations are preserved. Opening the launcher again focuses the existing window.

For now, updates are manual: build or copy a new AppImage and rerun the installer. Keep an older AppImage if you want to roll back with the same command. There is no autostart or background process after closing the window.

## Data and diagnostics

The install uses the XDG directories when configured; otherwise:

- Application: `~/.local/share/hey-agent-desktop/HEY-Agent.AppImage`
- Launcher: `~/.local/bin/hey-agent`
- Desktop entry: `~/.local/share/applications/dev.heyagent.desktop`
- Settings: `~/.config/hey-agent-app/`
- App chat metadata: `~/.local/state/hey-agent-app/chats.json`
- Working files: `~/.local/share/hey-agent-app/workspace/`
- Launcher log: `~/.local/state/hey-agent-app/logs/desktop.log`

The existing development settings and sessions use these same paths, so this machine retains them, including personal Helpers and their preferences. Pi owns its transcripts and model authentication; HEY owns its login and synced mail/Calendar data. App settings, authored Helpers, and Pi transcripts do not automatically sync between computers.

The app discovers executables from the graphical PATH and standard user-local/mise locations. For a custom installation, launch with `HEY_AGENT_PI_PATH=/absolute/path/to/pi` or `HEY_AGENT_HEY_PATH=/absolute/path/to/hey`; make sure `hey` is also on Pi's PATH so its tool can execute it. If Pi was installed through npm, its `node` must be visible from the graphical session too.

Use Settings to check runtime availability. The launcher log includes the packaged build identity and startup errors; review it before sharing because errors may contain local paths or mail metadata. To see output directly, run the installed AppImage in a terminal.

If FUSE is unavailable, the AppImage runtime also supports `--appimage-extract-and-run`; installing the distro's FUSE compatibility package is preferable for regular use. No sandbox-disabling flags are added by the installer.

## Remove

Close the app, then run:

```sh
bash ~/.local/share/hey-agent-desktop/uninstall.sh
```

This removes only the installed application, launcher, and icon. Your settings, sessions, HEY login, and Pi configuration remain available for a reinstall. For a custom `XDG_DATA_HOME`, find the uninstaller under that directory instead.
