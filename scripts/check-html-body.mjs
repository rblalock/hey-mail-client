// One bounded, headless, muted check. Fictional mail only; no Electron or HEY CLI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const attr = (value) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const content = `<main style="padding:24px"><h2 onclick="window.__unsafe=true">Weekly usage recap</h2>
  <table cellpadding="12"><tbody><tr><th>Project</th><th>Usage</th></tr><tr><td>Demo workspace</td><td>24 hours</td></tr></tbody></table>
  <img src="https://images.example.test/usage.png" width="240" height="80" onerror="window.__unsafe=true">
  <a href="javascript:window.__unsafe=true">Unsafe link</a><script>window.__unsafe=true</script></main>`;
const nested = `<action-text-attachment content-type="text/html" content="${attr(content)}"></action-text-attachment>`;
const trix = attr(JSON.stringify({ contentType: "text/html", content: nested }));
const receiptHtml = `<article data-entry-id="receipt-entry"><header>From: Demo Billing — 2026-09-28T12:00:00Z</header>
  <figure data-trix-attachment="${trix}"></figure>
  <action-text-attachment content-type="application/pdf" filename="usage.pdf" url="https://files.example.test/usage.pdf"></action-text-attachment></article>`;

const exec = promisify(execFile);
const session = `hey-html-body-check-${process.pid}`;
const binary = process.env.AGENT_BROWSER_BIN || "agent-browser";
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 45_000);
const server = await createServer({ configFile: false, root: "src/renderer", plugins: [react(), tailwind()], server: { host: "127.0.0.1", port: 0 } });
const browser = async (...args) => (await exec(binary, ["--session", session, ...args], { timeout: 12_000, signal: controller.signal, maxBuffer: 1_000_000 })).stdout;
const evaluate = (source) => browser("eval", source);

try {
  const { parseThreadHtmlDocument } = await server.ssrLoadModule(`/@fs/${resolve("src/main/email-html.ts")}`);
  const parsed = parseThreadHtmlDocument(receiptHtml).get("receipt-entry");
  assert.ok(parsed?.html?.includes("Weekly usage recap"), "The production parser lost the nested HTML body");
  assert.deepEqual(parsed.attachmentNames, ["usage.pdf"], "The HTML body was mistaken for a file");
  const { attachmentNames: _files, senderName: _sender, occurredAt: _date, ...richBody } = parsed;
  const entry = {
    id: "receipt-entry", sender: { name: "Demo Billing", email: "billing@example.test" },
    occurredAt: "2026-09-28T12:00:00Z", body: "📎 attachment", ...richBody,
    attachments: [{ id: "receipt-file", messageId: "receipt-entry", filename: "usage.pdf", contentType: "application/pdf", byteSize: 2048 }],
  };
  await server.listen();
  const port = server.httpServer.address().port;
  await browser("--headed", "false", "--executable-path", process.env.CHROMIUM_BIN || "/usr/bin/chromium", "--args", "--mute-audio,--disable-gpu", "open", `http://127.0.0.1:${port}/?preview&theme=dusk`);
  await browser("wait", '[role="option"]');
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    window.heyAgent.mail.readCachedThread = async () => undefined;
    window.heyAgent.mail.readThread = async topicId => ({topicId, subject:'Weekly usage recap', entries:[${JSON.stringify(entry)}]});
    return true;
  })()`);
  await browser("focus", '[role="option"]');
  await browser("press", "Enter");
  await browser("wait", ".email-document-frame");
  await browser("wait", "--fn", `document.querySelector('.email-document-frame')?.contentDocument?.querySelector('h2')?.textContent === 'Weekly usage recap' && document.querySelector('.email-document-frame').getBoundingClientRect().height > 48`);
  await browser("snapshot", "-i");
  await evaluate(`(() => {
    const frame = document.querySelector('.email-document-frame');
    const doc = frame.contentDocument;
    if (!doc.querySelector('table')?.textContent.includes('24 hours')) throw Error('Receipt table missing');
    if (document.querySelector('.thread-notice[role="alert"]')) throw Error('False attachment warning');
    if (document.querySelectorAll('.received-attachment').length !== 1 || !document.querySelector('.received-attachment').textContent.includes('usage.pdf')) throw Error('Real PDF card missing');
    if (doc.querySelector('script,[onclick],[onerror],a[href^="javascript:"]') || frame.contentWindow.__unsafe) throw Error('Unsafe content survived');
    const remote = doc.querySelector('img[data-remote-src]');
    if (!remote?.src.startsWith('data:image/') || !document.querySelector('.email-remote-control')?.textContent.includes('blocked')) throw Error('External images not blocked');
    return true;
  })()`);
  // Center the card clear of the sticky reply composer before the pointer check.
  await evaluate(`(() => {
    window.heyAgent.mail.openAttachment = async (topicId, attachmentId) => { window.__openedFile = {topicId, attachmentId}; };
    document.querySelector('button[aria-label="Open usage.pdf"]').scrollIntoView({block:'center'});
    return true;
  })()`);
  await browser("snapshot", "-i");
  await browser("click", 'button[aria-label="Open usage.pdf"]');
  await browser("wait", "--fn", "window.__openedFile?.attachmentId === 'receipt-file'");
  const artifact = join(await mkdtemp(join(tmpdir(), "hey-html-body-proof-")), "receipt.png");
  await browser("screenshot", artifact);
  // Real keyboard input after focusing inside the email exercises iframe Escape forwarding.
  await evaluate(`document.querySelector('.email-document-frame').contentWindow.focus(); true`);
  await browser("press", "Escape");
  await browser("wait", "--fn", "!document.querySelector('.email-document-frame') && !!document.querySelector('[role=option]')");
  await browser("snapshot", "-i");
  const errors = await browser("errors");
  if (errors.trim()) throw Error(errors);
  console.log(`PASS: nested HTML body, receipt table and frame sizing, real PDF card/action, no false file warning, safe scripts/links, blocked external images, and iframe Escape. Screenshot: ${artifact}`);
} finally {
  clearTimeout(deadline);
  await exec(binary, ["--session", session, "close"], { timeout: 8_000 }).catch(() => {});
  await server.close();
}
