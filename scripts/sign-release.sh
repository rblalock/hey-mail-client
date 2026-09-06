#!/usr/bin/env bash
set -euo pipefail
# This step must run separately, AFTER all npm/build/test processes finish.
# Do not wrap npm or the entire release command in `op run`.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
: "${HEY_AGENT_SIGNING_KEY_REF:?Set a local op:// reference to the encrypted Minisign key; see docs/release-signing.md}"
[[ "$HEY_AGENT_SIGNING_KEY_REF" == op://* ]] || { printf 'Expected a 1Password secret reference, not a private key.\n' >&2; exit 1; }
[[ -f resources/release.pub ]] || { printf 'Missing trusted resources/release.pub. Complete signing setup first.\n' >&2; exit 1; }
command -v op >/dev/null
command -v minisign >/dev/null
tag="${1:?Release tag required}"
revision="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain)" ]] || { printf 'Sign only a clean, reviewed source checkout.\n' >&2; exit 1; }
node scripts/release-manifest.mjs prepare "$tag" "$revision"

umask 077
signing_dir="$(mktemp -d "${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/hey-agent-signing.XXXXXX")"
cleanup() {
  # Only the exact temporary key created by this invocation is removed.
  rm -f -- "$signing_dir/release.key"
  rmdir -- "$signing_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Authorize 1Password access for the release key. Then unlock Minisign directly in this terminal.\n'
op read "$HEY_AGENT_SIGNING_KEY_REF" --out-file "$signing_dir/release.key" --file-mode 0600
minisign -S -s "$signing_dir/release.key" -m release/release-manifest.json \
  -x release/release-manifest.json.minisig -t "HEY Agent $tag $revision"
node scripts/release-manifest.mjs verify "$tag" "$revision"
