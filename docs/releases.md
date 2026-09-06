# Releasing HEY Agent

Build and test on our own Linux machine; use GitHub only for source, tags, release history, and downloadable installers. **No GitHub Actions, hosted CI, self-hosted runner, or Actions artifact storage.** Keep `.github/workflows` empty. The release command refuses local workflow files or active remote workflows to avoid accidental CI usage.

HEY Agent is the product name. The desktop/application identity stays `dev.heyagent.desktop`; existing user data stays under `hey-agent-app`. Releases do not rename or migrate those directories.

## The routine

Ask Codex to **release the current changes**. The agent should check that no workflows will run, commit and push reviewed work, choose the appropriate bump, execute the local release command through completion, verify release assets, and report the URL. A request to **commit and push** alone does not authorize a release.

From a clean, pushed `main` on Linux x86-64, with npm dependencies installed and GitHub CLI authenticated:

```sh
npm run release -- patch --dry-run
npm run release -- patch
```

- `patch`: fixes and polish (`0.1.0` → `0.1.1`); default when omitted.
- `minor`: new capabilities (`0.1.1` → `0.2.0`).
- `major`: intentional breaking changes / an explicitly approved 1.0 release.

No special commit-message format, release bot, paid build service, or manual changelog editing is required. Git authentication needs permission to push main and tags; `gh` needs permission to create/upload releases. Credentials stay local and are not bundled. Official releases also require the one-time [1Password/Minisign signing setup](release-signing.md). Source builds remain independent of that setup.

The command validates both package versions, requires clean main equal to origin/main, rejects reused tags and Actions workflows, runs typechecking/tests locally, bumps package.json and package-lock.json together, commits, and builds the installer locally. It verifies clean build metadata matching that exact source commit/version/architecture, then signs a manifest of the exact artifacts using the maintainer's 1Password key. It verifies the signature and hashes before tagging and atomically pushing. It then uploads and publishes the release directly. A failed build or signature check does not push or publish; a failed push never force-overwrites remote work. Dry-run changes no package files, commits, tags, or remote state and does not access the vault; it still checks prerequisites.

## Direct upload, no CI

Normal pushes and version tags do not run CI. All testing and packaging happen on the local computer. No mailbox credentials, Pi credentials, or user data enter the build. The only remote publication operations are pushing source/tags and using GitHub Releases.

After a successful build and push, the local publisher verifies the remote annotated tag and asset checksums, creates a draft GitHub release with generated notes (including direct commits), uploads all assets, then publishes it. Failed uploads leave a draft, not a published release with missing downloads. Retrying publication can finish that draft; already-published assets are never overwritten.

All `0.x` versions are marked **prerelease** for early testing. This does not auto-update installed apps. GitHub notes, tags, and embedded build-info.json provide release history; the signed manifest authenticates each download's hash and release identity. The repository/downloads remain private until the separate public-readiness review and visibility change. These are Release assets, not Git LFS or Actions artifacts. [GitHub documents release storage and bandwidth separately](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas).

Assets:

- `HEY-Agent-VERSION-linux-x86_64.tar.gz`: complete installer bundle, including README, launcher, icon, installer/uninstaller, build identity, and inner checksums.
- The bundle's `.sha256` file: verify before extracting.
- A standalone `.AppImage` and its `.sha256` file for existing installations/manual use.
- `build-info.json`: source revision, version, architecture, clean/modified status, and build timestamp.
- `release-manifest.json` and `.minisig`: signed release identity and hashes for all five assets above. Verify with the already trusted public key before extracting or running an installer. The bundle also contains the MIT license and generated dependency notices.

The artifact is self-contained as an Electron app, not as a complete HEY/Pi installation. Official downloads use detached Minisign signatures, not OS certificate-based signing; they are not auto-updating. Locally built snapshots remain unsigned. Both current machines use x86-64; other architectures/OSes are out of scope. Because builds run on our own machine, broader Linux compatibility needs testing; do not claim they were built on Ubuntu or in a standardized CI image. Run `npm ci` before release preparation; the release command currently uses installed dependencies rather than provisioning an isolated build environment.

## Monitor and recover

```sh
gh release view vVERSION --json url,isDraft,isPrerelease,assets
```

If upload fails after the tag was pushed, keep the existing built files and retry publication without bumping again:

```sh
GH_REPO=rblalock/hey-mail-client RELEASE_TAG=vVERSION bash scripts/publish-release.sh
```

The publisher validates the signature, exact asset hashes, and build identity against the pushed annotated tag. It needs Minisign and the public key, but no private key or 1Password access. If files were rebuilt from different source, it refuses them. Fix source problems in a new release; never replace published binaries or move published tags. Older published installers can be downloaded for an explicit rollback; no automatic local AppImage backup is made. Data-format changes may limit rollback compatibility.

If preparation or push fails, inspect `git status`, `git log -1`, the local tag, and `git ls-remote origin refs/heads/main refs/tags/vVERSION` first. A lost network response may hide a successful push. Local preparation is preserved, not silently reset. For a failed local build, fix/rebuild and verify the prepared version before tagging/pushing; do not blindly run another bump. If main moved remotely, reconcile normally without force-pushing. Ask the agent to handle recovery rather than manually deleting work.

## Remaining proof

Local tests exercise version/tag guards, build/signature failure before push, workflow-cost guards, manifest identity/tampering checks, draft/upload failure handling, and published-release preservation with isolated Git repositories and a fake GitHub CLI. Real local packaging is checked separately. The production key was enrolled and passed a real local signing/tampering/cleanup check on 2026-09-06; its public key is included in the fresh root commit. The first actual signed GitHub upload/download, public-repository readiness, and a real cross-machine installation remain explicit release gates. No Actions job is needed. See [readiness](public-release-readiness.md).

Installation and manual updates: [Linux installation](linux-install.md).
