# Public release readiness

Status: preparation in progress. Do not change repository visibility or publish a release merely because these files exist. The maintainer chose MIT, source-build support, signed downloadable releases, and a separately verified updater later.

## Required before making the repository public

- [x] Add the MIT license and npm package metadata.
- [x] Document building without any release credentials or 1Password account.
- [x] Replace the known personal account/email examples in the current source/docs with synthetic data.
- [x] Replace GitHub main with one reviewed fresh root commit, using a GitHub noreply author address (2026-09-06, maintainer authorized). The old-history recovery bundle stays private and outside the repository. Repository visibility is unchanged.
- [ ] Verify GitHub branches/tags/PR refs, release assets, issues, attachments, and other repository surfaces before visibility changes. Replacing main does not guarantee GitHub immediately erases cached/dangling commits. If old commits must be unrecoverable, use a new public repository and keep this one private, or follow GitHub's removal process.
- [ ] Confirm the icon/name's third-party brand considerations; an MIT code license does not confer trademark rights. See icon provenance and third-party notices.
- [ ] Resolve the missing upstream license text for `launder@1.7.1` (declares MIT; current npm package and upstream package directory omit a license file). The generated notice preserves available metadata and flags this gap.
- [ ] Enable and verify a private vulnerability-reporting route before inviting reports.

## Audit evidence (2026-09-05)

- Baseline: the private 31-commit development history before the requested fresh start. Exact old refs are retained only in the private recovery bundle.
- Gitleaks 8.30.1 scanned all 31 commits reachable from local refs: no credential findings. Command: `gitleaks git . --log-opts=--all --redact=100`. This is a detector result, not proof of absence of all secrets or personal data.
- Remote ref inventory at review time contained only `main`; no tags. Re-check before publication.
- GitHub read-only inventory found no pull requests, issues, or releases at review time. This does not prove that old dangling Git objects have been erased.
- Manual targeted review found a real account ID/email in a planning document, a personal email in a test, and a personal author/committer email in history. Current examples were sanitized; a new root history was requested rather than retaining the old commits.
- Historical tracked-file inventory contains application code, documentation, synthetic fixtures, lockfiles, and icon artwork. No tracked `.env`, credential-store, mailbox database, or Pi transcript file was identified. Binary artwork and non-Git repository surfaces require separate consideration.
- Visual inspection of both tracked design PNGs found icon concepts, not mail/account screenshots. Current candidate source export also passed Gitleaks with no findings.
- `npm audit` and `npm audit --omit=dev` reported zero known vulnerabilities at review time. This does not assess app logic, malicious packages, or unknown vulnerabilities.
- Production dependency notice inventory: 172 installed packages. Licenses declared MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, or OFL-1.1. Boolbase's omitted notice was restored from its upstream license; lru_map's license is in its README; launder remains flagged.

## Signed release gates

- [x] Manifest binds product, version, architecture, source commit, filenames, sizes, and hashes.
- [x] Publication fails closed on missing/invalid signature or mismatched artifacts.
- [x] Source builds do not require release secrets. Key retrieval happens only after build/test processes finish.
- [x] Real Minisign 0.12 integration test passed with a disposable encrypted test key and synthetic 1Password CLI: signature verification, modified manifest/artifact rejection, wrong-passphrase rejection, and temporary-key cleanup on success/failure. No real vault was accessed.
- [x] Enroll the real encrypted signing key in the maintainer's personal 1Password and match its public key to `resources/release.pub`. See [setup](release-signing.md).
- [x] Real signing check passed on 2026-09-06: retrieved the encrypted attachment, signed a harmless test message with the maintainer entering the password locally, verified the signature, rejected an altered message, and removed the temporary key.
- [x] Include the verified public key in the fresh root commit. No private key, password, or actual vault reference belongs in the repository.
- [ ] Complete the first signed GitHub publication/download and install on the second Omarchy machine. The local signing check does not prove upload or cross-machine behavior.
- [ ] Enable GitHub immutable releases and verify the setting. Current script preservation rules alone are not server-side immutability.
- [x] Fresh source export with a separate Git root, `npm ci`, typecheck, and AppImage/installer packaging passed on x86-64 Omarchy without signing configuration. Do not claim reproducible or broadly portable Linux binaries without further work.
- [x] Full local test run passed: 72 files / 417 tests, including the opt-in real Minisign integration test. Ordinary runs skip that one test unless `HEY_AGENT_TEST_MINISIGN` points to a trusted executable.

## Later: in-app updates

Use established AppImage update machinery with publisher-signature verification, no downgrade fallback, clear version/error UI, and user-approved restart. Verify a real installed version-to-version update, interruption behavior, and preservation of app data before shipping. Pi may invoke that controlled operation; it must not invent download/install commands or bypass checks.
