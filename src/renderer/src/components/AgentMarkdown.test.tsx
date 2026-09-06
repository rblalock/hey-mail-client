import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentMarkdown from "./AgentMarkdown";

describe("AgentMarkdown", () => {
  it("renders complete GFM as a bounded transcript surface", () => {
    const markup = renderToStaticMarkup(<AgentMarkdown text={"## Result\n\n- One\n- Two\n\n| A | B |\n| - | - |\n| 1 | 2 |"} />);

    expect(markup).toContain("<h2>Result</h2>");
    expect(markup).toContain("<li>One</li>");
    expect(markup).toContain('class="agent-markdown-table"');
  });

  it("keeps incomplete streaming text visible", () => {
    const markup = renderToStaticMarkup(<AgentMarkdown text="**Still working" streaming />);

    expect(markup).toContain("Still working");
    expect(markup).toContain('data-streaming="true"');
  });

  it("drops raw HTML and remote Markdown images", () => {
    const markup = renderToStaticMarkup(<AgentMarkdown text={'<script>alert("no")</script>\n\n![tracker](https://example.com/pixel.gif)'} />);

    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("pixel.gif");
  });

  it("keeps native HEY object links available to the app", () => {
    const markup = renderToStaticMarkup(<AgentMarkdown text="[Open planning](hey-agent://mail/threads/42)" />);

    expect(markup).toContain('href="hey-agent://mail/threads/42"');
  });

  it("marks email links for lazy native contact resolution", () => {
    const markup = renderToStaticMarkup(<AgentMarkdown text="[maya@example.com](mailto:maya@example.com)" />);

    expect(markup).toContain('href="mailto:maya@example.com"');
    expect(markup).toContain('class="agent-smart-object-link"');
  });
});
