import { ChevronDown } from "lucide";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MorphingIcon from "./MorphingIcon";

describe("MorphingIcon", () => {
  it("renders a layout-stable decorative Lucide endpoint", () => {
    const markup = renderToStaticMarkup(createElement(MorphingIcon, { icon: ChevronDown, size: 17, className: "state-icon" }));

    expect(markup).toContain('class="state-icon"');
    expect(markup).toContain('width="17"');
    expect(markup).toContain('height="17"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("uses Morphicons accessibility labeling when the icon owns meaning", () => {
    const markup = renderToStaticMarkup(createElement(MorphingIcon, { icon: ChevronDown, label: "Expanded" }));

    expect(markup).toContain('role="img"');
    expect(markup).toContain("<title>Expanded</title>");
    expect(markup).not.toContain('aria-hidden="true"');
  });
});
