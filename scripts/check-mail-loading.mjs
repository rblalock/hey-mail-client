// One bounded headless/muted pass, entirely fictional. No Electron, HEY CLI,
// real mailbox reads, or mail writes. Deliberately held promises prove ordering.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const fixture = `
import { previewApi } from '/src/preview.ts';
localStorage.clear();
const api = previewApi();
await api.settings.update({imboxLayout:'hey', mailCache:{enabled:true,prefetch:false}, sound:{enabled:false}});
const listeners = new Set(), previews = new Set(), overviewResolves = [];
const proof = window.__loadingProof = {mailboxes:[],reads:{},replyCalls:0,overviewCalls:0,overviewDone:false,finalDone:{},finish:{},timings:{}};
const rows = [1,2].map(n => ({id:String(2000+n),topicId:String(1000+n),subject:'Fictional loading check '+n,
  summary:'Example conversation only',seen:false,createdAt:new Date().toISOString(),visibleEntryCount:1,
  sender:{name:'Example Sender '+n,email:'sender'+n+'@example.test'},contacts:[]}));
const feed = Array.from({length:62},(_,n)=>({...rows[0],id:String(3000+n),topicId:String(4000+n),subject:'Fictional newsletter '+n,seen:true}));
api.mail.listMailbox = async (box, options={}) => {
  proof.mailboxes.push({box,options});
  if (!proof.firstMailboxAt) proof.firstMailboxAt = performance.now();
  return {status:'ready',boxKey:box,boxName:box==='feedbox'?'The Feed':'Imbox',
    postings:box==='imbox'?structuredClone(rows):box==='feedbox'?structuredClone(options.page?feed.slice(60):feed.slice(0,60)):[],
    ...(box==='feedbox'&&!options.page?{nextPage:'feed-page-2'}:{})};
};
api.mail.listImbox = () => api.mail.listMailbox('imbox',{paginated:true,singlePage:true});
api.mail.getOverview = () => { proof.overviewCalls++; return new Promise(resolve=>overviewResolves.push(resolve)); };
proof.finishOverview = () => { proof.overviewDone=true; overviewResolves.forEach(resolve=>resolve({screener:{status:'ready',entries:[]},replyLater:{count:0}})); };
api.mail.subscribe = listener => {listeners.add(listener);return ()=>listeners.delete(listener);};
api.mail.subscribeThreadPreview = listener => {previews.add(listener);return ()=>previews.delete(listener);};
proof.emitSeen = () => listeners.forEach(listener=>listener({change:'updated',metadataOnly:true,postingId:'2001',topicId:'1001',postingSeen:true,box:{id:'1',key:'imbox',name:'Imbox'}}));
api.mail.readCachedThread = async () => undefined;
api.mail.readThread = (topicId,requestId) => {
  proof.reads[topicId]=(proof.reads[topicId]||0)+1;
  proof['readStarted'+topicId]=performance.now();
  const thread={topicId,subject:'Fictional loading check',entries:[{id:topicId+'-entry',sender:{name:'Example Sender'},occurredAt:new Date().toISOString(),body:'Useful body for '+topicId}]};
  queueMicrotask(()=>previews.forEach(listener=>listener({requestId,thread:{...thread,attachmentsLoading:true}})));
  return new Promise(resolve=>{proof.finish[topicId]=()=>{proof.finalDone[topicId]=true;resolve({...thread,entries:thread.entries.map(entry=>({...entry,attachments:[]}))});};});
};
const reply = api.mail.getReplyContext;
api.mail.getReplyContext = async id => {proof.replyCalls++;return reply(id);};
window.heyAgent=api;
document.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&document.activeElement?.id==='mail-row-2001'&&proof.finalDone['1001'])proof.reopenAt=performance.now();
},true);
new MutationObserver(()=>{
  if(proof.timings.firstMailboxMs===undefined&&document.querySelector('#mail-row-2001'))proof.timings.firstMailboxMs=Math.round(performance.now()-proof.firstMailboxAt);
  if(proof.timings.firstBodyMs===undefined&&document.querySelector('.thread-panel .email-body')?.textContent.includes('Useful body for 1001'))proof.timings.firstBodyMs=Math.round(performance.now()-proof.readStarted1001);
  if(proof.reopenAt&&proof.timings.cachedReopenMs===undefined&&document.querySelector('.thread-panel .email-body')?.textContent.includes('Useful body for 1001'))proof.timings.cachedReopenMs=Math.round(performance.now()-proof.reopenAt);
}).observe(document.getElementById('root'),{childList:true,subtree:true});
await import('/src/main.tsx');
`;

const exec = promisify(execFile);
const session = `hey-loading-check-${process.pid}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 90_000);
const browser = async (...args) => (await exec(binary, ["--session", session, ...args], {
  timeout: 12_000, signal: controller.signal, maxBuffer: 1_000_000,
  env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "8000" },
})).stdout;
const evaluate = (source) => browser("eval", source);
const server = await createServer({
  configFile: false, root: "src/renderer", plugins: [react(), tailwind(), {
    name: "fictional-mail-loading-check",
    transformIndexHtml: (html) => html.replace('src="/src/main.tsx"', 'src="/__mail_loading_fixture.js"'),
    configureServer(server) {
      server.middlewares.use("/__mail_loading_fixture.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript"); res.end(fixture);
      });
    },
  }], server: { host: "127.0.0.1", port: 0, watch: null, hmr: false },
});

try {
  await server.listen();
  const port = server.httpServer.address().port;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", `http://127.0.0.1:${port}/?preview&theme=dusk`);
  await browser("set", "viewport", "1440", "900");
  await browser("wait", "#mail-row-2001");
  await browser("wait", "--fn", "window.__loadingProof.overviewCalls > 0");
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    const p=window.__loadingProof;
    if(!p.overviewCalls||p.overviewDone)throw Error('Overview was not held while mailbox painted');
    if(p.mailboxes.some(call=>['feedbox','trailbox'].includes(call.box)))throw Error('Unrelated mailboxes loaded at startup');
    if(p.mailboxes.some(call=>!call.options.singlePage||!call.options.paginated))throw Error('Unbounded startup mailbox read');
    p.finishOverview(); return true;
  })()`);
  await browser("focus", "#mail-row-2001");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.querySelector('.thread-panel .email-body')?.textContent.includes('Useful body for 1001')");
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    const p=window.__loadingProof;
    if(p.finalDone['1001']||!document.querySelector('.thread-panel [role=status]')?.textContent.includes('attachment'))throw Error('Body waited for attachments');
    if(p.replyCalls!==0)throw Error('Reply recipients loaded while only reading');
    p.emitSeen(); p.finish['1001'](); return true;
  })()`);
  await browser("wait", "--fn", "!document.querySelector('.thread-panel [role=status]')");
  await browser("click", '.message-actions > button[data-shortcut-id="reply"]');
  await browser("wait", ".reply-recipient-fields");
  await browser("snapshot", "-i");
  await evaluate(`(() => {const p=window.__loadingProof;if(p.replyCalls!==1||p.reads['1001']!==1)throw Error('Recipient lookup or seen echo reloaded conversation');return true;})()`);
  await browser("click", '[aria-label="Collapse reply"]');
  await browser("focus", ".thread-scroll");
  await browser("press", "Escape");
  await browser("wait", "#mail-row-2002");
  await browser("focus", "#mail-row-2002");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.querySelector('.thread-panel .email-body')?.textContent.includes('Useful body for 1002')");
  await evaluate(`window.__loadingProof.finish['1002'](); true`);
  await browser("wait", "--fn", "!document.querySelector('.thread-panel [role=status]')");
  await browser("press", "Escape");
  await browser("wait", "#mail-row-2001");
  await browser("focus", "#mail-row-2001");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.querySelector('.thread-panel .email-body')?.textContent.includes('Useful body for 1001')");
  await evaluate(`(() => {const p=window.__loadingProof;if(p.reads['1001']!==1||p.reads['1002']!==1)throw Error('Fresh reader cache was invalidated');return true;})()`);
  await browser("press", "Escape");
  await browser("snapshot", "-i");
  await browser("click", '.nav-row[data-tooltip="The Feed"]');
  await browser("wait", "#mail-row-3000");
  await browser("snapshot", "-i");
  await evaluate(`(() => {const calls=window.__loadingProof.mailboxes.filter(call=>call.box==='feedbox');if(calls.length!==1||!calls[0].options.singlePage||calls[0].options.page)throw Error('Feed eagerly loaded history');return true;})()`);
  await browser("scroll", "down", "50000", "--selector", ".imbox-panel:not([hidden]) .mail-list");
  await browser("wait", "#mail-row-3060");
  const evidence = await evaluate(`(() => {
    const p=window.__loadingProof,calls=p.mailboxes.filter(call=>call.box==='feedbox');
    if(calls.length!==2||calls[1].options.page!=='feed-page-2'||!calls[1].options.singlePage)throw Error('Scroll did not request just the next page');
    if(p.mailboxes.filter(call=>call.box==='imbox').length!==1)throw Error('Opening and reading conversations duplicated the Imbox head read');
    if(document.querySelector('vite-error-overlay'))throw Error('Renderer error overlay');
    return {timings:p.timings,threadReads:p.reads,replyLookups:p.replyCalls,mailboxReads:p.mailboxes};
  })()`);
  const errors = await browser("errors");
  if (errors.trim()) throw Error(errors);
  console.log(`PASS: mailbox paints before overview; no unrelated startup reads; body before held attachments; reply lookup only on Reply; seen echo preserves cache; Escape/Enter selects correct threads; cached reopen; Feed loads one next page on scroll. Timings are fictional-fixture render measurements, not live HEY network benchmarks.\n${evidence}`);
} finally {
  clearTimeout(deadline);
  await exec(binary, ["--session", session, "close"], { timeout: 8_000 }).catch(() => {});
  await server.close();
}
