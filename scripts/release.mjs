import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nextVersion, verifyReleaseBuild, verifyReleaseVersion } from "./release-version.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((arg) => !arg.startsWith("--")) ?? "patch";
if (args.some((arg) => !["patch", "minor", "major", "--dry-run"].includes(arg)) || args.filter((arg) => !arg.startsWith("--")).length > 1) {
  throw new Error("Usage: npm run release -- [patch|minor|major] [--dry-run]");
}
function run(command, commandArgs, capture = false) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed${capture ? `: ${result.stderr.trim()}` : ". See output above."}`);
  return capture ? result.stdout.trim() : "";
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const current = readJson("package.json").version;
verifyReleaseVersion(`v${current}`, readJson("package.json"), readJson("package-lock.json"));
const version = nextVersion(current, bump);
const tag = `v${version}`;
console.log(`${dryRun ? "Preview" : "Release"}: ${current} → ${version}`);
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Release on Linux x86-64 for the current Intel/AMD machines.");
if (run("git", ["branch", "--show-current"], true) !== "main") throw new Error("Release from main, not a feature branch.");
if (run("git", ["status", "--porcelain"], true)) throw new Error("Commit and push the working tree before releasing. No files changed.");
if (existsSync(".github/workflows") && readdirSync(".github/workflows").some((file) => /\.ya?ml$/i.test(file))) {
  throw new Error("GitHub workflows are present. Releases must not trigger paid CI; remove them before releasing.");
}
const origin = run("git", ["remote", "get-url", "origin"], true);
const repository = run("gh", ["repo", "view", origin, "--json", "nameWithOwner", "--jq", ".nameWithOwner"], true);
// Also guard against a workflow that is still active on the remote.
const workflows = run("gh", ["api", `repos/${repository}/actions/workflows`, "--paginate", "--jq", '.workflows[] | select(.state == "active") | .name'], true);
if (workflows) throw new Error("GitHub has active workflows. Disable/remove them before releasing to avoid CI charges.");
const head = run("git", ["rev-parse", "HEAD"], true);
const remoteHead = run("git", ["ls-remote", "origin", "refs/heads/main"], true).split(/\s/)[0];
if (head !== remoteHead) throw new Error("Local main must match origin/main. Pull or push your reviewed changes first.");
if (run("git", ["tag", "--list", tag], true) || run("git", ["ls-remote", "origin", `refs/tags/${tag}`], true)) {
  throw new Error(`${tag} already exists. Never move or reuse a release tag.`);
}
if (!existsSync("resources/release.pub") || !process.env.HEY_AGENT_SIGNING_KEY_REF?.startsWith("op://")) {
  throw new Error("Official releases require resources/release.pub and a local HEY_AGENT_SIGNING_KEY_REF. See docs/release-signing.md. Source builds need neither.");
}
run("minisign", ["-v"], true);
run("op", ["--version"], true);
if (dryRun) {
  console.log(`Would test locally, bump both package files, commit, build locally, sign with 1Password/Minisign, tag ${tag}, atomically push main + tag, and upload to GitHub Releases. No Actions/CI. No vault access or changes during dry-run.`);
} else {
  let prepared = false;
  try {
    run("npm", ["run", "typecheck"]);
    run("npm", ["test"]);
    run("npm", ["version", version, "--no-git-tag-version", "--ignore-scripts"]);
    prepared = true;
    verifyReleaseVersion(tag, readJson("package.json"), readJson("package-lock.json"));
    run("git", ["add", "--", "package.json", "package-lock.json"]);
    run("git", ["commit", "-m", `chore(release): ${tag}`]);
    run("npm", ["run", "package:linux"]);
    const revision = run("git", ["rev-parse", "HEAD"], true);
    verifyReleaseBuild(tag, readJson("release/build-info.json"), revision);
    if (run("git", ["status", "--porcelain"], true)) throw new Error("Build modified the source tree; release not pushed.");
    run("bash", ["scripts/sign-release.sh", tag]);
    run("git", ["tag", "-a", tag, "-m", `HEY Agent ${tag}`]);
    run("git", ["push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${tag}`]);
    process.env.GH_REPO = repository;
    process.env.RELEASE_TAG = tag;
    run("bash", ["scripts/publish-release.sh"]);
    console.log(`\n${tag} built locally and published to GitHub Releases. No GitHub Actions were used.`);
  } catch (error) {
    if (prepared) console.error("Release preparation stopped. Local changes/commit/tag are preserved; inspect git status and remote refs before retrying. Do not bump again or force-push. See docs/releases.md.");
    throw error;
  }
}
