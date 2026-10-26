import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_BRIEF,
  buildBlogMarkdown,
  htmlToMarkdown,
  slugify,
} from "./blog-export";

const base = {
  title: 'Best "espresso" tips: café edition',
  body: "<p>Hello <strong>world</strong></p><h2>Why</h2><ul><li>One</li></ul>",
  payload: {
    metaDescription: "A short description.",
    excerpt: "Teaser.",
    keywords: ["espresso tips", "home barista"],
  },
  date: new Date("2026-10-26T10:00:00Z"),
};

describe("blog-export", () => {
  it("slugifies accents and punctuation", () => {
    expect(slugify("Café: Best Tips!")).toBe("cafe-best-tips");
  });

  it("converts the generator's HTML to Markdown", () => {
    expect(htmlToMarkdown(base.body)).toBe("Hello **world**\n\n## Why\n\n- One");
  });

  it("writes frontmatter with escaped strings and keywords", () => {
    const md = buildBlogMarkdown(base);
    expect(md).toContain('title: "Best \\"espresso\\" tips: café edition"');
    expect(md).toContain('description: "A short description."');
    expect(md).toContain("slug: best-espresso-tips-cafe-edition");
    expect(md).toContain("date: 2026-10-26");
    expect(md).toContain('keywords: ["espresso tips", "home barista"]');
    expect(md).not.toContain("AI BRIEF");
  });

  it("adds the default brief and keywords for AI export", () => {
    const md = buildBlogMarkdown(base, { forAi: true });
    expect(md).toContain("<!-- AI BRIEF");
    expect(md).toContain(DEFAULT_AI_BRIEF.split("\n")[0]);
    expect(md).toContain("Focus keywords: espresso tips, home barista");
  });

  it("prefers the schedule's own brief and keeps the comment well-formed", () => {
    const md = buildBlogMarkdown(
      { ...base, payload: { ...base.payload, aiBrief: "Write -- in Romanian" } },
      { forAi: true },
    );
    expect(md).toContain("Write — in Romanian");
    expect(md).not.toContain(DEFAULT_AI_BRIEF.split("\n")[0]);
  });
});
