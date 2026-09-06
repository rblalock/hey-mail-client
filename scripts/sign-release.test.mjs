import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseAssets, verifySignedManifest } from "./release-manifest.mjs";

// Opt-in actual cryptographic integration proof. Never reads a real vault or key.
// HEY_AGENT_TEST_MINISIGN=/trusted/path/minisign npm test -- scripts/sign-release.test.mjs
const minisign = process.env.HEY_AGENT_TEST_MINISIGN;
const fixtures = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(!minisign)("real Minisign with a synthetic 1Password CLI", () => {
  it("signs with an encrypted test key, cleans temporary material, and rejects tampering", () => {
    const root = mkdtempSync(join(tmpdir(), "hey-sign-test-"));
    fixtures.push(root);
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    const runtime = join(root, "runtime");
    for (const directory of [bin, runtime, join(repo, "scripts"), join(repo, "resources"), join(repo, "release")]) mkdirSync(directory, { recursive: true });
    copyFileSync(minisign, join(bin, "minisign"));
    const key = join(root, "fixture.key");
    const pub = join(repo, "resources/release.pub");
    const password = "synthetic-test-passphrase-not-a-real-secret";
    const generated = spawnSync(minisign, ["-G", "-p", pub, "-s", key], { input: `${password}\n${password}\n`, encoding: "utf8" });
    expect(generated.status, generated.stderr).toBe(0);
    for (const file of ["sign-release.sh", "release-manifest.mjs", "release-version.mjs"]) copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(repo, "scripts", file));
    writeFileSync(join(repo, ".gitignore"), "release/\n");
    writeFileSync(join(bin, "op"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'read' || args[1] !== 'op://fixture/release/private-key') process.exit(1);
const path = args[args.indexOf('--out-file') + 1];
fs.writeFileSync(path, fs.readFileSync(process.env.TEST_SIGNING_KEY), { mode: 0o600 });
`, { mode: 0o755 });
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", PATH: `${bin}:${process.env.PATH}`, XDG_RUNTIME_DIR: runtime, HEY_AGENT_SIGNING_KEY_REF: "op://fixture/release/private-key", TEST_SIGNING_KEY: key };
    const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: "pipe" }).trim();
    git("init", "--initial-branch=main");
    git("config", "user.name", "Synthetic Signer");
    git("config", "user.email", "signer@example.invalid");
    git("config", "core.hooksPath", join(root, "no-hooks"));
    git("add", ".");
    git("commit", "-m", "Synthetic fixture");
    const revision = git("rev-parse", "HEAD");
    for (const name of releaseAssets("v0.2.0")) writeFileSync(join(repo, "release", name), "Synthetic artifact");
    writeFileSync(join(repo, "release/build-info.json"), JSON.stringify({ version: "0.2.0", revision, modified: false, arch: "x64" }));
    const result = spawnSync("bash", [join(repo, "scripts/sign-release.sh"), "v0.2.0"], { cwd: repo, env, input: `${password}\n`, encoding: "utf8", timeout: 30000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(password);
    expect(result.stdout + result.stderr).not.toContain(readFileSync(key, "utf8"));
    expect(readdirSync(runtime)).toEqual([]);
    expect(existsSync(join(repo, "release/release-manifest.json.minisig"))).toBe(true);
    expect(() => verifySignedManifest(join(repo, "release"), pub, "v0.2.0", revision, minisign)).not.toThrow();
    writeFileSync(join(repo, "release", releaseAssets("v0.2.0")[0]), "tampered");
    expect(() => verifySignedManifest(join(repo, "release"), pub, "v0.2.0", revision, minisign)).toThrow("asset verification failed");
    writeFileSync(join(repo, "release/release-manifest.json"), "{}");
    expect(() => verifySignedManifest(join(repo, "release"), pub, "v0.2.0", revision, minisign)).toThrow("signature verification failed");
    const failed = spawnSync("bash", [join(repo, "scripts/sign-release.sh"), "v0.2.0"], { cwd: repo, env, input: "wrong-password\n", encoding: "utf8", timeout: 30000 });
    expect(failed.status).not.toBe(0);
    expect(readdirSync(runtime)).toEqual([]);
  }, 30000);
});
