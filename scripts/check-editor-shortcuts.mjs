// Bounded, headless, muted keyboard regression check. Synthetic renderer only;
// no Electron window, real HEY account, Pi session, or system clipboard access.
// Requires agent-browser and Chromium. Optional AGENT_BROWSER_BIN / CHROMIUM_BIN.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const exec = promisify(execFile);
const session = `hey-editor-check-${process.pid}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 45_000);
async function browser(...args) {
  const { stdout } = await exec(binary, ["--session", session, ...args], { timeout: 10_000, signal: controller.signal, maxBuffer: 1_000_000 });
  return stdout;
}
const evaluate = (source) => browser("eval", source);
async function selectAll(selector, text) {
  await browser("fill", selector, text);
  await browser("press", "Control+a");
  await evaluate(`(() => {
    const input = document.activeElement;
    if (input.value !== ${JSON.stringify(text)} || input.selectionStart !== 0 || input.selectionEnd !== input.value.length) throw Error("Native Select All failed: " + input.outerHTML);
    if (window.__keyboardWrites.length) throw Error("Editing dispatched a mail action");
    return true;
  })()`);
}
try {
  await server.listen();
  const port = server.httpServer.address().port;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", `http://127.0.0.1:${port}/?preview&theme=dusk`);
  await browser("wait", '[role="option"]');
  await evaluate(`(() => {
    window.__keyboardWrites = [];
    const mutate = window.heyAgent.mail.mutate;
    window.heyAgent.mail.mutate = async (...args) => { window.__keyboardWrites.push(args); return mutate(...args); };
    return true;
  })()`);

  await browser("click", ".compose-row");
  await selectAll('textarea[placeholder="Write your message…"]', "First line. Second line.");
  await browser("keyboard", "type", "Replacement");
  await browser("press", "Control+z");
  await evaluate('(() => { if(document.activeElement.value === "Replacement" || window.__keyboardWrites.length) throw Error("Undo did not stay in editor"); return true; })()');
  await browser("press", "Control+Shift+c");
  await evaluate('(() => { if(document.activeElement.getAttribute("aria-label") !== "Cc recipients") throw Error("Cc shortcut regressed"); return true; })()');
  await browser("fill", 'textarea[placeholder="Write your message…"]', "");
  await browser("press", "Escape");

  await browser("focus", '[role="option"]');
  await browser("press", "Enter");
  await browser("wait", '[aria-label="Conversation messages"]');
  await evaluate('window.__keyboardWrites = []'); // Opening a thread may mark it read.
  await browser("click", ".thread-reply-collapsed");
  await selectAll('textarea[placeholder="Write your reply…"]', "Reply text to select.");
  await browser("press", "ArrowLeft");
  await evaluate('(() => { if(document.activeElement.selectionStart !== 0 || document.activeElement.selectionEnd !== 0) throw Error("Arrow escaped editor"); return true; })()');
  await browser("fill", 'textarea[placeholder="Write your reply…"]', "");
  await browser("press", "Escape");
  await browser("press", "Escape");
  await browser("wait", '.mail-row[data-selected="true"]');
  await evaluate('window.__previousRow = document.querySelector(".mail-row[data-selected=true]").dataset.postingId');
  await browser("press", "ArrowDown");
  await evaluate('(() => { const row = document.querySelector(".mail-row[data-selected=true]"); if(row.dataset.postingId === window.__previousRow) throw Error("Arrow did not move selection"); window.__nextSubject = row.querySelector(".subject-line strong").textContent; return true; })()');
  await browser("press", "Enter");
  await browser("wait", ".thread-panel h1");
  await evaluate('(() => { if(document.querySelector(".thread-panel h1").textContent !== window.__nextSubject) throw Error("Enter opened the wrong thread"); return true; })()');
  await evaluate('window.__keyboardWrites = []');

  await selectAll('textarea[aria-label="Message HEY Agent"]', "Chat text to select.");
  await evaluate('window.__keyboardSends = 0; window.heyAgent.agent.send = async () => { window.__keyboardSends++; throw Error("Unexpected chat send"); }');
  await browser("press", "Control+Shift+Enter");
  await evaluate('(() => { if(window.__keyboardSends) throw Error("Extra modifier sent chat"); return true; })()');
  await browser("press", "Control+k");
  await selectAll('input[aria-label="Search commands"]', "draft");
  await browser("press", "Escape");
  const errors = await browser("errors");
  if (errors.trim()) throw Error(errors);
  console.log("PASS: native Select All, editor Undo/arrows, Cc, reply close, next-row Enter, chat send guards, and command palette.");
} finally {
  clearTimeout(deadline);
  // Cleanup must work even after the test deadline aborts.
  await exec(binary, ["--session", session, "close"], { timeout: 10_000 }).catch(() => {});
  await server.close();
}
