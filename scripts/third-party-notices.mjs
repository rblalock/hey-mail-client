import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Includes transitive production dependencies, including frontend code bundled by Vite.
// Never fetch licenses at build time. Missing upstream texts are explicitly reported.
const directories = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { encoding: "utf8" }).trim().split("\n").slice(1);
const notices = [];
for (const directory of directories) {
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
  let licenseFiles = files.filter((file) => /^(licen[sc]e|copying|notice|ofl)(\.|$|-)/i.test(file));
  if (!licenseFiles.length && pkg.name === "lru_map") licenseFiles = files.filter((file) => /^readme/i.test(file));
  let text = licenseFiles.sort().map((file) => `${file}\n\n${readFileSync(join(directory, file), "utf8")}`).join("\n\n");
  if (!text && pkg.name === "boolbase" && pkg.version === "1.0.0") text = readFileSync("resources/licenses/boolbase-1.0.0.txt", "utf8");
  if (!text) {
    // launder@1.7.1 declares MIT but publishes no standalone license text.
    // Preserve its exact metadata, and keep the missing notice visible for review.
    console.warn(`License text review required: ${pkg.name}@${pkg.version}`);
    text = `No standalone license text in the installed package.\nPackage metadata:\n${JSON.stringify({ name: pkg.name, version: pkg.version, author: pkg.author, license: pkg.license, repository: pkg.repository }, null, 2)}`;
  }
  notices.push({ name: `${pkg.name}@${pkg.version}`, text: `Declared license: ${JSON.stringify(pkg.license)}\n\n${text}` });
}
mkdirSync("release", { recursive: true });
writeFileSync(resolve("release/THIRD_PARTY_LICENSES.txt"), notices.sort((a, b) => a.name.localeCompare(b.name)).map(({ name, text }) => `${name}\n${"=".repeat(name.length)}\n${text}`).join("\n\n\n"));
console.log(`Collected notices for ${notices.length} production dependencies.`);
