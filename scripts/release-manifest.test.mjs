import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareManifest, releaseAssets, verifyManifestAssets, verifySignedManifest } from "./release-manifest.mjs";

const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tag = "v0.2.0";
const revision = "a".repeat(40);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "hey-manifest-test-"));
  temporary.push(dir);
  for (const name of releaseAssets(tag)) writeFileSync(join(dir, name), "Synthetic release asset");
  writeFileSync(join(dir, "build-info.json"), JSON.stringify({ version: "0.2.0", revision, modified: false, arch: "x64" }));
  return { dir, manifest: prepareManifest(dir, tag, revision) };
}

describe("signed release manifest", () => {
  it("binds the full set of assets to the product, tag, source and architecture", () => {
    const { dir, manifest } = fixture();
    expect(manifest.assets).toHaveLength(5);
    expect(() => verifyManifestAssets(dir, manifest, tag, revision)).not.toThrow();
    expect(JSON.parse(readFileSync(join(dir, "release-manifest.json"), "utf8"))).toEqual(manifest);
  });
  it.each(["tag", "revision", "arch", "product", "schema"])("rejects a mismatched %s", (field) => {
    const { dir, manifest } = fixture();
    manifest[field] = "unexpected";
    expect(() => verifyManifestAssets(dir, manifest, tag, revision)).toThrow("identity");
  });
  it("rejects changed bytes even when an unsigned checksum is also replaced", () => {
    const { dir, manifest } = fixture();
    writeFileSync(join(dir, manifest.assets[0].name), "Tampered artifact");
    writeFileSync(join(dir, manifest.assets[1].name), "Tampered checksum");
    expect(() => verifyManifestAssets(dir, manifest, tag, revision)).toThrow("verification failed");
  });
  it("rejects missing, additional, duplicate and traversal entries", () => {
    const { dir, manifest } = fixture();
    for (const assets of [manifest.assets.slice(1), [...manifest.assets, manifest.assets[0]], manifest.assets.map(() => manifest.assets[0]), [{ ...manifest.assets[0], name: "../private" }, ...manifest.assets.slice(1)]]) {
      expect(() => verifyManifestAssets(dir, { ...manifest, assets }, tag, revision)).toThrow();
    }
  });
  it("rejects symlink assets and dirty build identity", () => {
    const { dir } = fixture();
    const file = join(dir, releaseAssets(tag)[0]);
    rmSync(file);
    symlinkSync(join(dir, "build-info.json"), file);
    expect(() => prepareManifest(dir, tag, revision)).toThrow("regular");
    writeFileSync(join(dir, "build-info.json"), JSON.stringify({ version: "0.2.0", revision, modified: true, arch: "x64" }));
    expect(() => prepareManifest(dir, tag, revision)).toThrow();
  });
  it("fails closed when the signature verifier fails or is unavailable", () => {
    const { dir } = fixture();
    expect(() => verifySignedManifest(dir, join(dir, "key.pub"), tag, revision, "/usr/bin/false")).toThrow("signature verification failed");
    expect(() => verifySignedManifest(dir, join(dir, "key.pub"), tag, revision, join(dir, "absent"))).toThrow("signature verification failed");
  });
  it("rejects malformed release tags", () => {
    for (const value of ["../../etc", "v01.2.0", "v0.2.0-beta", "0.2.0"]) expect(() => releaseAssets(value)).toThrow();
  });
});
