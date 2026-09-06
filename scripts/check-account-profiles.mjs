// Real Electron/main/preload smoke with disposable, synthetic HEY and Pi processes.
// Run after npm run build. Never uses the user's HEY credentials or Pi models.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "hey-profile-smoke-"));
const child = spawn(resolve(root, "node_modules/electron/dist/electron"), ["--no-sandbox", "--disable-gpu", resolve(root, "scripts/fixtures/profile-smoke-main.mjs")], {
  cwd: root, stdio: "inherit", env: {
    ...process.env, ELECTRON_RUN_AS_NODE: "", ELECTRON_RENDERER_URL: "",
    HEY_AGENT_PROFILE_SMOKE_ROOT: scratch,
    HEY_AGENT_HEY_PATH: resolve(root, "scripts/fixtures/profile-hey.mjs"),
    HEY_AGENT_PI_PATH: resolve(root, "scripts/fixtures/profile-pi.mjs"),
    HEY_HANDOFF_SMOKE_ROOT: scratch,
    ...Object.fromEntries(["CODEX", "CLAUDE", "HERMES", "AGENT", "GROK", "XDG-TERMINAL-EXEC"].map((name) => [`HEY_AGENT_${name}_PATH`, resolve(root, "scripts/fixtures/handoff-agent.mjs")])),
    XDG_CONFIG_HOME: join(scratch, "config"), XDG_DATA_HOME: join(scratch, "data"), XDG_STATE_HOME: join(scratch, "state"),
  },
});
const timeout = setTimeout(() => child.kill("SIGTERM"), 50_000);
try {
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  if (code !== 0) throw new Error(`Profile smoke failed (${code}).`);
} finally { clearTimeout(timeout); await rm(scratch, { recursive: true, force: true }); }
