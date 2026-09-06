# Local release signing with personal 1Password

No new subscription, paid certificate, hosted CI, or service account is required. Ordinary source builds and installed apps never access the maintainer's 1Password. The private key signs a release manifest; `resources/release.pub` is the public trust anchor. There is deliberately no example/fake production public key checked in.

## One-time setup (maintainer only)

1. Install Minisign from its official project or your trusted distro package, and 1Password CLI. Enable desktop app integration. Do not authorize a terminal containing unreviewed code to access your personal account.
2. In a private directory **outside this repository**, generate an encrypted key with `minisign -G -p release.pub -s release.key`. Choose a strong unique passphrase. Do not use `-W` (unencrypted keys) for the real release key.
3. Create a dedicated 1Password item named **HEY Agent Release Signing**. Attach the encrypted `release.key` file and public `release.pub` file, and save the passphrase in a password field. A concealed `private-key` field containing the complete encrypted file text is also supported. Retain recovery access; losing the only copy of the key prevents signing updates for the existing trust anchor. On another release machine, reuse this item rather than generating a new key.
4. Copy **only** the public `release.pub` into `resources/release.pub`. Review its fingerprint and commit it. Publish the public key/fingerprint through a trusted channel before asking people to verify their first download. A key downloaded beside an untrusted installer does not independently establish authenticity.
5. Set `HEY_AGENT_SIGNING_KEY_REF` in your local terminal configuration. For a file attachment, use the example below, replacing `YOUR_VAULT_ID`. For a concealed field, use `op://YOUR_VAULT_ID/HEY Agent Release Signing/private-key` instead. Keep real vault/item references out of committed config. Never export the key or passphrase itself, or paste it into an agent conversation.

```sh
export HEY_AGENT_SIGNING_KEY_REF='op://YOUR_VAULT_ID/HEY Agent Release Signing/release.key?attribute=content'
```

For Bash, this export can live in your local `~/.bashrc`; open a new terminal afterward. Or run it only in the terminal where you will release. This stores an address, not the key, and does not unlock 1Password. The release script inherits the variable; it does not discover the item, load `.env`, or read `.bashrc` itself. Existing agent processes may need restarting from that terminal to inherit it. Do not put an `op read` command or a password in shell startup files. See [1Password reference syntax](https://www.1password.dev/cli/secret-reference-syntax).

The release command uses `op read --out-file` with mode 0600 in a private temporary directory. You authorize 1Password, then enter the key passphrase directly at Minisign's terminal prompt (retrieve it from 1Password yourself). This intentionally keeps the passphrase out of automation. Normal exits and interrupts remove the temporary key; an OS crash or SIGKILL can leave a temporary encrypted copy, so inspect `hey-agent-signing.*` directories if a signing process is forcibly terminated. Prefer the session's temporary runtime directory.

A separate item/vault helps organization but does not make desktop CLI authentication item-scoped. The signing subprocess has access to the exported key while it runs; 1Password is storage, not a non-exportable hardware signer.

## Routine

```sh
npm run release -- patch --dry-run
npm run release -- patch
```

Both require signing prerequisites. Dry-run does not read the vault. The real command finishes tests/builds before requesting the key, signs the version/architecture/source identity and exact artifact hashes, verifies everything, then tags/pushes/publishes. Missing or invalid signing material blocks official publication. `npm run package:linux` remains unsigned and requires neither Minisign nor 1Password.

If signing fails after the release version was prepared, don't bump again. Inspect the prepared commit and artifacts, then run `bash scripts/sign-release.sh vVERSION` from that same clean commit. Follow [release recovery](releases.md) for tagging/pushing/publication; never replace an existing published release.

## Download verification

Download your chosen AppImage or installer bundle, `release-manifest.json`, and `release-manifest.json.minisig` from the same release. Obtain the trusted public key separately, then:

```sh
minisign -V -H -p /path/to/trusted/release.pub -m release-manifest.json
```

Stop on failure. Inspect the authenticated manifest's tag, architecture, source revision, and asset list. Hash the downloaded AppImage or bundle with `sha256sum` and compare it to that exact filename's signed `sha256` value **before extracting or executing anything**. The separate `.sha256` files alone are not publisher authentication. All manifest assets can also be verified by the maintainer's `node scripts/release-manifest.mjs verify vVERSION COMMIT_SHA` with the complete download set in `release/` and the already trusted public key in `resources/release.pub`.

Do not blindly trust a newly downloaded verification script before verifying its containing bundle. A signature failure must never fall back silently to an unsigned update. Source-built snapshots are an explicit separate installation path, not an update-verification escape hatch.

## Future updater and key rotation

No in-app updater is shipped in this phase. Add `electron-updater` only alongside enforced signature verification, explicit restart approval, identity/version checks, and a real installed version-to-version test. A downloaded signature from an unknown key must not authorize its own replacement key. Plan signed key transitions and an out-of-band recovery procedure before rotating or revoking the trust anchor.

References: [Minisign](https://jedisct1.github.io/minisign/), [1Password CLI file output](https://www.1password.dev/cli/reference/commands/read), [desktop authentication](https://www.1password.dev/cli/app-integration).
