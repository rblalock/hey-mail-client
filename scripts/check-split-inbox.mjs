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
const deadline = setTimeout(() => controller.abort(), 180_000);
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
  await waitFor(`!document.querySelector('.imbox-titlebar .is-spinning')`);
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
  await evaluate(`document.querySelector('.split-manager-body').scrollTop=0`);
  await browser("screenshot", join(artifacts, "split-editor-compact-rules.png"));
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
    if (counts.all!==9 || counts.remaining!==2) throw Error('Incorrect workflow counts: ' + JSON.stringify(counts));
    if (tabs.filter(tab=>['vip','team','github'].includes(tab.dataset.splitId)).some(tab=>tab.querySelector('.split-inbox-count'))) throw Error('Named split displayed an incomplete total as authoritative');
    return true;
  })()`);
  await browser("screenshot", join(artifacts, "split-tabs-desktop.png"));
  await selectSplit("github");
  await checkpoint("warm split reuse without eager history scans");
  await assert(`window.__splitInboxPreview.requests.filter(request=>request.operation==='list'&&request.splitId==='github'&&request.page).length===0`, "Opening a sparse split eagerly scanned history");
  await evaluate(`window.__githubReads=window.__splitInboxPreview.requests.filter(request=>request.operation==='list'&&request.splitId==='github').length`);
  await selectSplit("team");
  await selectSplit("github");
  await assert(`window.__splitInboxPreview.requests.filter(request=>request.operation==='list'&&request.splitId==='github').length===window.__githubReads`, "Warm A to B to A refetched the split");
  await expandHistory();
  // GitHub first appears at history index 100. A single scroll must advance
  // through earlier pages with no GitHub results; there is no Load More button.
  await browser("scroll", "down", "10000", "--selector", ".imbox-panel .mail-list");
  // The browser CLI scrolls programmatically. End supplies the actual forward
  // keyboard intent required for fetching history (restoration alone must not).
  await browser("focus", ".imbox-panel .mail-list");
  await browser("press", "End");
  await browser("wait", rowIn("previouslySeen", "3100"));
  await evaluate(`(() => {
    const pages = window.__splitInboxPreview.requests.filter(request=>request.operation==='list'&&request.splitId==='github'&&request.page);
    if (pages.length<4) throw Error('Older match did not fetch past empty pages: ' + JSON.stringify(pages));
    const rows = [...document.querySelectorAll('.imbox-panel .mail-row')].map(row => row.dataset.postingId);
    if (new Set(rows).size !== rows.length) throw Error('Overlapping history pages rendered duplicate rows');
    if ([...document.querySelectorAll('button')].some(button => /load more/i.test(button.textContent))) throw Error('Unexpected Load More button');
    return true;
  })()`);
  await checkpoint("returning to a split retains rows, highlight, and scroll");
  await browser("focus", "#mail-row-3100");
  await evaluate(`window.__splitReturn={scrollTop:document.querySelector('.imbox-panel .mail-list').scrollTop,rows:[...document.querySelectorAll('.imbox-panel .mail-row')].map(row=>row.dataset.postingId).join(','),reads:window.__splitInboxPreview.requests.filter(request=>request.operation==='list'&&request.splitId==='github').length}`);
  await selectSplit("team");
  await selectSplit("github");
  await waitFor(`document.querySelector('#mail-row-3100')?.dataset.selected==='true'`);
  await assert(`Math.abs(document.querySelector('.imbox-panel .mail-list').scrollTop-window.__splitReturn.scrollTop)<2`, "Returning to a split lost the scroll position");
  await assert(`[...document.querySelectorAll('.imbox-panel .mail-row')].map(row=>row.dataset.postingId).join(',')===window.__splitReturn.rows`, "Returning to a split lost loaded history");
  await assert(`window.__splitInboxPreview.requests.filter(request=>request.operation==='list'&&request.splitId==='github').length===window.__splitReturn.reads`, "Returning to loaded history fetched it again");

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
    if (document.querySelectorAll('.sectioned-imbox-group').length!==8) throw Error('Split lost account workflow section headings');
    for (const [section,id] of [['replyLater','2201'],['setAside','2302'],['bubbledUp','2401'],['scheduledBubbleUp','2501'],['feed','2601'],['previouslySeen','3000']]) {
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
  await guardTab('.imbox-panel .mail-search input', "vip", "Search");
  await guardTab(".agent-composer textarea", "vip", "AI composer");
  await browser("focus", "#mail-row-2201");
  await browser("press", "w");
  await browser("wait", ".mail-composer-dialog");
  await snapshot();
  await guardTab('.mail-composer-dialog textarea[placeholder="Write your message…"]', "vip", "Email composer");
  await browser("press", "Escape");
  await waitFor(`!document.querySelector('.mail-composer-dialog')`);

  await checkpoint("recover Tab from sidebar, toolbar, and body focus");
  await browser("focus", '.sidebar nav[aria-label="Mail"] button[data-active="true"]');
  await browser("press", "Tab");
  await waitFor(`${selected()}==='team'`);
  await browser("focus", '.imbox-titlebar button[aria-label="Refresh Team"]');
  await browser("press", "Shift+Tab");
  await waitFor(`${selected()}==='vip'`);
  await evaluate(`document.activeElement?.blur()`);
  await browser("press", "Tab");
  await waitFor(`${selected()}==='team'`);
  await waitFor(`document.activeElement?.classList.contains('mail-row')`);
  await browser("press", "Enter");
  await browser("wait", ".thread-panel");
  await browser("press", "Escape");

  await checkpoint("account-wide Feed and Paper Trail with source-correct Done");
  await browser("wait", rowIn("feed", "2601"));
  await browser("wait", rowIn("paperTrail", "2701"));
  await browser("focus", "#mail-row-2601");
  await browser("press", "e");
  await waitFor(`window.__sectionedImboxPreview.snapshot().feedbox.find(row=>row.id==='2601')?.seen===true`);
  await assert(`Boolean(document.querySelector('${rowIn("feed", "2601")}'))&&!window.__sectionedImboxPreview.snapshot().imbox.some(row=>row.id==='2601')`, "Done moved Feed mail out of its source");
  await browser("press", "Control+z");
  await waitFor(`window.__sectionedImboxPreview.snapshot().feedbox.find(row=>row.id==='2601')?.seen===false`);

  await checkpoint("command palette navigation and sender/domain drafts");
  await browser("focus", "#mail-row-2201");
  await palette("split-go:team", "Go to split: Team");
  await waitFor(`${selected()}==='team'`);
  await browser("focus", "#mail-row-2301");
  await palette("split-create-person", "Create split from this sender");
  await browser("wait", ".split-editor");
  await snapshot();
  await assert(`document.querySelector('[aria-label="People entries"]')?.textContent.includes('drew@studio.example')`, "Sender command did not seed the person");
  await guardTab(".split-editor-name", "team", "Split dialog");
  await assert(`Boolean(document.activeElement?.closest('.split-manager'))`, "Tab escaped the split dialog");
  await browser("press", "Escape");
  await browser("focus", "#mail-row-2301");
  await palette("split-create-domain", "Create split from this sender’s domain");
  await browser("wait", ".split-editor");
  await snapshot();
  await assert(`document.querySelector('[aria-label="Domains entries"]')?.textContent.includes('studio.example')`, "Domain command did not seed the domain");
  await browser("fill", 'input[placeholder="Add a domain"]', "agentcompany.com,agentuity.com");
  await browser("press", "Enter");
  await assert(`document.querySelectorAll('[aria-label="Domains entries"] li').length===3`, "Comma-separated domains did not become separate entries");
  await browser("fill", 'input[placeholder="Add a domain"]', "*.invalid.example");
  await browser("press", "Enter");
  await assert(`document.querySelector('input[placeholder="Add a domain"]').value==='*.invalid.example'&&document.querySelector('input[placeholder="Add a domain"]').getAttribute('aria-invalid')==='true'`, "Invalid domain was silently lost or accepted");
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

  await checkpoint("create manual split from bulk Add to split and merge later rules");
  await selectSplit("all");
  await browser("focus", "#mail-row-2102");
  await browser("press", "x");
  await browser("focus", "#mail-row-2103");
  await browser("press", "x");
  await palette("split-add", "Add to existing split");
  await browser("wait", ".split-add-dialog");
  await snapshot();
  await assert(`document.querySelector('.split-add-dialog input[value="conversation"]').checked`, "Add dialog should default to only selected conversations");
  await browser("screenshot", join(artifacts, "add-to-split-desktop.png"));
  await browser("set", "viewport", "800", "800");
  await assert(`document.querySelector('.split-add-dialog').getBoundingClientRect().right<=innerWidth&&document.querySelector('.split-add-dialog').getBoundingClientRect().bottom<=innerHeight`, "Add dialog overflowed compact viewport");
  await browser("screenshot", join(artifacts, "add-to-split-compact.png"));
  await browser("set", "viewport", "1440", "1000");
  await browser("click", ".split-add-create");
  await browser("wait", ".split-editor-name");
  await snapshot();
  await browser("fill", ".split-editor-name", "Reading");
  await browser("click", ".split-preview-button");
  await browser("wait", ".split-preview");
  await browser("click", '.split-editor button[type="submit"]');
  await browser("wait", '[aria-label="Edit Reading"]');
  await browser("press", "Escape");
  await browser("wait", ".split-add-dialog");
  await snapshot();
  const readingId = JSON.parse((await evaluate(`window.__splitInboxPreview.snapshot().splits.find(split=>split.name==='Reading').id`)).trim());
  await browser("select", ".split-add-dialog select", readingId);
  await browser("click", '.split-add-dialog button[type="submit"]');
  await waitFor(`!document.querySelector('.split-add-dialog')`);
  await assert(`(() => {const fixture=window.__splitInboxPreview;const split=fixture.snapshot().splits.find(split=>split.name==='Reading');const members=fixture.labelSnapshot().find(label=>label.id===split.labelId)?.postingIds;return !split.people.length&&!split.domains.length&&members?.includes('2102')&&members?.includes('2103')})()`, "Bulk addition did not persist manual membership without rules");
  await selectSplit(readingId);
  await browser("wait", "#mail-row-2102");
  await browser("wait", "#mail-row-2103");
  await browser("focus", "#mail-row-2103");
  await browser("press", "Enter");
  await browser("wait", ".thread-panel .email-body");
  await evaluate(`document.querySelector('.thread-scroll').scrollTop=0`);
  await snapshot();
  await assert(`document.querySelector('.thread-panel .message-actions > button:last-child')?.textContent.includes('Add to split')`, "Reader Add to split action missing");
  await browser("click", '.thread-panel .message-actions > button:last-child');
  await browser("wait", ".split-add-dialog");
  await browser("select", ".split-add-dialog select", "team");
  await browser("check", '.split-add-dialog input[value="domain"]');
  await browser("click", '.split-add-dialog button[type="submit"]');
  await waitFor(`!document.querySelector('.split-add-dialog')`);
  await assert(`(() => {const split=window.__splitInboxPreview.snapshot().splits.find(split=>split.id==='team');return split.domains.includes('studio.example')&&split.domains.includes('northline.example')})()`, "Adding a domain replaced existing rules");
  await browser("press", "Escape");

  await checkpoint("initial split failure is visible and retry refreshes membership");
  await selectSplit("all");
  await evaluate(`(() => {const mail=window.heyAgent.mail;window.__originalSplitList=mail.listSplitMail;let fail=true;mail.listSplitMail=async(...args)=>{if(fail){fail=false;throw Error('Preview offline: try again.')}return window.__originalSplitList(...args)};})()`);
  await selectSplit("github");
  await browser("wait", ".imbox-panel .empty-state");
  await assert(`document.querySelector('.imbox-panel .empty-state').textContent.includes('Preview offline')&&!document.querySelector('.imbox-panel .sectioned-imbox-group')`, "First-load error was hidden behind endless loading sections");
  await evaluate(`window.__refreshSplitCount=window.__splitInboxPreview.requests.filter(request=>request.operation==='refresh').length`);
  await browser("click", ".imbox-panel .empty-state button");
  await browser("wait", "#mail-row-2602");
  await assert(`window.__splitInboxPreview.requests.filter(request=>request.operation==='refresh').length>window.__refreshSplitCount`, "Named Refresh did not refresh linked label membership");

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
  console.log(`PASS: cached split return without refetch; retained rows/highlight/scroll; no eager history scan; account-wide sections; sidebar/toolbar/body Tab recovery; arrows, Enter, Escape; native editor/reader/dialog focus; comma-separated rules and invalid-input recovery; preview/save and persisted labels; bulk manual split creation; reader Add to split and additive domain rules; source-preserving Done/Undo; empty-page history continuation; first-load error recovery and membership refresh; desktop and compact bounds. Screenshots: ${artifacts}`);
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
