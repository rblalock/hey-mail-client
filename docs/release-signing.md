# Release signatures

Official releases include a signed manifest listing the version, source revision, and artifact hashes. The public verification key is in `resources/release.pub`. Private signing setup is maintained outside this repository.

## Download verification

For users who want to verify a download, get the AppImage or installer bundle, `release-manifest.json`, and `release-manifest.json.minisig` from the same release.

With Minisign installed and a public key you trust:

```sh
minisign -V -H -p /path/to/trusted/release.pub -m release-manifest.json
```

Then run `sha256sum` on the downloaded AppImage or bundle and compare it with that filename's `sha256` value in the verified manifest. Do this before extracting or running the download. Stop if either check fails.

A checksum alone does not verify the publisher. A public key obtained alongside an untrusted download does not establish trust on its own.

## Maintainers

See [release.md](https://github.com/rblalock/hey-mail-client/blob/main/release.md) for publishing and recovery. Official publication requires a valid signature; local source builds do not.

Keep private keys, passwords, storage references, and access instructions out of source control. Only the public key belongs here.

No automatic updater is shipped. Any future updater must verify downloads before installation. Key rotation also needs a verified transition from the previous key and a recovery procedure.
