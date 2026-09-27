// One bounded headless, muted renderer pass. Fictional mail only; no Electron or HEY.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const exec = promisify(execFile);
const session = `hey-sectioned-check-${process.pid}-${Date.now()}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 115_000);
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
const browser = async (...args) => (await exec(binary, ["--session", session, ...args], { timeout: 10_000, signal: controller.signal, maxBuffer: 1_000_000, env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "7000" } })).stdout;
const evaluate = (source) => browser("eval", source);
const waitFor = (source) => browser("wait", "--fn", source);
const group = (key) => `.sectioned-imbox-group[data-section="${key}"]`;
const rowIn = (key, id) => `${group(key)} #mail-row-${id}`;
const artifacts = await mkdtemp(join(tmpdir(), "hey-sectioned-proof-"));

try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?preview&sectioned-imbox&theme=dusk`;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", url);
  await browser("set", "viewport", "1440", "1000");
  await browser("wait", rowIn("replyLater", "2201"));
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    if(document.querySelector('vite-error-overlay')) throw Error('Preview failed to load');
    const titles=[...document.querySelectorAll('.sectioned-imbox-group')].map(node=>node.getAttribute('aria-label'));
    if(JSON.stringify(titles)!==JSON.stringify(['Active','Reply Later','Set Aside','Bubbled Up','Previously Seen'])) throw Error('Five sections missing or reordered: '+titles);
    if(document.querySelectorAll('${group("previouslySeen")} .mail-row').length!==25) throw Error('Previously Seen must initially render 25 rows');
    if(document.querySelector('#mail-row-2501')) throw Error('Scheduled reminder leaked into Bubbled Up');
    if(document.querySelectorAll('${group("bubbledUp")} .mail-row').length!==1) throw Error('Due bubble missing');
    if([...document.querySelectorAll('button')].some(button=>/load more/i.test(button.textContent))) throw Error('Unrequested Load More button');
    window.__sectionedPageCount=()=>window.__sectionedImboxPreview.requests.filter(request=>request.options?.page).length;
    return true;
  })()`);
  await browser("screenshot", join(artifacts, "sectioned-desktop.png"));

  // Collapsed history must not fetch, even when its scroll container reaches the end.
  await browser("click", `${group("previouslySeen")} h2 button`);
  await evaluate(`(async()=>{const before=window.__sectionedPageCount();const list=document.querySelector('.imbox-panel .mail-list');list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event('scroll',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,180));if(window.__sectionedPageCount()!==before)throw Error('Collapsed history fetched');return true;})()`);
  await browser("press", "9");
  await waitFor(`document.querySelector('${group("previouslySeen")} h2 button')?.getAttribute('aria-expanded')==='true'`);
  await waitFor(`document.activeElement?.id==='mail-row-3000'&&document.querySelector('#mail-row-3000')?.dataset.selected==='true'`);
  await browser("press", "Enter");
  await waitFor(`document.querySelector('.thread-panel')?.textContent.includes('Previously Seen 01')`);
  await browser("press", "Escape");
  await browser("click", `${group("previouslySeen")} h2 button`);
  await evaluate(`(async()=>{await new Promise(resolve=>setTimeout(resolve,120));if(document.querySelector('${group("previouslySeen")} h2 button').getAttribute('aria-expanded')!=='false')throw Error('Manual collapse after nav9 reopened itself');return true;})()`);
  await browser("press", "9");
  await waitFor(`document.querySelector('${group("previouslySeen")} h2 button')?.getAttribute('aria-expanded')==='true'&&document.activeElement?.id==='mail-row-3000'`);
  await browser("click", `${group("previouslySeen")} h2 button`);
  await evaluate(`(async()=>{await new Promise(resolve=>setTimeout(resolve,120));if(document.querySelector('${group("previouslySeen")} h2 button').getAttribute('aria-expanded')!=='false')throw Error('Repeated nav9 prevented manual collapse');return true;})()`);
  await browser("click", `${group("previouslySeen")} h2 button`);
  await evaluate(`document.querySelector('.imbox-panel .mail-list').scrollTop=0`);

  // Reading keeps an Active row until the reader closes, and hidden lists cannot page.
  await browser("focus", "#mail-row-2101");
  await browser("press", "Enter");
  await browser("wait", ".thread-panel .email-body");
  await evaluate(`(async()=>{if(!document.querySelector('${rowIn("active", "2101")}'))throw Error('Active row moved while reading');if(!document.querySelector('.thread-panel').textContent.includes('Active one'))throw Error('Wrong first thread');const before=window.__sectionedPageCount();const list=document.querySelector('.imbox-panel .mail-list');list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event('scroll',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,180));if(window.__sectionedPageCount()!==before)throw Error('Hidden list fetched history');return true;})()`);
  await browser("press", "Escape");
  await browser("wait", rowIn("previouslySeen", "2101"));
  await evaluate(`(()=>{if(document.querySelector('${rowIn("active", "2101")}'))throw Error('Read conversation stayed Active after Escape');if(document.activeElement?.id!=='mail-row-2102')throw Error('Escape did not focus the next Active row: '+document.activeElement?.id);return true;})()`);
  await browser("press", "Enter");
  await waitFor(`document.querySelector('.thread-panel')?.textContent.includes('Active two')`);
  await browser("press", "Escape");
  await browser("wait", rowIn("previouslySeen", "2102"));

  // The normal scroll path reveals local batches and fetches overlapping history pages.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await evaluate(`(()=>{const list=document.querySelector('.imbox-panel .mail-list');list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event('scroll',{bubbles:true}));return true;})()`);
    await evaluate(`new Promise(resolve=>setTimeout(resolve,120))`);
  }
  await waitFor(`Array.from({length:75},(_,index)=>document.querySelector('#mail-row-'+(3000+index))).every(Boolean)`);
  await evaluate(`(()=>{const ids=[...document.querySelectorAll('.imbox-panel .mail-row')].map(row=>row.dataset.postingId);if(new Set(ids).size!==ids.length)throw Error('History contains duplicate rows');if(window.__sectionedPageCount()<2)throw Error('History did not fetch both pages');return true;})()`);

  // Reading saved mail never clears its workflow membership.
  for (const [key, id, title] of [["replyLater", "2201", "Reply Later one"], ["setAside", "2301", "Set Aside one"]]) {
    await browser("focus", `#mail-row-${id}`);
    await browser("press", "Enter");
    await waitFor(`document.querySelector('.thread-panel')?.textContent.includes(${JSON.stringify(title)})`);
    await browser("press", "Escape");
    await browser("wait", rowIn(key, id));
  }

  // E completes a saved item and a returned bubble; Ctrl+Z restores original membership.
  for (const [key, id] of [["replyLater", "2202"], ["bubbledUp", "2401"]]) {
    await browser("focus", `#mail-row-${id}`);
    await browser("press", "e");
    await browser("wait", rowIn("previouslySeen", id));
    await evaluate(`(()=>{if(document.querySelector('${rowIn(key, id)}'))throw Error('Done did not clear ${key}');const last=window.__sectionedImboxPreview.mutations.at(-1);if(last.operation!=='done'||last.postingIds[0]!=='${id}')throw Error('Wrong Done request');return true;})()`);
    await browser("press", "Control+z");
    await browser("wait", rowIn(key, id));
    await evaluate(`(()=>{const state=window.__sectionedImboxPreview.snapshot();const box='${key}'==='replyLater'?'laterbox':'imbox';const item=state[box].find(item=>item.id==='${id}');if(!item||('${key}'==='bubbledUp'&&!item.bubbledUp))throw Error('Undo failed to restore fixture membership');return true;})()`);
  }

  // Typing in a native field cannot trigger the Done command.
  await evaluate(`window.__beforeTypingMutations=window.__sectionedImboxPreview.mutations.length`);
  await browser("focus", '.imbox-panel input[placeholder="Search Imbox"]');
  await browser("press", "e");
  await evaluate(`(()=>{if(document.activeElement.value!=='e'||window.__sectionedImboxPreview.mutations.length!==window.__beforeTypingMutations)throw Error('Native typing guard failed');return true;})()`);
  await browser("fill", '.imbox-panel input[placeholder="Search Imbox"]', "");

  // Both layout choices persist through the actual settings update API.
  await browser("click", '.imbox-layout-switch button:first-child');
  await waitFor(`document.querySelector('.imbox-panel')?.dataset.layout==='hey'`);
  await evaluate(`(async()=>{if((await window.heyAgent.settings.get()).imboxLayout!=='hey')throw Error('HEY layout not saved');return true;})()`);
  await browser("click", '.imbox-layout-switch button:last-child');
  await waitFor(`document.querySelector('.imbox-panel')?.dataset.layout==='sectioned'`);
  await evaluate(`(async()=>{if((await window.heyAgent.settings.get()).imboxLayout!=='sectioned')throw Error('Sectioned layout not saved');return true;})()`);

  // Moving a mixed selection into Reply Later clears the already-saved row's
  // selection too; Undo restores the original source without disturbing it.
  for (const id of ["2103", "2202"]) {
    await browser("focus", `#mail-row-${id}`);
    await browser("press", "x");
  }
  await evaluate(`(()=>{if(document.querySelectorAll('.mail-row[data-bulk-selected="true"]').length!==2)throw Error('Mixed bulk selection did not select both rows');return true;})()`);
  await browser("press", "l");
  await waitFor(`document.querySelector('${rowIn("replyLater", "2103")}')&&!document.querySelector('#bulk-action-bar')`);
  await evaluate(`(()=>{if(!document.querySelector('${rowIn("replyLater", "2202")}')||document.querySelector('.mail-row[data-bulk-selected="true"]'))throw Error('Mixed Reply Later move left selection behind');return true;})()`);
  await browser("press", "Control+z");
  await browser("wait", rowIn("active", "2103"));
  await evaluate(`(()=>{const state=window.__sectionedImboxPreview.snapshot();if(!state.imbox.some(item=>item.id==='2103'&&!item.seen)||!state.laterbox.some(item=>item.id==='2202'))throw Error('Mixed move Undo failed to restore the whole action');return true;})()`);

  // Collapsing the highlighted group must leave navigation on a visible row.
  await browser("focus", "#mail-row-2201");
  await browser("click", `${group("replyLater")} h2 button`);
  await waitFor(`document.querySelector('.imbox-panel .mail-row[data-selected="true"]')?.closest('[data-section]')?.dataset.section!=='replyLater'`);
  await evaluate(`(()=>{const row=document.querySelector('.imbox-panel .mail-row[data-selected="true"]');if(!row||!row.getClientRects().length)throw Error('Collapsed group left a hidden or missing cursor');row.focus();return true;})()`);
  await browser("press", "j");
  await waitFor(`document.querySelector('#mail-row-2104')?.dataset.selected==='true'`);

  // Trash the last Active row while Reply Later is collapsed. The reader must
  // continue into the next visible group, and its pending trash can be undone.
  await browser("press", "Enter");
  await waitFor(`document.querySelector('.thread-panel')?.textContent.includes('Active four')`);
  await browser("press", "t");
  await waitFor(`document.querySelector('.thread-panel')?.textContent.includes('Set Aside one')`);
  await evaluate(`(()=>{if(document.querySelector('.thread-panel').textContent.includes('Reply Later one'))throw Error('Trash opened a collapsed Reply Later row');return true;})()`);
  await browser("click", '.trash-undo-toast button');
  await browser("press", "Escape");
  await browser("wait", rowIn("previouslySeen", "2104"));
  await browser("click", `${group("replyLater")} h2 button`);

  // Prepare a single remaining actionable row through the fictional API, then
  // exercise the real E command's empty-workflow focus fallback.
  await evaluate(`(async()=>{const state=window.__sectionedImboxPreview.snapshot();const completion=Object.entries(state).flatMap(([sourceBox,rows])=>['imbox','laterbox','asidebox'].includes(sourceBox)?rows.filter(item=>item.id!=='2103'&&(sourceBox!=='imbox'||!item.seen||item.bubbledUp)).map(item=>({id:item.id,sourceBox,seen:item.seen,bubbledUp:!!item.bubbledUp})):[]);await window.heyAgent.mail.mutate({operation:'done',postingIds:completion.map(item=>item.id),completion});return true;})()`);
  await browser("click", '[aria-label="Refresh Imbox"]');
  await waitFor(`document.querySelectorAll('.sectioned-imbox-group:not([data-section="previouslySeen"]) .mail-row').length===1`);
  await browser("focus", "#mail-row-2103");
  await browser("press", "e");
  await waitFor(`document.querySelectorAll('.sectioned-imbox-group:not([data-section="previouslySeen"]) .mail-row').length===0`);
  await waitFor(`document.activeElement?.matches('.sectioned-imbox-heading button')`);

  // Collapse survives a new renderer mount; the compact surface remains within its bounds.
  await browser("click", `${group("setAside")} h2 button`);
  await browser("click", `${group("previouslySeen")} h2 button`);
  await browser("open", url);
  await browser("wait", rowIn("replyLater", "2201"));
  await browser("snapshot", "-i");
  await evaluate(`(()=>{for(const key of ['setAside','previouslySeen'])if(document.querySelector('.sectioned-imbox-group[data-section="'+key+'"] h2 button')?.getAttribute('aria-expanded')!=='false')throw Error('Collapse did not persist for '+key);if(window.__sectionedImboxPreview.requests.some(request=>request.options?.page))throw Error('Collapsed history fetched after remount');return true;})()`);
  await browser("press", "Control+Shift+b");
  await browser("set", "viewport", "800", "800");
  await evaluate(`(()=>{const panel=document.querySelector('.imbox-panel');if(document.querySelector('.agent-rail'))throw Error('Agent rail obscures compact evidence');if(panel.scrollWidth>panel.clientWidth+2)throw Error('Compact Imbox overflow');if(document.documentElement.scrollWidth>window.innerWidth+2)throw Error('Compact page overflow');return true;})()`);
  await browser("screenshot", join(artifacts, "sectioned-compact.png"));
  const errors = await browser("errors");
  if (errors.trim()) throw Error(errors);
  console.log(`PASS: five sections, 25 initial history rows, no collapsed/hidden fetching, nav9 focus/Enter/repeat/manual collapse, automatic paged scrolling without duplicates, stable reading and next-row focus, saved membership, Done/Undo including bubbles, typing guard, both layouts, mixed bulk move/Undo, collapsed cursor, trash continuation, final Done heading focus, persistent collapse and compact bounds. Screenshots: ${artifacts}`);
} catch (error) {
  const state = await evaluate(`JSON.stringify({focused:document.activeElement?.id||document.activeElement?.tagName,highlighted:document.querySelector('.imbox-panel .mail-row[data-selected="true"]')?.dataset.postingId,thread:document.querySelector('.thread-panel h1')?.textContent,sections:[...document.querySelectorAll('.sectioned-imbox-group')].map(group=>({key:group.dataset.section,expanded:group.querySelector('h2 button')?.getAttribute('aria-expanded'),rows:[...group.querySelectorAll('.mail-row')].slice(0,4).map(row=>row.dataset.postingId)})),mutations:window.__sectionedImboxPreview?.mutations.slice(-4)})`).catch(() => "State unavailable after timeout.");
  console.error(`FAIL state: ${state}\nArtifacts: ${artifacts}`);
  await browser("screenshot", join(artifacts, "sectioned-failure.png")).catch(() => {});
  throw error;
} finally {
  clearTimeout(deadline);
  await exec(binary, ["--session", session, "close"], { timeout: 10_000 }).catch(() => {});
  await server.close();
}
