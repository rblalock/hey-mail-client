import { describe, expect, it } from "vitest";
import { normalizeHeyHtmlFragment, parseThreadHtmlDocument } from "./email-html";

function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function htmlAttachment(content: string): string {
  return `<action-text-attachment content-type="text/html" content="${attribute(content)}"></action-text-attachment>`;
}

describe("HEY HTML email parsing", () => {
  it("expands the Action Text HTML body nested inside a Trix HTML wrapper", () => {
    const content = htmlAttachment('<p>Your monthly usage recap.</p><p><a href="https://example.com/dashboard">View dashboard</a></p>');
    const trix = attribute(JSON.stringify({ contentType: "text/html" }));
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42"><figure data-trix-attachment="${trix}">${content}</figure></article>`).get("42");

    expect(entry?.html).toContain("Your monthly usage recap.");
    expect(entry?.html).toContain('href="https://example.com/dashboard"');
    expect(entry?.html).not.toContain("Attachment");
    expect(entry?.html).not.toContain("action-text-attachment");
    expect(entry?.attachmentNames).toBeUndefined();
  });

  it("expands nested HTML attachment content and child HTML without dropping actual files", () => {
    const nested = htmlAttachment('<p>A body, not a downloadable file.</p>');
    const pdf = '<action-text-attachment content-type="application/pdf" filename="report.pdf" url="https://files.example/report.pdf"></action-text-attachment>';
    const calendar = `<figure data-trix-attachment="${attribute(JSON.stringify({ contentType: "text/calendar", filename: "invite.ics", url: "https://files.example/invite.ics" }))}"></figure>`;
    const content = `<action-text-attachment content-type="Text/HTML; charset=utf-8">${nested}${pdf}${calendar}</action-text-attachment>`;
    const trix = attribute(JSON.stringify({ contentType: "text/html", content }));
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42"><figure data-trix-attachment="${trix}"></figure></article>`).get("42");

    expect(entry?.html).toContain("A body, not a downloadable file.");
    expect(entry?.html).toContain("Attachment: report.pdf");
    expect(entry?.html).toContain("Attachment: invite.ics");
    expect(entry?.attachmentNames).toEqual(["report.pdf", "invite.ics"]);
    expect(entry?.html).not.toContain("files.example");
  });

  it("sanitizes expanded HTML and keeps untrusted images blocked until allowed", () => {
    const body = '<script>steal()</script><p onclick="steal()">Safe recap</p><a href="javascript:steal()">Unsafe</a><img src="https://images.example/recap.png"><img src="javascript:steal()"><style>@import "https://images.example/font.css"; p { background: url(https://images.example/background.png) }</style>';
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42">${htmlAttachment(htmlAttachment(body))}</article>`).get("42");

    expect(entry?.html).toContain("Safe recap");
    expect(entry?.hasRemoteContent).toBe(true);
    expect(entry?.html).toContain('data-remote-src="https://images.example/recap.png"');
    expect(entry?.html).not.toContain(' src="https://images.example/recap.png"');
    expect(entry?.remoteHtml).toContain('src="https://images.example/recap.png"');
    for (const html of [entry?.html, entry?.remoteHtml]) {
      expect(html).not.toContain("<script");
      expect(html).not.toContain("onclick");
      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("font.css");
    }
  });

  it("does not fetch body-wrapper URLs or misreport unknown attachments as filenames", () => {
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42">
      <action-text-attachment content-type="text/html" url="https://files.example/body.html"></action-text-attachment>
      <action-text-attachment content-type="application/octet-stream" url="https://files.example/unknown"></action-text-attachment>
      <action-text-attachment content-type="text/html" filename="download.html" url="https://files.example/download.html"><figure><figcaption>download.html</figcaption></figure></action-text-attachment>
    </article>`).get("42");

    expect(entry?.html).toContain("Message content unavailable.");
    expect(entry?.html).toContain('<p class="email-file-placeholder">Attachment</p>');
    expect(entry?.html).toContain("Attachment: download.html");
    expect(entry?.attachmentNames).toEqual(["download.html"]);
    expect(entry?.html).not.toContain("files.example");
    expect(entry?.hasRemoteContent).toBe(false);
  });

  it("keeps unknown empty attachment wrappers visible without inventing filenames", () => {
    const entry = parseThreadHtmlDocument('<article data-entry-id="42"><figure data-trix-attachment=""></figure><action-text-attachment></action-text-attachment></article>').get("42");
    expect(entry?.html?.match(/email-file-placeholder/g)).toHaveLength(2);
    expect(entry?.attachmentNames).toBeUndefined();
  });

  it("decodes nested content attributes one layer at a time", () => {
    const nested = htmlAttachment(htmlAttachment(htmlAttachment(htmlAttachment('<p>Deeply nested body.</p><a href="https://example.com/recap">Details</a>'))));
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42">${nested}</article>`).get("42");
    expect(entry?.html).toContain("Deeply nested body.");
    expect(entry?.html).toContain('href="https://example.com/recap"');
    expect(entry?.attachmentNames).toBeUndefined();
  });

  it("preserves file attachments next to a shadow template body", () => {
    const body = '<shadow-content><template shadowrootmode="open"><p>Your event details.</p></template></shadow-content><action-text-attachment content-type="text/calendar" filename="invite.ics"></action-text-attachment>';
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42">${htmlAttachment(body)}</article>`).get("42");
    expect(entry?.html).toContain("Your event details.");
    expect(entry?.html).toContain("Attachment: invite.ics");
    expect(entry?.attachmentNames).toEqual(["invite.ics"]);
  });

  it("bounds nested HTML attachment expansion while preserving surrounding content", () => {
    let nested = "<p>Beyond the nesting limit.</p>";
    for (let depth = 0; depth < 12; depth += 1) nested = `<action-text-attachment content-type="text/html">${nested}</action-text-attachment>`;
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42"><p>Before</p>${nested}<p>After</p></article>`).get("42");

    expect(entry?.html).toContain("Before");
    expect(entry?.html).toContain("After");
    expect(entry?.html).toContain("Message content unavailable.");
    expect(entry?.html).not.toContain("Beyond the nesting limit.");
    expect(entry?.attachmentNames).toBeUndefined();
  });

  it("bounds individual and cumulative expanded HTML body sizes", () => {
    const oversized = htmlAttachment("x".repeat(1_000_001));
    const individual = parseThreadHtmlDocument(`<article data-entry-id="42">${oversized}</article>`).get("42");
    expect(individual?.html).toContain("Message content unavailable.");
    expect(individual?.attachmentNames).toBeUndefined();

    const nested = htmlAttachment(htmlAttachment(htmlAttachment(htmlAttachment("x".repeat(600_000)))));
    const cumulative = parseThreadHtmlDocument(`<article data-entry-id="42">${nested}</article>`).get("42");
    expect(cumulative?.html).toContain("Message content unavailable.");
    expect(cumulative?.html?.length).toBeLessThan(200);
  });

  it("keeps PDF attachment names visible without treating files as remote images", () => {
    const content = '<p>Please review.</p><action-text-attachment content-type="application/pdf" url="https://files.example/review.pdf" filename="review.pdf"></action-text-attachment>';
    const trix = JSON.stringify({ contentType: "text/html", content }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42"><figure data-trix-attachment="${trix}"></figure></article>`).get("42");
    expect(entry?.html).toContain("Attachment: review.pdf");
    expect(entry?.html).not.toContain("<img");
    expect(entry?.html).not.toContain("files.example");
    expect(entry?.hasRemoteContent).toBe(false);
  });
  it("preserves standalone Trix files, including attachment-only messages", () => {
    const trix = JSON.stringify({ contentType: "application/pdf", filename: "report.pdf", url: "https://files.example/report.pdf" }).replace(/"/g, "&quot;");
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42"><figure data-trix-attachment="${trix}"></figure></article>`).get("42");
    expect(entry?.html).toContain("Attachment: report.pdf");
    expect(entry?.html).not.toContain("<img");
  });
  it("normalizes HEY's From label as metadata instead of part of the sender name", () => {
    const entry = parseThreadHtmlDocument(`<article data-entry-id="42"><header>From: Taylor Example — 2026-08-30T14:30Z</header><p>Hello.</p></article>`).get("42");
    expect(entry).toMatchObject({ senderName: "Taylor Example", occurredAt: "2026-08-30T14:30Z" });
  });

  it("extracts each entry, sanitizes active content, and preserves safe rich layout", () => {
    const result = parseThreadHtmlDocument(`<!doctype html><html><body>
      <article data-entry-id="99"><header>Sender metadata</header><div><shadow-content><template shadowrootmode="open">
        <style>@import "https://tracker.example/font.css"; .hero { color: red; background-image: url(https://images.example/hero.jpg) }</style>
        <table width="600" style="width:600px"><tr><td><a href="https://example.com/offer" onclick="steal()">Offer</a></td></tr></table>
        <action-text-attachment content-type="image/jpeg" url="https://images.example/offer.jpg" width="640" height="320" caption="The offer"></action-text-attachment>
        <img src="https://tracker.example/pixel.gif" width="1" height="1"><script>alert(1)</script><form><input></form>
      </template></shadow-content></div></article>
    </body></html>`);

    const entry = result.get("99");
    expect(entry).toBeDefined();
    expect(entry?.hasRemoteContent).toBe(true);
    expect(entry?.htmlPresentation).toBe("document");
    expect(entry?.html).toContain("<table");
    expect(entry?.html).toContain("target=\"_blank\"");
    expect(entry?.html).toContain("data-remote-src=\"https://images.example/offer.jpg\"");
    expect(entry?.html).not.toContain("onclick");
    expect(entry?.html).not.toContain("<script");
    expect(entry?.html).not.toContain("<form");
    expect(entry?.html).not.toContain("tracker.example/font.css");
    expect(entry?.html).not.toContain("images.example/hero.jpg");
    expect(entry?.remoteHtml).toContain("src=\"https://images.example/offer.jpg\"");
    expect(entry?.remoteHtml).toContain("images.example/hero.jpg");
    expect(entry?.remoteHtml).not.toContain("tracker.example/pixel.gif");
  });

  it("drops unsafe link protocols and oversized input", () => {
    const unsafe = parseThreadHtmlDocument(`<article data-entry-id="1"><div><style>p { color: red }</style><a href="javascript:alert(1)">Bad</a><a href="mailto:test@example.com">Mail</a></div></article>`).get("1");
    expect(unsafe?.html).not.toContain("javascript:");
    expect(unsafe?.html).toContain("mailto:test@example.com");
    expect(parseThreadHtmlDocument("x".repeat(2_000_001)).size).toBe(0);
  });

  it("normalizes the escaped attributes returned inside HEY Trix attachments", () => {
    expect(normalizeHeyHtmlFragment(String.raw`<template>Line one\n<a href=\&quot;https://example.com\&quot;>Read it</a><img src=\&quot;https://images.example/card.jpg\&quot;></template>`))
      .toBe(`Line one\n<a href="https://example.com">Read it</a><img src="https://images.example/card.jpg">`);
  });

  it("renders HEY-proxied images without opting into arbitrary remote content", () => {
    const result = parseThreadHtmlDocument(`<article data-entry-id="8"><div><action-text-attachment url="https://gopher.hey.com/1200x0/example/image.jpg" width="600" height="300"></action-text-attachment></div></article>`).get("8");
    expect(result?.hasRemoteContent).toBe(false);
    expect(result?.html).toContain("src=\"https://gopher.hey.com/1200x0/example/image.jpg\"");
    expect(result?.remoteHtml).toBeUndefined();
  });

  it("resolves HEY-authored static image paths without trusting arbitrary relative URLs", () => {
    const result = parseThreadHtmlDocument(`<article data-entry-id="14"><div>
      <img class="onboarding-image" alt="Product walkthrough" src="/assets/onboarding/walkthrough-example.png">
      <img alt="Untrusted protocol-relative image" src="//tracker.example/pixel.png">
    </div></article>`).get("14");

    expect(result?.hasRemoteContent).toBe(false);
    expect(result?.html).toContain('class="onboarding-image"');
    expect(result?.html).toContain('alt="Product walkthrough"');
    expect(result?.html).toContain('src="https://app.hey.com/assets/onboarding/walkthrough-example.png"');
    expect(result?.html).not.toContain("tracker.example");
    expect(result?.remoteHtml).toBeUndefined();
  });

  it("preserves safe legacy alignment and image layout hooks used by HTML email", () => {
    const result = parseThreadHtmlDocument(`<article data-entry-id="12"><div>
      <style>.service-mark { vertical-align: middle; }</style>
      <div align="center"><action-text-attachment
        class="service-mark"
        style="display:block; margin:0 auto"
        align="center"
        url="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
        width="74"
        height="24"
        caption="Service logo"
      ></action-text-attachment></div>
    </div></article>`).get("12");

    expect(result?.html).toContain('<div align="center">');
    expect(result?.html).toContain('class="service-mark"');
    expect(result?.html).toContain('style="display:block;margin:0 auto"');
    expect(result?.html).toContain('align="center"');
  });

  it("preserves scrubbed anchor presentation for table-based email buttons", () => {
    const result = parseThreadHtmlDocument(`<article data-entry-id="13"><div>
      <table><tbody><tr><td><table><tbody><tr><td style="display:block;height:40px;padding:0 16px;background-color:#2377d2;border-radius:4px">
          <a class="email-action-link" href="https://example.com/join" onclick="steal()"
            style="color:#fff;display:inline-block;width:100%;font-size:16px;text-decoration:none;line-height:40px">Join the workspace</a>
        </td></tr></tbody></table></td></tr></tbody></table>
    </div></article>`).get("13");

    expect(result?.html).toContain('class="email-action-link"');
    expect(result?.html).toContain('style="color:#fff;display:inline-block;width:100%;font-size:16px;text-decoration:none;line-height:40px"');
    expect(result?.html).toContain('target="_blank"');
    expect(result?.html).toContain('rel="noopener noreferrer"');
    expect(result?.html).not.toContain("onclick");
  });

  it("expands HEY Trix HTML and image attachments into a compact rich card", () => {
    const htmlAttachment = JSON.stringify({
      contentType: "text/html",
      content: String.raw`<shadow-content><template shadowrootmode="open"><p>Assigned <a href="https://github.com/example/repo/pull/1">#1</a> to you.</p></template></shadow-content>`,
    });
    const imageAttachment = JSON.stringify({
      contentType: "image",
      url: "https://gopher.hey.com/signature=/https://camo.githubusercontent.com/hash/image.png",
      width: 640,
      height: 320,
    });
    const attributes = JSON.stringify({ caption: "Runtime verification" });
    const result = parseThreadHtmlDocument(`<article data-entry-id="10"><header>Sender metadata</header>
      <figure data-trix-attachment='${htmlAttachment}'></figure>
      <p>All checks passed.</p>
      <figure data-trix-attachment='${imageAttachment}' data-trix-attributes='${attributes}'></figure>
    </article>`).get("10");

    expect(result?.htmlPresentation).toBe("card");
    expect(result?.html).toContain("Assigned");
    expect(result?.html).toContain("All checks passed.");
    expect(result?.html).toContain("src=\"https://camo.githubusercontent.com/hash/image.png\"");
    expect(result?.html).toContain("width=\"640\"");
    expect(result?.html).toContain("height=\"320\"");
    expect(result?.html).toContain("Runtime verification");
    expect(result?.hasRemoteContent).toBe(false);
  });

  it("keeps ordinary conversational HTML in the native Markdown renderer", () => {
    const result = parseThreadHtmlDocument(`<article data-entry-id="9"><div><p>Assigned <a href="https://github.com/example/repo/pull/1">#1</a> to you.</p></div></article>`);
    expect(result.has("9")).toBe(false);
  });

  it("preserves HEY's per-entry display actor even when the body stays native", () => {
    const result = parseThreadHtmlDocument(`<article data-entry-id="11"><header>build-agent[bot] — 2026-08-28T20:33</header><div><p>Assigned the pull request.</p></div></article>`).get("11");
    expect(result).toEqual({ senderName: "build-agent[bot]", occurredAt: "2026-08-28T20:33" });
  });
});
