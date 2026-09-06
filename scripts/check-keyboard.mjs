// Disposable renderer smoke. The DEV preview bridge is synthetic: no HEY/Pi calls.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
const scratch = await mkdtemp(join(tmpdir(), "hey-keyboard-smoke-"));
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
let child;
let timeout;
try {
  await server.listen();
  const address = server.httpServer.address();
  child = spawn(resolve("node_modules/electron/dist/electron"), ["--no-sandbox", "--disable-gpu", resolve("scripts/fixtures/keyboard-smoke-main.mjs")], {
    stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "", HEY_KEYBOARD_PREVIEW_URL: `http://127.0.0.1:${address.port}/?preview&theme=dusk`, XDG_CONFIG_HOME: join(scratch, "config"), XDG_DATA_HOME: join(scratch, "data"), XDG_STATE_HOME: join(scratch, "state") },
  });
  timeout = setTimeout(() => child.kill("SIGTERM"), 50_000);
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  if (code !== 0) throw new Error(`Keyboard smoke failed (${code}).`);
} finally { clearTimeout(timeout); await server.close(); await rm(scratch, { recursive: true, force: true }); }
