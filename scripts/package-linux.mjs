import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
  throw new Error("Build on a Linux x64 or arm64 machine matching the target architecture.");
}
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const git = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
const dirty = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
mkdirSync("release", { recursive: true });
writeFileSync("release/build-info.json", JSON.stringify({
  version: pkg.version,
  revision: git.status === 0 ? git.stdout.trim() : "unknown",
  modified: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null,
  builtAt: new Date().toISOString(),
  arch: process.arch,
}, null, 2) + "\n");
run("npm", ["run", "build"]);
run(process.execPath, ["scripts/third-party-notices.mjs"]);
run(process.execPath, ["node_modules/electron-builder/out/cli/cli.js", "--linux", "AppImage", `--${process.arch}`, "--publish", "never"]);
for (const file of ["install.sh", "uninstall.sh", "hey-agent"]) {
  copyFileSync(`scripts/linux/${file}`, `release/${file}`);
}
copyFileSync("resources/icon.png", "release/icon.png");
copyFileSync("docs/linux-install.md", "release/README.md");
copyFileSync("docs/releases.md", "release/releases.md");
copyFileSync("docs/release-signing.md", "release/release-signing.md");
copyFileSync("docs/public-release-readiness.md", "release/public-release-readiness.md");
copyFileSync("docs/helpers-plan.md", "release/helpers-plan.md");
copyFileSync("LICENSE", "release/LICENSE");
copyFileSync("THIRD_PARTY_NOTICES.md", "release/THIRD_PARTY_NOTICES.md");
const artifactArch = process.arch === "x64" ? "x86_64" : "arm64";
const artifact = `HEY-Agent-${pkg.version}-${artifactArch}.AppImage`;
const digest = (file) => createHash("sha256").update(readFileSync(resolve("release", file))).digest("hex");
const installerFiles = [artifact, "install.sh", "uninstall.sh", "hey-agent", "icon.png", "README.md", "releases.md", "release-signing.md", "public-release-readiness.md", "helpers-plan.md", "build-info.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "THIRD_PARTY_LICENSES.txt"];
writeFileSync(`release/${artifact}.sha256`, `${digest(artifact)}  ${artifact}\n`);
writeFileSync("release/SHA256SUMS", installerFiles.map((file) => `${digest(file)}  ${file}\n`).join(""));
const bundle = `HEY-Agent-${pkg.version}-linux-${artifactArch}.tar.gz`;
run("tar", ["-czf", resolve("release", bundle), "-C", "release", ...installerFiles, "SHA256SUMS"]);
// Separate outer checksum verifies the download before extracting the installer.
writeFileSync(`release/${bundle}.sha256`, `${digest(bundle)}  ${bundle}\n`);
console.log(`\nBuilt release/${bundle}\nInstall: bash release/install.sh release/${artifact}`);
