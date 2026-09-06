# HEY Agent

A keyboard-first desktop app for HEY mail and Calendar, with your Pi agent alongside your inbox.

Work through your inbox, plan your day, and get help with the reply you've been putting off, all in one place.

- Navigate, search, and organize mail with customizable keyboard shortcuts.
- Manage your HEY calendar alongside your conversations.
- Ask Helpers (Agents) for a Daily Brief, meeting prep, reply coaching, and calendar triage.
- Create your own Helpers (Agents) with instructions for the work you do often.
- Review and edit AI-written drafts, including a comparison of what changed.
- Continue work in another agent with a prepared handoff prompt.

The tested platform is **x86-64 Omarchy** (Intel or AMD). This is an independent project, not an official HEY, Basecamp, or Omarchy app.

## Install

### Copy and paste for your agent

Have a local coding agent? Give it this prompt to handle setup and installation:

```text
Help me install HEY Agent from https://github.com/rblalock/hey-mail-client.
Follow README.md and docs/linux-install.md. Check my Linux architecture,
HEY CLI, Pi, and HEY skill; help me set up anything missing. Let me handle
logins and passwords, and ask before system changes or closing an app.

Choose a compatible GitHub release and tell me its version. Follow
docs/release-signing.md to verify the signature with a trusted public key
and check the installer hash before extracting or running it. Stop if
verification fails; don't bypass it with an unsigned build.
```

### Download the AppImage

Get the Linux x86-64 AppImage from [GitHub Releases](https://github.com/rblalock/hey-mail-client/releases). Each release includes a standalone app and an installer bundle that adds a desktop launcher.

1. Download `HEY-Agent-VERSION-x86_64.AppImage`, `release-manifest.json`, and `release-manifest.json.minisig` from the same release.
2. [Verify the signature and AppImage hash](docs/release-signing.md#download-verification) before running it. Verification uses Minisign and the trusted public key; you don't need a private signing key or 1Password.
3. In your download directory, replace `VERSION` with the version you downloaded:

```sh
chmod +x HEY-Agent-VERSION-x86_64.AppImage
./HEY-Agent-VERSION-x86_64.AppImage
```

For a desktop launcher, download `HEY-Agent-VERSION-linux-x86_64.tar.gz` instead and follow [the installer steps](docs/linux-install.md#install-or-update). GitHub's “Source code” archives are not installers. Early `0.x` releases are marked prerelease.

### Requirements

- Linux x86-64 (tested on Omarchy).
- A HEY account and [HEY CLI](https://github.com/basecamp/hey-cli), installed and signed in.
- [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent), connected to a model.
- The HEY skill installed for Pi.
- FUSE 2 for running AppImages.

## Manual build from source

To build your own AppImage, install Git, Node.js 22.12 or newer, and npm. Use Linux with the same CPU architecture as the destination machine.

```sh
git clone https://github.com/rblalock/hey-mail-client.git
cd hey-mail-client
npm ci
npm run package:linux
```

For a published version, check out its exact `vVERSION` tag before `npm ci`. Otherwise, `main` is a development snapshot. Dependency installation runs scripts, so use source and dependencies you trust.

Output goes into `release/`. The build prints the exact install command, for example:

```sh
bash release/install.sh release/HEY-Agent-VERSION-x86_64.AppImage
```

Replace `VERSION` with the version in `package.json`. Your own source build is unsigned and needs no Minisign, 1Password account, or publishing credentials. Nothing is uploaded by these commands.

## Develop locally

Clone the repository using the commands above, then run these from the checkout. You don't need to package or install an AppImage to develop:

```sh
npm ci
npm run dev
```

Development and installed builds share local app data by default. Close the installed app before launching the development build. This is not an isolated test profile.

Check your changes with:

```sh
npm run typecheck
npm test
git diff --check
```

Use `npm run test:watch` while working on tests, or `npm run build` to check the production build without packaging it.

## Using and updating the app

With the installer bundle, open **HEY Agent** from your application launcher or run `~/.local/bin/hey-agent`. With a standalone AppImage, run the file directly.

`Ctrl+K` opens commands and Helpers. `Ctrl+Shift+L` focuses AI chat. You can change shortcuts in Settings, reached from the menu beside your profile. Check **Local services** there if HEY or Pi isn't connecting.

Updates are manual: verify and install the new release, then close and reopen the app. Settings and chats stay in place. See [installation, updates, and removal](docs/linux-install.md) for the full steps.

## Your data

HEY CLI owns your HEY login; Pi owns model authentication and transcripts. App settings, drafts, personal Helpers, and chat metadata are stored locally and do not automatically sync between computers.

AI requests send relevant context to the model provider you configure in Pi. Agents can run tools against your real account; review requests and suggested actions accordingly. A release signature verifies the publisher and files, not the safety of an agent's decisions.

See [Linux installation](docs/linux-install.md#data-and-diagnostics) for data paths, logs, custom executable paths, and uninstall instructions. Uninstalling the app leaves your settings, chats, and CLI logins intact.

## Contributing and releases

Use synthetic mail and calendar fixtures in tests. Before submitting changes, run `npm run typecheck`, `npm test`, and `git diff --check`. Don't post real mail, credentials, or unredacted logs. See [Security](SECURITY.md) for reporting concerns.

Maintainers and release agents: start with [release.md](release.md). Builds, signing, and uploads run locally; no GitHub Actions or paid CI is required. [Public release readiness](docs/public-release-readiness.md) tracks the remaining distribution checks.

## License

The app's original code is [MIT licensed](LICENSE). Dependencies have their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). The license does not grant rights to third-party names or trademarks.
