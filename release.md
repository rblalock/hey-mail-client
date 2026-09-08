# Release HEY Agent

For maintainers and agents publishing an official release. To build or install the app without publishing, use the [README](README.md).

Build, test, and sign on a local Linux x86-64 machine. GitHub hosts source and downloads. Keep GitHub Actions disabled; do not add a hosted or self-hosted runner.

## Set up a release machine

You can release from either an Intel/AMD laptop or desktop using the same signing key. Release from one machine at a time.

- Clone the current repository and install Git, Node.js 22.12 or newer, npm, GitHub CLI, and Minisign.
- Authenticate Git for pushing and `gh` for creating releases. Check with `gh auth status`; do not print tokens.
- Ask the maintainer for the private signing setup for this machine. Keep key storage and access instructions outside this repository.
- Use the existing encrypted signing key. Do not generate a new key for each computer. `resources/release.pub` must be committed and match that key.
- HEY CLI and Pi are needed to run-test the app, not to package or sign it.

After a history replacement, use a fresh clone. Do not merge or push the retired history back into the repository.

## Publish a version

Before making a private repository public, inspect its old refs and release downloads as well as current source. Rewriting main does not remove cached commits or immutable release assets. Enable private vulnerability reporting when the repository becomes public.

Start on clean `main` with reviewed changes committed and pushed. Confirm local `HEAD` equals GitHub's `main`; stop and reconcile if it doesn't. Don't force-push to satisfy this requirement.

```sh
git status --short --branch
git rev-parse HEAD
git ls-remote origin refs/heads/main
npm ci
npm run release -- patch --dry-run
```

Dry-run checks prerequisites and remote state without changing files or retrieving the signing key. It does not build, test, or prove the key can be unlocked.

When ready to publish, run this in a terminal where the maintainer can unlock signing:

```sh
npm run release -- patch
```

Use `patch` for fixes, `minor` for new features, and `major` only for an agreed breaking release. The command increments the current version; it doesn't publish it unchanged. All `0.x` releases are prereleases.

The script runs checks, bumps both package files, commits the version, builds, signs and verifies the artifacts, creates an annotated tag, and pushes the commit and tag atomically. It then creates a draft release, uploads the assets, and publishes it. It refuses dirty or out-of-sync source, reused tags, and local or active remote Actions workflows.

## What goes to GitHub

The source commit and version tag go to Git. Only the public verification key belongs in source control.

Each release gets these seven assets (`VERSION` is the release number):

- `HEY-Agent-VERSION-linux-x86_64.tar.gz`
- `HEY-Agent-VERSION-linux-x86_64.tar.gz.sha256`
- `HEY-Agent-VERSION-x86_64.AppImage`
- `HEY-Agent-VERSION-x86_64.AppImage.sha256`
- `build-info.json`
- `release-manifest.json`
- `release-manifest.json.minisig`

The installer bundle includes the app, launcher, icon, install/uninstall scripts, installation and signature instructions, and license notices. It does not include internal plans or maintainer checklists. Build info records the version, commit, architecture, build time, and modified status. The signed manifest identifies and hashes the first five files. GitHub also provides automatic source archives for the tag.

No private key, password, vault export, HEY login, mail, app settings, or Pi transcripts belong in these uploads. A history recovery bundle must stay private and outside the repository. These rules still apply when the repo becomes public.

## Verify the published release

Replace `vVERSION` with the tag that was just published:

```sh
gh release view vVERSION --repo rblalock/hey-mail-client \
  --json url,isDraft,isPrerelease,assets
```

Confirm it is no longer a draft and has all seven expected assets. Download that exact release into a fresh directory; verify its signature and downloaded hashes using [download verification](docs/release-signing.md#download-verification). Don't treat verification of the local build as verification of the uploaded files.

For the first release, also install the downloaded bundle on the second machine and check startup, Local services, and preservation of existing settings/chats. Record anything untested. No automatic updater is shipped; installation and restart remain manual.

## If it stops partway through

Don't bump again immediately. Check local changes, the prepared commit/tag, remote refs, and the GitHub release. A lost network response can hide a successful push or upload.

If the tag is already pushed and only publication failed, keep the original signed artifacts and retry:

```sh
GH_REPO=rblalock/hey-mail-client RELEASE_TAG=vVERSION bash scripts/publish-release.sh
```

This can finish a draft; it refuses to overwrite a published release. It needs Minisign and the public key, but no private key or vault access. Never move published tags or replace published binaries. Use a new version for a fix.

- Build failure: fix the cause and rebuild the prepared version. Verify its recorded source revision before continuing.
- Signing failure: from the same clean prepared commit, retry `bash scripts/sign-release.sh vVERSION` after fixing access.
- Push failure: compare local and remote refs and reconcile normally. Do not force-push or bump again blindly.

## Instructions for agents

- “Commit and push” is not permission to publish a release. Confirm the release scope and version bump when unclear.
- Inspect the working tree first. Preserve unrelated changes; don't reset, force-push, change visibility, or scrub history as part of a routine release.
- Use the existing scripts. Do not invent a parallel release path or bypass signing, tests, or workflow guards.
- Use only the privately configured signing source. Never browse unrelated credentials, print secret values, capture the password prompt, or store credentials in logs.
- Let the maintainer unlock signing in an interactive terminal. If that is unavailable, stop before signing rather than automating the password.
- Verify the remote commit/tag and downloaded release assets. Report the version, commit, release URL, checks completed, and remaining manual tests.
- Do not install over or restart a running app without permission. Don't test by sending mail or changing real calendar data.
