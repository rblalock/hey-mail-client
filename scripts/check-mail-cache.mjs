// One headless, muted renderer pass. Fictional mail only; no Electron or HEY.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const exec = promisify(execFile);
const session = `hey-cache-check-${process.pid}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 90_000);
const browser = async (...args) => (await exec(binary, ["--session", session, ...args], { timeout: 12_000, signal: controller.signal, maxBuffer: 1_000_000 })).stdout;
const evaluate = (source) => browser("eval", source);
try {
  await server.listen();
  const port = server.httpServer.address().port;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", `http://127.0.0.1:${port}/?preview&theme=dusk`);
  await browser("wait", '[role="option"]');
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    if (document.querySelector('vite-error-overlay')) throw Error('Preview failed to load');
    window.__cacheUsage = {entries:2,bytes:2048};
    window.heyAgent.settings.mailCacheStats = async () => window.__cacheUsage;
    window.heyAgent.settings.clearMailCache = async () => {
      if(window.__clearFails) throw Error('Synthetic disk failure');
      window.__cacheUsage = {entries:0,bytes:0};
    };
    window.__readCounts = {}; window.__readFinishes = {};
    const read = window.heyAgent.mail.readThread;
    const copy = async (id, label) => {
      const value = structuredClone(await read(id));
      value.entries = [{id:'99001',sender:{name:'Fictional sender'},occurredAt:new Date().toISOString(),body:label+' '+id}];
      return value;
    };
    window.heyAgent.mail.readCachedThread = id => copy(id,'Cached preview');
    window.heyAgent.mail.readThread = async id => {
      window.__readCounts[id] = (window.__readCounts[id]||0)+1;
      await new Promise(resolve => { window.__readFinishes[id] = resolve; });
      return copy(id,'Fresh from HEY');
    };
    return true;
  })()`);
  await browser("click", '[aria-label="Profile options"]');
  await browser("click", '[role="menuitem"]');
  await browser("click", '#settings-mail-toggle');
  await browser("snapshot", "-i");
  await evaluate(`(() => { if(document.querySelector('[aria-label="Keep a local mail cache"]').getAttribute('aria-checked')!=='false'||!document.querySelector('#mail-cache-size').disabled) throw Error('Cache not opt-in'); return true; })()`);
  await browser("click", '[aria-label="Keep a local mail cache"]');
  await browser("click", '[aria-label="Preload nearby emails"]');
  await browser("select", '#mail-cache-size', '50');
  await browser("select", '#mail-cache-retention', '1');
  await evaluate(`(async () => { const cache=(await window.heyAgent.settings.get()).mailCache;if(!cache.enabled||cache.prefetch||cache.maxSizeMb!==50||cache.retentionDays!==1)throw Error('Preferences not saved');window.__clearFails=true;return true; })()`);
  await browser("click", '.mail-cache-usage button');
  await browser("wait", '.mail-cache-settings [role="alert"]');
  await evaluate(`window.__clearFails=false`);
  await browser("click", '.mail-cache-usage button');
  await evaluate(`(() => { if(!document.querySelector('.mail-cache-usage').textContent.includes('0 cached')||document.querySelector('.mail-cache-settings [role="alert"]')) throw Error('Clear result not reflected');return true; })()`);
  const artifacts = await mkdtemp(join(tmpdir(), "hey-cache-proof-"));
  await browser("screenshot", join(artifacts, "settings.png"));
  await browser("press", "Control+Shift+b");
  await browser("set", "viewport", "800", "800");
  await evaluate(`(() => {const element=document.querySelector('.settings-section-content:not([hidden])');if(element.scrollWidth>element.clientWidth+2)throw Error('Mail settings overflow');return {fontSize:getComputedStyle(element.querySelector('p')).fontSize};})()`);
  await browser("screenshot", join(artifacts, "settings-compact.png"));
  await browser("set", "viewport", "1280", "900");
  await browser("click", '.nav-row[data-tooltip="Imbox"]');
  await browser("focus", '#mail-row-2001');
  await browser("press", 'Enter');
  await browser("wait", '.thread-panel .email-body');
  await evaluate(`(() => {const text=document.querySelector('.thread-panel').textContent;if(!text.includes('Cached preview 1001')||text.includes('Fresh from HEY')||window.__readCounts['1001']!==1)throw Error('Disk preview or dedup failed');window.__readFinishes['1001']();return true;})()`);
  await browser("wait", '--fn', 'document.querySelector(".thread-panel")?.textContent.includes("Fresh from HEY 1001")');
  await browser("press", 'Escape');
  await browser("focus", '#mail-row-2002');
  await browser("press", 'Enter');
  await browser("wait", '--fn', 'document.querySelector(".thread-panel")?.textContent.includes("Cached preview 1002")');
  await evaluate(`(() => { if(document.querySelector('.thread-panel').textContent.includes('Fresh from HEY 1001'))throw Error('Wrong thread shown');window.__readFinishes['1002']();return true;})()`);
  await browser("wait", '--fn', 'document.querySelector(".thread-panel")?.textContent.includes("Fresh from HEY 1002")');
  const errors = await browser("errors"); if (errors.trim()) throw Error(errors);
  console.log(`PASS: opt-in, saved limits, clear errors/recovery, compact layout, instant cached preview during held live read, refresh replacement, deduplication, Escape/Enter correct-thread navigation. Screenshots: ${artifacts}`);
} finally {
  clearTimeout(deadline);
  await exec(binary, ["--session", session, "close"], { timeout: 10_000 }).catch(() => {});
  await server.close();
}
