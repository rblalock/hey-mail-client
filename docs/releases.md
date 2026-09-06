# Release internals and recovery

The [maintainer checklist](https://github.com/rblalock/hey-mail-client/blob/main/release.md) covers machine setup, version bumps, publishing, and uploads. This reference explains the scripts and failed-release recovery. Installation is in [Linux setup](linux-install.md).

## Script boundaries

- `scripts/release.mjs` requires clean, pushed `main`, matching package versions, an unused tag, and signing tools. It blocks local and active remote Actions workflows.
- It runs typecheck/tests, bumps both package files, commits, and invokes local packaging. Installed dependencies are reused; run `npm ci` beforehand.
- `scripts/package-linux.mjs` builds with publishing disabled. It records version, source revision, modified status, timestamp, and architecture; it generates the AppImage, installer, notices, and checksums.
- `scripts/sign-release.sh` retrieves the encrypted key only after build/test processes finish. It signs the exact manifest and verifies it before the release script tags or pushes. See [signing](release-signing.md).
- `scripts/release-manifest.mjs` checks the product, tag, revision, architecture, exact filenames, byte sizes, and hashes. Missing, extra, or modified assets fail verification.
- `scripts/publish-release.sh` verifies the pushed annotated tag and signed artifacts, creates a draft, uploads seven assets, then publishes. Only a draft can be completed on retry; published binaries are never replaced.

A failed build or signature prevents push/publication. A failed push does not overwrite remote work. A failed upload leaves a draft. Dry-run checks prerequisites, but does not build, sign, change files, or access the vault.

## Monitor and recover

Inspect the state before retrying. Replace `vVERSION` with the prepared tag:

```sh
git status --short --branch
git log -1 --oneline
git tag --list vVERSION
git ls-remote origin refs/heads/main refs/tags/vVERSION
gh release view vVERSION --json url,isDraft,isPrerelease,assets
```

A lost network response can hide a successful push or upload. Local changes, commits, tags, and artifacts are preserved on failure; do not reset or start another bump blindly.

- Build failure: repair the cause, rebuild the prepared version, and verify its source identity before continuing.
- Signing failure: from the same clean prepared commit, run `bash scripts/sign-release.sh vVERSION` after fixing access. The maintainer enters the password locally.
- Push failure: compare local and remote refs. If remote main changed, reconcile normally; don't force-push.
- Publication failure after a successful push: keep the original signed artifacts and retry only publication:

```sh
GH_REPO=rblalock/hey-mail-client RELEASE_TAG=vVERSION bash scripts/publish-release.sh
```

Publication needs Minisign and the public key, not 1Password or the private key. It refuses mismatched builds and published-asset replacement. If a release is already published, verify it instead of treating that refusal as a reason to overwrite it.

Use a new version for source fixes. Never move published tags. An older installer can be used for an explicit rollback, but data-format compatibility is not guaranteed and no AppImage backup is made automatically.

## Distribution limits

- Official releases currently target Linux x86-64. Local ARM64 packaging exists but is not validated for distribution.
- The AppImage includes Electron and the app, not the user's HEY CLI, Pi executable, or credentials.
- Detached Minisign signatures authenticate downloads; they are not OS certificate signing or an in-app updater.
- `0.x` releases are prereleases. They do not update installed apps automatically.
- Do not claim reproducible or broadly portable binaries from a local build.

Open gates and dated verification evidence live in [public release readiness](public-release-readiness.md).
