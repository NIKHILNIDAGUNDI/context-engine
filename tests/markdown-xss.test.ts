import React from "react";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("Markdown source rendering", () => {
  it("does not render raw HTML from indexed answers", () => {
    const markup = renderToStaticMarkup(
      React.createElement(ReactMarkdown, { skipHtml: true }, '<img src="x" onerror="alert(1)">'),
    );
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("onerror");
  });
});
