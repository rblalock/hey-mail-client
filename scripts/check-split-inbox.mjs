// One bounded, headless, muted pass using fictional preview data only.
// Never launches Electron, invokes HEY, or touches a user's account.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const exec = promisify(execFile);
const session = `hey-split-check-${process.pid}-${Date.now()}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 110_000);
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
const browser = async (...args) => (await exec(binary, ["--session", session, ...args], {
  timeout: 10_000, signal: controller.signal, maxBuffer: 1_000_000,
  env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "7000" },
})).stdout;
const evaluate = (source) => browser("eval", source);
const waitFor = (source) => browser("wait", "--fn", source);
const snapshot = () => browser("snapshot", "-i");
const assert = (condition, message) => evaluate(`(() => { if (!(${condition})) throw Error(${JSON.stringify(message)}); return true; })()`);
const selected = () => `document.querySelector('.split-inbox-tabs [aria-selected="true"]')?.dataset.splitId`;
const rowIn = (section, id) => `.sectioned-imbox-group[data-section="${section}"] #mail-row-${id}`;
const artifacts = await mkdtemp(join(tmpdir(), "hey-split-proof-"));
let phase = "startup";
const checkpoint = async (name) => { phase = name; await snapshot(); console.log(`Checking: ${name}`); };
const selectSplit = async (id) => {
  await browser("click", `.split-inbox-tabs [data-split-id="${id}"]`);
  await waitFor(`${selected()}===${JSON.stringify(id)}`);
};
const expandHistory = async () => {
  await snapshot();
  const collapsed = await evaluate(`document.querySelector('.sectioned-imbox-group[data-section="previouslySeen"] h2 button')?.getAttribute('aria-expanded')==='false'`);
  if (collapsed.trim() === "true") await browser("click", '.sectioned-imbox-group[data-section="previouslySeen"] h2 button');
};
const palette = async (id, query) => {
  await browser("press", "Control+k");
  await browser("wait", "#command-palette-input");
  await snapshot();
  await browser("fill", "#command-palette-input", query);
  await browser("click", `[id="command-${id}"]`);
};
const guardTab = async (selector, expected, label) => {
  await browser("focus", selector);
  await browser("press", "Tab");
  await assert(`${selected()}===${JSON.stringify(expected)}`, `${label} Tab changed the split`);
};
const captureEditor = async () => {
  await snapshot();
  await browser("screenshot", join(artifacts, "split-editor-desktop.png"));
  await browser("set", "viewport", "800", "800");
  await snapshot();
  await evaluate(`(() => {
    const body=document.querySelector('.split-manager-body');
    body.scrollTop=body.scrollHeight;
    const dialog=document.querySelector('.split-manager').getBoundingClientRect();
    const footer=document.querySelector('.split-manager-footer').getBoundingClientRect();
    if (dialog.left<0||dialog.right>innerWidth||dialog.top<0||dialog.bottom>innerHeight) throw Error('Compact split editor overflow');
    if (footer.bottom>innerHeight||footer.top<0) throw Error('Compact split editor footer is not visible');
    if (body.scrollHeight>body.clientHeight&&body.scrollTop===0) throw Error('Compact split editor body cannot scroll');
    return true;
  })()`);
  await browser("screenshot", join(artifacts, "split-editor-compact.png"));
  await browser("set", "viewport", "1440", "1000");
  await evaluate(`document.querySelector('.split-manager-body').scrollTop=0`);
};

try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/?preview&split-inbox&theme=dusk`;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", url);
  await browser("set", "viewport", "1440", "1000");
  await browser("wait", '.split-inbox-tabs [data-split-id="vip"]');
  if (process.argv.includes("--capture-editor")) {
    await checkpoint("editor-only capture");
    await selectSplit("remaining");
    await browser("focus", "#mail-row-2103");
    await palette("split-create-person", "Create split from this sender");
    await browser("wait", ".split-editor");
    await snapshot();
    await browser("fill", ".split-editor-name", "Partners");
    await browser("click", ".split-preview-button");
    await browser("wait", ".split-preview");
    await captureEditor();
    console.log(`PASS: desktop and compact split editor bounds. Screenshots: ${artifacts}`);
  } else {
  await checkpoint("tabs, counts, and empty-filtered-page pagination");
  await evaluate(`(() => {
    if (document.querySelector('vite-error-overlay')) throw Error('Preview failed to load');
    const tabs = [...document.querySelectorAll('.split-inbox-tabs [role="tab"]')];
    if (tabs.map(tab => tab.dataset.splitId).join(',') !== 'all,vip,team,github,remaining') throw Error('Initial splits missing or reordered');
    const counts = Object.fromEntries(tabs.map(tab => [tab.dataset.splitId, Number(tab.querySelector('.split-inbox-count')?.textContent || 0)]));
    if (JSON.stringify(counts) !== JSON.stringify({ all:9, vip:4, team:5, github:1, remaining:2 })) throw Error('Incorrect pending counts: ' + JSON.stringify(counts));
    return true;
  })()`);
  await browser("screenshot", join(artifacts, "split-tabs-desktop.png"));
  await selectSplit("github");
  await expandHistory();
  // GitHub first appears at history index 100. A single scroll must advance
  // through earlier pages with no GitHub results; there is no Load More button.
  await evaluate(`(() => {const list=document.querySelector('.imbox-panel .mail-list');list.scrollTop=list.scrollHeight;list.dispatchEvent(new Event('scroll',{bubbles:true}));return true;})()`);
  await browser("wait", rowIn("previouslySeen", "3100"));
  await evaluate(`(() => {
    const pages = window.__sectionedImboxPreview.requests.flatMap(request => request.options?.page ? [request.options.page] : []);
    if (!pages.includes('sectioned:100')) throw Error('Older match did not fetch history through index 100: ' + pages);
    const rows = [...document.querySelectorAll('.imbox-panel .mail-row')].map(row => row.dataset.postingId);
    if (new Set(rows).size !== rows.length) throw Error('Overlapping history pages rendered duplicate rows');
    if ([...document.querySelectorAll('button')].some(button => /load more/i.test(button.textContent))) throw Error('Unexpected Load More button');
    return true;
  })()`);

  await checkpoint("Tab navigation, all workflow sections, and reader navigation");
  await selectSplit("all");
  await browser("focus", "#mail-row-2101");
  await browser("press", "Tab");
  await waitFor(`${selected()}==='vip'`);
  await waitFor(`document.activeElement?.id==='mail-row-2101'`);
  await browser("press", "Enter");
  await waitFor(`document.querySelector('.thread-panel')?.textContent.includes('Active one')`);
  await browser("press", "Escape");
  await browser("press", "Tab");
  await waitFor(`${selected()}==='team'`);
  await browser("press", "Shift+Tab");
  await waitFor(`${selected()}==='vip'`);
  await expandHistory();
  await evaluate(`(() => {
    if (document.querySelectorAll('.sectioned-imbox-group').length!==5) throw Error('Split lost workflow section headings');
    for (const [section,id] of [['replyLater','2201'],['setAside','2302'],['bubbledUp','2401'],['previouslySeen','3000']]) {
      if (!document.querySelector('.sectioned-imbox-group[data-section="'+section+'"] #mail-row-'+id)) throw Error('VIP did not preserve '+section);
    }
    if (document.querySelector('#mail-row-2102')) throw Error('Unmatched Team conversation leaked into VIP');
    return true;
  })()`);
  // Reselecting the current tab must not erase its published navigation rows.
  await selectSplit("vip");
  await browser("focus", "#mail-row-2201");
  await browser("press", "ArrowDown");
  await waitFor(`document.querySelector('#mail-row-2302')?.dataset.selected==='true'`);
  await browser("press", "Enter");
  await waitFor(`document.querySelector('.thread-panel')?.textContent.includes('Set Aside two')`);
  await checkpoint("Tab remains native in reader, search, AI, and email editors");
  await guardTab(".thread-panel .email-body", "vip", "Reader");
  await browser("press", "Escape");
  await browser("wait", rowIn("setAside", "2302"));
  await guardTab('.imbox-panel input[placeholder="Search Imbox"]', "vip", "Search");
  await guardTab(".agent-composer textarea", "vip", "AI composer");
  await browser("focus", "#mail-row-2201");
  await browser("press", "w");
  await browser("wait", ".mail-composer-dialog");
  await snapshot();
  await guardTab('.mail-composer-dialog textarea[placeholder="Write your message…"]', "vip", "Email composer");
  await browser("press", "Escape");
  await waitFor(`!document.querySelector('.mail-composer-dialog')`);

  await checkpoint("command palette navigation and sender/domain drafts");
  await browser("focus", "#mail-row-2201");
  await palette("split-go:team", "Go to split: Team");
  await waitFor(`${selected()}==='team'`);
  await browser("focus", "#mail-row-2102");
  await palette("split-create-person", "Create split from this sender");
  await browser("wait", ".split-editor");
  await snapshot();
  await assert(`document.querySelector('.split-editor textarea[placeholder="jamie@company.com"]').value==='drew@studio.example'`, "Sender command did not seed the person");
  await guardTab(".split-editor-name", "team", "Split dialog");
  await assert(`Boolean(document.activeElement?.closest('.split-manager'))`, "Tab escaped the split dialog");
  await browser("press", "Escape");
  await browser("focus", "#mail-row-2102");
  await palette("split-create-domain", "Create split from this sender’s domain");
  await browser("wait", ".split-editor");
  await snapshot();
  await assert(`document.querySelector('.split-editor textarea[placeholder="company.com"]').value==='studio.example'`, "Domain command did not seed the domain");
  await browser("press", "Escape");

  await checkpoint("preview, save, and durable fictional read-back");
  await selectSplit("remaining");
  await browser("focus", "#mail-row-2103");
  await palette("split-create-person", "Create split from this sender");
  await browser("wait", ".split-editor");
  await snapshot();
  await browser("fill", ".split-editor-name", "Partners");
  await evaluate(`window.__beforeSplitPreviewLabels=JSON.stringify(window.__splitInboxPreview.labelSnapshot())`);
  await browser("click", ".split-preview-button");
  await browser("wait", ".split-preview");
  await evaluate(`(() => {
    if (JSON.stringify(window.__splitInboxPreview.labelSnapshot()) !== window.__beforeSplitPreviewLabels) throw Error('Preview applied labels before save');
    if (!window.__splitInboxPreview.requests.some(request => request.operation==='preview')) throw Error('Preview did not use the preview API');
    if (document.querySelector('.split-preview h3')?.textContent.startsWith('0 ')) throw Error('Preview omitted matching mail');
    return true;
  })()`);
  await captureEditor();
  await browser("click", '.split-editor button[type="submit"]');
  await browser("wait", '[aria-label="Edit Partners"]');
  await evaluate(`(() => {
    const fixture=window.__splitInboxPreview;
    const saved=fixture.snapshot().splits.find(split=>split.name==='Partners');
    if (!saved?.labelId || saved.people[0]!=='hello@northline.example') throw Error('Saved rule or label missing');
    const durable=JSON.parse(localStorage.getItem(fixture.storageKey));
    if (!durable.splits.some(split=>split.id===saved.id)) throw Error('Save did not persist the definition');
    if (!fixture.labelSnapshot().find(label=>label.id===saved.labelId)?.postingIds.includes('2103')) throw Error('Save did not apply the linked label');
    return true;
  })()`);
  await snapshot();
  await browser("screenshot", join(artifacts, "split-manager-desktop.png"));
  await browser("press", "Escape");
  await browser("open", url);
  await browser("wait", '.split-inbox-tabs [data-split-id="vip"]');
  await checkpoint("persisted reload, overlapping Done and Undo");
  await assert(`window.__splitInboxPreview.snapshot().splits.some(split=>split.name==='Partners')`, "Saved split was lost on renderer reload");
  await selectSplit("vip");
  await expandHistory();
  await browser("focus", "#mail-row-2201");
  await browser("press", "e");
  await browser("wait", rowIn("previouslySeen", "2201"));
  await selectSplit("team");
  await expandHistory();
  await assert(`!document.querySelector('${rowIn("replyLater", "2201")}')&&Boolean(document.querySelector('${rowIn("previouslySeen", "2201")}'))`, "Done left a second copy active in the overlapping split");
  await browser("press", "Control+z");
  await browser("wait", rowIn("replyLater", "2201"));
  await selectSplit("vip");
  await browser("wait", rowIn("replyLater", "2201"));
  await evaluate(`(() => {
    const fixture=window.__sectionedImboxPreview;
    if (!fixture.mutations.some(request=>request.operation==='done'&&request.postingIds.includes('2201'))) throw Error('Done did not call the mutation API');
    if (!fixture.snapshot().laterbox.some(posting=>posting.id==='2201')) throw Error('Undo did not restore original Reply Later membership');
    return true;
  })()`);

  await checkpoint("manage command and compact layout");
  await palette("split-manage", "Manage splits");
  await browser("wait", '[aria-label="Edit Partners"]');
  await browser("press", "Escape");
  await browser("press", "Control+Shift+b");
  await browser("set", "viewport", "800", "800");
  await snapshot();
  await assert(`document.documentElement.scrollWidth<=window.innerWidth+2`, "Compact split tabs overflowed the page");
  await browser("screenshot", join(artifacts, "split-tabs-compact.png"));
  await browser("click", '[aria-label="Manage splits"]');
  await browser("wait", ".split-manager[open]");
  await snapshot();
  await assert(`document.querySelector('.split-manager').getBoundingClientRect().right<=window.innerWidth&&document.querySelector('.split-manager').getBoundingClientRect().left>=0`, "Compact split manager overflowed its viewport");
  await browser("screenshot", join(artifacts, "split-manager-compact.png"));
  const errors=await browser("errors");
  if (errors.trim()) throw Error(errors);
  console.log(`PASS: split counts and sections; Tab/Shift+Tab; arrows, Enter, Escape; native typing/reader/modal focus; palette create-person/domain, navigation and manage; non-mutating preview, label application, persisted reload; overlapping Done/Undo; index-100 history via empty filtered pages; desktop and compact bounds. Screenshots: ${artifacts}`);
  }
} catch (error) {
  const state=await evaluate(`JSON.stringify({phase:${JSON.stringify(phase)},split:${selected()},focused:document.activeElement?.outerHTML?.slice(0,500),thread:document.querySelector('.thread-panel h1')?.textContent,dialog:document.querySelector('dialog[open]')?.textContent?.slice(0,500),rows:[...document.querySelectorAll('.imbox-panel .mail-row')].map(row=>row.dataset.postingId),pages:window.__sectionedImboxPreview?.requests.filter(request=>request.options?.page)})`).catch(()=>"State unavailable after timeout.");
  console.error(`FAIL state: ${state}\nArtifacts: ${artifacts}`);
  await browser("screenshot", join(artifacts,"split-failure.png")).catch(()=>{});
  throw error;
} finally {
  clearTimeout(deadline);
  await exec(binary,["--session",session,"close"],{timeout:8_000}).catch(()=>{});
  await server.close();
}
