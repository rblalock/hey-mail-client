// One bounded, headless, muted renderer check. No Electron, HEY writes or system clipboard.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const exec = promisify(execFile);
const session = `hey-attachment-check-${process.pid}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 60_000);
const browser = async (...args) => (await exec(binary, ["--session", session, ...args], { timeout: 12_000, signal: controller.signal, maxBuffer: 1_000_000 })).stdout;
const evaluate = (source) => browser("eval", source);
try {
  await server.listen();
  const port = server.httpServer.address().port;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", `http://127.0.0.1:${port}/?preview&theme=dusk`);
  await browser("wait", '[role="option"]');
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    if (document.querySelector('vite-error-overlay') || !document.querySelector('.compose-row')) throw Error('Preview failed to load');
    window.__uploads = []; window.__sent = [];
    window.heyAgent.mail.listSenders = async () => [{id:'1',email:'alex@example.test',default:true},{id:'2',email:'team@example.test',default:false}];
    window.heyAgent.mail.importAttachments = async files => {
      if (files.some(file => !file.bytes.byteLength)) throw Error('Empty files');
      if (window.__rejectImport) throw Error('Synthetic upload failure');
      const paths = files.map(file => '/synthetic/' + file.name);
      window.__uploads.push(...files.map(file => ({name:file.name, bytes:file.bytes.length})));
      return paths;
    };
    const canvas = document.createElement('canvas'); canvas.width=120; canvas.height=80;
    const ctx = canvas.getContext('2d'); ctx.fillStyle='#347880'; ctx.fillRect(0,0,120,80); ctx.fillStyle='white'; ctx.font='16px sans-serif'; ctx.fillText('Demo image',10,44);
    window.heyAgent.mail.describeAttachments = async paths => paths.map(path => ({path,name:path.split('/').pop(),byteSize:128,previewUrl:path.endsWith('.png')?canvas.toDataURL():undefined}));
    window.heyAgent.mail.removeComposerAttachments = async () => {};
    window.heyAgent.mail.send = async request => {window.__sent.push(request);return {disposition:request.saveAsDraft?'draft':'sent',message:'Synthetic success'};};
    window.__paste = (selector, name, type, drop=false) => {
      const target=document.querySelector(selector); const data=new DataTransfer();
      data.items.add(new File(['fictional bytes'],name,{type}));
      const event=drop?new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}):new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
      target.dispatchEvent(event); if(!event.defaultPrevented) throw Error('File event was not handled');
    };
    return true;
  })()`);
  await browser("click", ".compose-row");
  await browser("fill", 'input[aria-label="To recipients"]', "casey@example.test");
  await browser("fill", 'input[placeholder="Subject"]', "Attachment demo");
  await browser("select", 'select[aria-label="From"]', "team@example.test");
  await browser("fill", 'textarea[placeholder="Write your message…"]', "First paragraph.\n\nSecond paragraph.");
  await evaluate(`window.__paste('textarea[placeholder="Write your message…"]','image.png','image/png')`);
  await browser("wait", 'button[aria-label="Remove image.png"]');
  await evaluate(`window.__paste('textarea[placeholder="Write your message…"]','video.mp4','video/mp4',true)`);
  await browser("wait", 'button[aria-label="Remove video.mp4"]');
  await evaluate(`(() => {
    const input=document.querySelector('textarea[placeholder="Write your message…"]');
    const data=new DataTransfer();data.setData('text/plain','plain text');
    const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});input.dispatchEvent(event);
    if(event.defaultPrevented || !input.value.includes('Second paragraph.')) throw Error('Text paste was intercepted');
    if(!document.querySelector('.composer-file img')) throw Error('No image preview');
    return true;
  })()`);
  const artifact = join(await mkdtemp(join(tmpdir(), "hey-composer-proof-")), "composer.png");
  await browser("screenshot", artifact);
  await browser("click", 'button[aria-label="Close composer"]');
  await browser("click", ".compose-row");
  await browser("wait", 'button[aria-label="Remove image.png"]');
  await browser("click", 'button[aria-label="Remove video.mp4"]');
  await evaluate(`window.__rejectImport=true;window.__paste('textarea[placeholder="Write your message…"]','failed.png','image/png')`);
  await browser("wait", ".composer-error");
  await evaluate(`(() => {if(!document.querySelector('.composer-error').textContent.includes('Synthetic upload failure') || document.querySelector('[aria-label="Remove failed.png"]')) throw Error('Failure was swallowed');window.__rejectImport=false;return true;})()`);
  await browser("click", ".mail-composer-dialog .send-button");
  await evaluate(`(() => {const sent=window.__sent[0];if(sent?.from!=='team@example.test'||sent.attachments.join(',')!=='/synthetic/image.png'||!sent.body.includes('Second paragraph.'))throw Error('Bad send payload: '+JSON.stringify({sent,errors:document.querySelector('.composer-error')?.textContent}));return true;})()`);
  await browser("focus", '[role="option"]');
  await browser("press", "Enter");
  await browser("wait", ".thread-reply-collapsed");
  await browser("click", ".thread-reply-collapsed");
  await evaluate(`window.__paste('textarea[placeholder="Write your reply…"]','report.pdf','application/pdf')`);
  await browser("wait", 'button[aria-label="Remove report.pdf"]');
  await browser("click", ".composer-draft-button");
  await evaluate(`(() => {const sent=window.__sent.at(-1);if(sent.mode!=='reply'||!sent.saveAsDraft||sent.attachments[0]!=='/synthetic/report.pdf')throw Error('Reply attachments lost');return true;})()`);
  const errors = await browser("errors"); if (errors.trim()) throw Error(errors);
  console.log(`PASS: paste, drop, image preview, local draft persistence, removal, import errors, plain-text paste, selected sender, send and reply draft payloads. Screenshot: ${artifact}`);
} finally {
  clearTimeout(deadline);
  await exec(binary, ["--session", session, "close"], { timeout: 10_000 }).catch(() => {});
  await server.close();
}
