import { describe, expect, it } from "vitest";
import { buildEmailDocument, emailFrameHeight } from "./EmailBody";

describe("email document styling", () => {
  it("uses neutral email defaults without overriding sender image dimensions", () => {
    const document = buildEmailDocument('<img height="25" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">', false, "document");

    expect(document).toContain("background: #fff; color: #202124;");
    expect(document).toContain("a { color: #0969da;");
    expect(document).toContain('a[href^="mailto:"], a[href^="https://app.hey.com/topics/"]');
    expect(document).toContain("img-src data: https://app.hey.com https://gopher.hey.com https://camo.githubusercontent.com");
    expect(document).toContain("img { max-width: 100%; }");
    expect(document).not.toContain("height: auto");
    expect(document).not.toContain("box-sizing");
    expect(document).not.toContain("--accent");
    expect(document).not.toContain("--ink");
  });

  it("keeps the embedded document from becoming a second vertical scroll owner", () => {
    const document = buildEmailDocument("<p>Example message</p>", false, "document");

    expect(document).toContain("overflow-x: hidden; overflow-y: hidden;");
    expect(emailFrameHeight(4_000, false)).toBe(4_002);
    expect(emailFrameHeight(20_000, false)).toBe(16_000);
    expect(emailFrameHeight(20_000, true)).toBe(20_002);
    expect(emailFrameHeight(500_000, true)).toBe(240_000);
  });
});
