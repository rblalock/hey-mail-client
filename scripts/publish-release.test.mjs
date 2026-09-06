import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareManifest } from "./release-manifest.mjs";

const fixtures = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function publish(state = "missing", failUpload = false, corrupt = false, badSignature = false) {
  const root = mkdtempSync(join(tmpdir(), "hey-publish-test-"));
  fixtures.push(root);
  mkdirSync(join(root, "release"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "scripts"));
  copyFileSync(fileURLToPath(new URL("release-version.mjs", import.meta.url)), join(root, "scripts/release-version.mjs"));
  copyFileSync(fileURLToPath(new URL("release-manifest.mjs", import.meta.url)), join(root, "scripts/release-manifest.mjs"));
  writeFileSync(join(root, "bin/minisign"), "#!/bin/sh\n[ \"$BAD_SIGNATURE\" != 1 ]\n", { mode: 0o755 });
  for (const file of ["HEY-Agent-0.2.0-linux-x86_64.tar.gz", "HEY-Agent-0.2.0-x86_64.AppImage"]) {
    writeFileSync(join(root, "release", file), "test artifact");
    const hash = createHash("sha256").update(corrupt ? "different" : "test artifact").digest("hex");
    writeFileSync(join(root, "release", `${file}.sha256`), `${hash}  ${file}\n`);
  }
  writeFileSync(join(root, "release/build-info.json"), JSON.stringify({ version: "0.2.0", revision: "a".repeat(40), modified: false, arch: "x64" }));
  prepareManifest(join(root, "release"), "v0.2.0", "a".repeat(40));
  writeFileSync(join(root, "calls"), "");
  writeFileSync(join(root, "bin/gh"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls', JSON.stringify(args) + '\\n');
if (args[1] === 'view') {
  if (args.includes('url')) { console.log('https://example.invalid/release'); process.exit(0); }
  if (process.env.RELEASE_STATE === 'missing') process.exit(1);
  console.log(process.env.RELEASE_STATE === 'draft' ? 'true' : 'false');
}
if (args[1] === 'upload' && process.env.FAIL_UPLOAD === '1') process.exit(1);
`, { mode: 0o755 });
  writeFileSync(join(root, "bin/git"), `#!/bin/sh
case "$1" in
  rev-parse|ls-remote) printf '%s\\n' '${"a".repeat(40)}' ;;
  *) printf '%s\\n' '- Test change (1234567)' ;;
esac
`, { mode: 0o755 });
  const result = spawnSync("bash", [fileURLToPath(new URL("publish-release.sh", import.meta.url))], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_REPO: "fixture/repo", GH_TOKEN: "test-not-a-token", RELEASE_TAG: "v0.2.0", RELEASE_STATE: state, FAIL_UPLOAD: failUpload ? "1" : "0", BAD_SIGNATURE: badSignature ? "1" : "0" },
    encoding: "utf8",
  });
  return { result, calls: readFileSync(join(root, "calls"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) };
}

describe("release publication (fake GitHub CLI, no network)", () => {
  it("creates a draft, uploads assets, then publishes as prerelease", () => {
    const { result, calls } = publish();
    expect(result.status, result.stderr).toBe(0);
    expect(calls.filter((args) => ["create", "upload", "edit"].includes(args[1])).map((args) => args[1])).toEqual(["create", "upload", "edit"]);
    expect(calls.find((args) => args[1] === "create")).toContain("--draft");
    expect(calls.find((args) => args[1] === "edit")).toContain("--prerelease");
    expect(calls.find((args) => args[1] === "edit")).toContain("--latest=false");
  });
  it("never publishes after an upload failure", () => {
    const { result, calls } = publish("missing", true);
    expect(result.status).not.toBe(0);
    expect(calls.some((args) => args[1] === "edit")).toBe(false);
  });
  it("resumes an existing draft without creating another release", () => {
    const { result, calls } = publish("draft");
    expect(result.status, result.stderr).toBe(0);
    expect(calls.some((args) => args[1] === "create")).toBe(false);
    expect(calls.some((args) => args[1] === "edit")).toBe(true);
  });
  it("does not overwrite a published release", () => {
    const { result, calls } = publish("published");
    expect(result.status).toBe(0);
    expect(calls.map((args) => args[1])).toEqual(["view"]);
  });
  it("rejects corrupt downloads before calling GitHub", () => {
    const { result, calls } = publish("missing", false, true);
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });
  it("rejects unsigned or incorrectly signed releases before calling GitHub", () => {
    const { result, calls } = publish("missing", false, false, true);
    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });
});
