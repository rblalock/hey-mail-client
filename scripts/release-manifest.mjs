import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseBuild } from "./release-version.mjs";

export function releaseAssets(tag) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error("Invalid release tag.");
  const version = tag.slice(1);
  return [
    `HEY-Agent-${version}-linux-x86_64.tar.gz`,
    `HEY-Agent-${version}-linux-x86_64.tar.gz.sha256`,
    `HEY-Agent-${version}-x86_64.AppImage`,
    `HEY-Agent-${version}-x86_64.AppImage.sha256`,
    "build-info.json",
  ];
}

function assetRecord(directory, name) {
  const path = join(directory, name);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Not a regular nonempty release asset: ${name}`);
  return { name, bytes: stat.size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

export function prepareManifest(directory, tag, revision) {
  const names = releaseAssets(tag);
  verifyReleaseBuild(tag, JSON.parse(readFileSync(join(directory, "build-info.json"), "utf8")), revision);
  const manifest = { schema: 1, product: "dev.heyagent.desktop", tag, revision, arch: "x86_64", assets: names.map((name) => assetRecord(directory, name)) };
  writeFileSync(join(directory, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

// Called only AFTER authenticating the manifest. Exact names prevent path traversal,
// missing assets, extra executable assets, or substituting another version/architecture.
export function verifyManifestAssets(directory, manifest, tag, revision) {
  const names = releaseAssets(tag);
  if (manifest.schema !== 1 || manifest.product !== "dev.heyagent.desktop" || manifest.tag !== tag || manifest.revision !== revision || manifest.arch !== "x86_64" || !Array.isArray(manifest.assets) || manifest.assets.length !== names.length) {
    throw new Error("Release manifest identity does not match the requested release.");
  }
  for (const [index, name] of names.entries()) {
    const expected = manifest.assets[index];
    const actual = assetRecord(directory, name);
    if (expected?.name !== name || expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) throw new Error(`Release asset verification failed: ${name}`);
  }
  verifyReleaseBuild(tag, JSON.parse(readFileSync(join(directory, "build-info.json"), "utf8")), revision);
}

export function verifySignedManifest(directory, publicKey, tag, revision, executable = "minisign") {
  const manifestPath = join(directory, "release-manifest.json");
  const result = spawnSync(executable, ["-V", "-H", "-q", "-p", publicKey, "-m", manifestPath, "-x", `${manifestPath}.minisig`], { stdio: "pipe" });
  if (result.error || result.status !== 0) throw new Error("Release signature verification failed. Check minisign, the trusted public key, and the signature; publication is blocked.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  verifyManifestAssets(directory, manifest, tag, revision);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, tag, revision] = process.argv.slice(2);
    if (!["prepare", "verify"].includes(action) || !/^[a-f0-9]{40}$/.test(revision ?? "")) throw new Error("Usage: node scripts/release-manifest.mjs prepare|verify vVERSION COMMIT_SHA");
    const directory = resolve("release");
    if (action === "prepare") prepareManifest(directory, tag, revision);
    else verifySignedManifest(directory, resolve("resources/release.pub"), tag, revision);
    console.log(action === "prepare" ? "Release manifest prepared." : "Release signature and all asset hashes verified.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
