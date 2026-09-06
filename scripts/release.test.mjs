import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hey-release-test-"));
  fixtures.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const bin = join(root, "bin");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(bin);
  const env = { ...process.env, HEY_AGENT_SIGNING_KEY_REF: "op://fixture/release/private-key", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", PATH: `${bin}:${process.env.PATH}` };
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  for (const file of ["release.mjs", "release-version.mjs"]) copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(repo, "scripts", file));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ version: "0.1.0" }));
  writeFileSync(join(repo, "package-lock.json"), JSON.stringify({ version: "0.1.0", packages: { "": { version: "0.1.0" } } }));
  writeFileSync(join(repo, ".gitignore"), "release/\n");
  mkdirSync(join(repo, "resources"));
  writeFileSync(join(repo, "resources/release.pub"), "Synthetic fixture public key");
  writeFileSync(join(repo, "scripts/sign-release.sh"), "#!/bin/sh\n[ \"$FAIL_SIGN\" != 1 ] || exit 1\nprintf signed > release/signed\n");
  for (const tool of ["minisign", "op"]) writeFileSync(join(bin, tool), "#!/bin/sh\nprintf 'fixture version'\n", { mode: 0o755 });
  writeFileSync(join(repo, "scripts/publish-release.sh"), "#!/bin/sh\nprintf 'published' > release/published\n");
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node
if (process.argv[2] === 'repo') console.log('fixture/repo');
if (process.argv[2] === 'api' && process.env.ACTIVE_WORKFLOW === '1') console.log('Paid CI');
`, { mode: 0o755 });
  writeFileSync(join(bin, "npm"), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.FAIL_TESTS === '1') process.exit(1);
if (process.argv[3] === 'package:linux') {
  if (process.env.FAIL_BUILD === '1') process.exit(1);
  fs.mkdirSync('release', {recursive:true});
  fs.writeFileSync('release/build-info.json', JSON.stringify({
    version: JSON.parse(fs.readFileSync('package.json')).version,
    revision: require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
    modified: false, arch: 'x64'
  }));
}
if (process.argv[2] === 'version') {
  for (const file of ['package.json', 'package-lock.json']) {
    const data = JSON.parse(fs.readFileSync(file));
    data.version = process.argv[3];
    if (data.packages) data.packages[''].version = data.version;
    fs.writeFileSync(file, JSON.stringify(data));
  }
}
`, { mode: 0o755 });
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("init", "--bare", "--initial-branch=main", remote);
  git("remote", "add", "origin", remote);
  git("push", "-u", "origin", "main");
  const run = (args, extraEnv = {}) => spawnSync(process.execPath, [join(repo, "scripts/release.mjs"), ...args], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8" });
  return { root, repo, git, run };
}

describe("release command guardrails (isolated local Git repositories)", () => {
  it("previews without changing versions, commits, tags, or remote refs", () => {
    const f = fixture();
    const before = f.git("rev-parse", "HEAD");
    expect(f.run(["patch", "--dry-run"]).status).toBe(0);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("rev-parse", "HEAD")).toBe(before);
    expect(f.git("tag", "--list")).toBe("");
    expect(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(before);
  });
  it("rejects uncommitted work", () => {
    const f = fixture();
    writeFileSync(join(f.repo, "uncommitted.txt"), "keep me");
    expect(f.run(["patch"]).stderr).toContain("Commit and push");
    expect(f.git("tag", "--list")).toBe("");
    expect(readFileSync(join(f.repo, "uncommitted.txt"), "utf8")).toBe("keep me");
  });
  it("rejects a feature branch", () => {
    const f = fixture();
    f.git("checkout", "-b", "feature");
    expect(f.run(["patch"]).stderr).toContain("Release from main");
  });
  it("rejects main that differs from origin/main", () => {
    const f = fixture();
    f.git("commit", "--allow-empty", "-m", "Unpushed work");
    expect(f.run(["patch"]).stderr).toContain("must match origin/main");
  });
  it("rejects a version tag that already exists", () => {
    const f = fixture();
    f.git("tag", "v0.1.1");
    expect(f.run(["patch"]).stderr).toContain("already exists");
  });
  it("does not bump if checks fail", () => {
    const f = fixture();
    expect(f.run(["patch"], { FAIL_TESTS: "1" }).status).not.toBe(0);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("tag", "--list")).toBe("");
  });
  it("blocks local Actions workflows", () => {
    const f = fixture();
    mkdirSync(join(f.repo, ".github/workflows"), { recursive: true });
    writeFileSync(join(f.repo, ".github/workflows/ci.yml"), "on: push\n");
    f.git("add", ".");
    f.git("commit", "-m", "Unwanted CI");
    expect(f.run(["patch"]).stderr).toContain("must not trigger paid CI");
  });
  it("blocks active remote workflows", () => {
    const f = fixture();
    expect(f.run(["patch"], { ACTIVE_WORKFLOW: "1" }).stderr).toContain("active workflows");
    expect(f.git("tag", "--list")).toBe("");
  });
  it("never pushes or publishes if local packaging fails", () => {
    const f = fixture();
    const before = f.git("rev-parse", "HEAD");
    expect(f.run(["patch"], { FAIL_BUILD: "1" }).status).not.toBe(0);
    expect(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(before);
    expect(f.git("tag", "--list")).toBe("");
    expect(existsSync(join(f.repo, "release/published"))).toBe(false);
  });
  it("blocks missing signing configuration before changing versions", () => {
    const f = fixture();
    expect(f.run(["patch"], { HEY_AGENT_SIGNING_KEY_REF: "" }).stderr).toContain("Official releases require");
    expect(f.git("status", "--porcelain")).toBe("");
  });
  it("never tags, pushes or publishes if signing fails", () => {
    const f = fixture();
    const before = f.git("rev-parse", "HEAD");
    expect(f.run(["patch"], { FAIL_SIGN: "1" }).status).not.toBe(0);
    expect(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(before);
    expect(f.git("tag", "--list")).toBe("");
    expect(existsSync(join(f.repo, "release/published"))).toBe(false);
  });
  it("bumps both files and pushes matching main and an annotated tag", () => {
    const f = fixture();
    const result = f.run(["minor"]);
    expect(result.stderr, result.stdout).not.toContain("Error:");
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(f.repo, "package.json"))).version).toBe("0.2.0");
    expect(JSON.parse(readFileSync(join(f.repo, "package-lock.json"))).packages[""].version).toBe("0.2.0");
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("cat-file", "-t", "v0.2.0")).toBe("tag");
    const head = f.git("rev-parse", "HEAD");
    expect(f.git("ls-remote", "origin", "refs/heads/main").split(/\s/)[0]).toBe(head);
    expect(f.git("ls-remote", "origin", "refs/tags/v0.2.0^{}").split(/\s/)[0]).toBe(head);
    expect(readFileSync(join(f.repo, "release/published"), "utf8")).toBe("published");
  });
});
