// Opt-in, read-only integration check. No Electron window, desktop opens,
// calendar writes, or mail mutations. Files are staged privately and removed.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { expect, it } from "vitest";
import { HeyAccountScope } from "../../resources/hey-account-scope.mjs";
import { readThread } from "./hey";
import { profileRequest } from "./profile-process";
import { previewCalendarInvite } from "./mail-calendar-invite";
import { resolveMailAttachment, saveMailAttachment } from "./mail-attachments";
import EmailAttachments from "../renderer/src/components/EmailAttachments";
import EmailBody from "../renderer/src/components/EmailBody";

const htmlTopic = process.env.HEY_HTML_TEST_TOPIC;
const htmlAccount = process.env.HEY_HTML_TEST_ACCOUNT;
it.skipIf(!htmlTopic || !htmlAccount)("renders a real HTML-wrapped email body without a false file warning", async () => {
  await profileRequest.run({ scope: new HeyAccountScope(htmlAccount!, "https://app.hey.com"), env: process.env }, async () => {
    const thread = await readThread(htmlTopic!, process.env, { includeHtml: true });
    expect(thread.attachmentsError).toBeUndefined();
    const richEntries = thread.entries.filter((entry) => entry.html);
    expect(richEntries.length).toBeGreaterThan(0);
    for (const entry of richEntries) {
      const body = load(entry.html!);
      body("style, script").remove();
      const text = body.root().text().trim();
      expect(text.length).toBeGreaterThan(100);
      expect(entry.html).not.toContain("<action-text-attachment");
      const rendered = renderToStaticMarkup(<EmailBody entry={entry} />);
      expect(rendered).toContain("email-document-frame");
      expect(rendered).toContain("srcDoc=");
    }
    console.log(`Verified ${richEntries.length} real HTML bodies through account-scoped loading and iframe rendering. No mail changes.`);
  });
}, 45_000);

const topic = process.env.HEY_ATTACHMENT_TEST_TOPIC;
const account = process.env.HEY_ATTACHMENT_TEST_ACCOUNT;
it.skipIf(!topic || !account)("loads, renders, and saves real attachments through the account-scoped app services", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hey-attachment-integration-"));
  try {
    await profileRequest.run({ scope: new HeyAccountScope(account!, "https://app.hey.com"), env: process.env }, async () => {
      const thread = await readThread(topic!, process.env, { includeHtml: true });
      expect(thread.attachmentsError).toBeUndefined();
      const files = thread.entries.flatMap((entry) => entry.attachments ?? []);
      expect(files.length).toBeGreaterThan(0);
      expect(files.length).toBeLessThanOrEqual(10);
      const html = renderToStaticMarkup(<EmailAttachments topicId={topic!} attachments={files} />);
      expect(html.match(/class="received-attachment"/g)?.length).toBe(files.length);
      for (const [index, file] of files.entries()) {
        const canonical = await resolveMailAttachment(topic!, file.id);
        const destination = join(directory, String(index));
        await saveMailAttachment(canonical, destination);
        const bytes = await readFile(destination);
        expect(bytes.length).toBe(file.byteSize);
        if (file.filename.endsWith(".pkpass")) expect(bytes.subarray(0, 2).toString()).toBe("PK");
        if (file.filename.endsWith(".pdf")) expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        if (file.filename.endsWith(".ics")) {
          expect(bytes.toString()).toContain("BEGIN:VCALENDAR");
          const invite = await previewCalendarInvite(topic, file.id);
          expect(invite.title).toBeTruthy();
          expect(invite.copy?.invites).toBeUndefined();
          expect(html).toContain("Preview event");
        }
      }
      console.log(`Verified ${files.length} real attachments: account-scoped read, card rendering, and byte-checked saves. No mail/calendar changes.`);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 90_000);
