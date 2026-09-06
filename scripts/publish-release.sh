#!/usr/bin/env bash
set -euo pipefail
: "${GH_REPO:?GitHub repository required}"
: "${RELEASE_TAG:?Release tag required}"
[[ "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || exit 1
# Publishing/retrying must use the exact build and the already-pushed tag.
tag_revision="$(git rev-parse "$RELEASE_TAG^{commit}")"
remote_revision="$(git ls-remote origin "refs/tags/$RELEASE_TAG^{}" | cut -f1)"
[[ "$tag_revision" == "$remote_revision" ]] || { printf 'Release tag is not pushed or differs from origin.\n' >&2; exit 1; }
RELEASE_REVISION="$tag_revision" node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { verifyReleaseBuild } from './scripts/release-version.mjs';
verifyReleaseBuild(process.env.RELEASE_TAG, JSON.parse(readFileSync('release/build-info.json', 'utf8')), process.env.RELEASE_REVISION);
JS
version="${RELEASE_TAG#v}"
node scripts/release-manifest.mjs verify "$RELEASE_TAG" "$tag_revision"
bundle="HEY-Agent-$version-linux-x86_64.tar.gz"
appimage="HEY-Agent-$version-x86_64.AppImage"
for asset in "$bundle" "$bundle.sha256" "$appimage" "$appimage.sha256" build-info.json; do
  [[ -s "release/$asset" ]] || { printf 'Missing release asset: %s\n' "$asset" >&2; exit 1; }
done
(cd release && sha256sum -c "$bundle.sha256" && sha256sum -c "$appimage.sha256")

# Reruns may finish a draft, but never replace already-published binaries.
if state="$(gh release view "$RELEASE_TAG" --json isDraft --jq '.isDraft' 2>/dev/null)"; then
  if [[ "$state" == false ]]; then
    printf '%s is already published; leaving its assets unchanged.\n' "$RELEASE_TAG"
    exit 0
  fi
else
  # This repo often uses direct commits, which GitHub's PR-only summaries miss.
  previous=""
  published_tags="$(gh release list --exclude-drafts --limit 100 --json tagName --jq '.[].tagName')"
  while IFS= read -r candidate; do
    [[ "$candidate" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ && "$candidate" != "$RELEASE_TAG" ]] || continue
    if git merge-base --is-ancestor "$candidate" "$RELEASE_TAG"; then previous="$candidate"; break; fi
  done <<< "$published_tags"
  range="$RELEASE_TAG"
  [[ -z "$previous" ]] || range="$previous..$RELEASE_TAG"
  {
    printf 'Linux x86-64 testing build for Intel/AMD machines. Download `%s` for the installer, not the source-code archive. HEY CLI and Pi must be installed and configured separately.\n\n' "$bundle"
    printf 'Installation: https://github.com/%s/blob/%s/docs/linux-install.md\n\n## Changes\n\n' "$GH_REPO" "$RELEASE_TAG"
    git log --format='- %s (%h)' --invert-grep --grep='^chore(release):' "$range"
  } > release/release-notes.md
  gh release create "$RELEASE_TAG" --verify-tag --draft --generate-notes \
    --title "HEY Agent $RELEASE_TAG" \
    --notes-file release/release-notes.md
fi
gh release upload "$RELEASE_TAG" "release/$bundle" "release/$bundle.sha256" "release/$appimage" "release/$appimage.sha256" release/build-info.json release/release-manifest.json release/release-manifest.json.minisig --clobber
if [[ "$RELEASE_TAG" == v0.* ]]; then
  gh release edit "$RELEASE_TAG" --draft=false --prerelease --latest=false
else
  gh release edit "$RELEASE_TAG" --draft=false --prerelease=false --latest
fi
gh release view "$RELEASE_TAG" --json url --jq '.url'
