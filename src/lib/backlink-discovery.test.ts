/**
 * Fixture tests for the HTML half of backlink discovery.
 *
 * This is the step that decides whether a page counts as a backlink and
 * whether that backlink is worth having, and it does it by parsing
 * somebody else's markup. The standing rule is that anything reading a
 * third party's HTML needs a fixture test, because the failure is always
 * silent: a selector stops matching and the answer becomes "no links
 * found", which is indistinguishable from the truth.
 *
 * The fixtures below are shaped after real markup — a WordPress post with
 * `rel="noopener"` on every outbound link, a directory with
 * `rel="nofollow"`, an affiliate page with `rel="sponsored"`, a forum with
 * `rel="ugc"` — because those four are what decide the follow status and
 * getting any of them wrong changes the number shown to the user.
 */

import { describe, expect, it } from "vitest";
import { findLinkTo, followFromRel, normaliseDomain, pageTitle } from "./backlink-discovery";

describe("findLinkTo", () => {
  it("finds a plain absolute link and reports no rel", () => {
    const hit = findLinkTo(
      `<p>We use <a href="https://target.com/pricing">Target</a> daily.</p>`,
      "target.com",
    );
    expect(hit).toEqual({ anchorText: "Target", rel: null });
  });

  it("matches the www form of the target", () => {
    const hit = findLinkTo(`<a href="https://www.target.com/">Target</a>`, "target.com");
    expect(hit?.anchorText).toBe("Target");
  });

  it("matches a protocol-relative href", () => {
    const hit = findLinkTo(`<a href="//target.com/docs">the docs</a>`, "target.com");
    expect(hit?.anchorText).toBe("the docs");
  });

  it("matches when the caller passes the target with a www prefix", () => {
    const hit = findLinkTo(`<a href="https://target.com/">x</a>`, "www.target.com");
    expect(hit).not.toBeNull();
  });

  it("returns null when the page only names the domain in text", () => {
    const html = `<p>Everyone talks about target.com but nobody links to it.</p>`;
    expect(findLinkTo(html, "target.com")).toBeNull();
  });

  it("does not match a different domain that merely contains the target", () => {
    // nottarget.com contains "target.com" as a substring. Treating this as
    // a hit would credit a competitor's backlink to the wrong site.
    const html = `<a href="https://nottarget.com/page">elsewhere</a>`;
    expect(findLinkTo(html, "target.com")).toBeNull();
  });

  it("strips nested tags out of the anchor text", () => {
    const hit = findLinkTo(
      `<a href="https://target.com"><span class="i"><strong>Best</strong> SEO tool</span></a>`,
      "target.com",
    );
    expect(hit?.anchorText).toBe("Best SEO tool");
  });

  it("decodes entities and collapses whitespace in the anchor text", () => {
    const hit = findLinkTo(
      `<a href="https://target.com">Tom &amp;\n   Jerry&#39;s   pick</a>`,
      "target.com",
    );
    expect(hit?.anchorText).toBe("Tom & Jerry's pick");
  });

  it("reports an empty anchor (an image link) as null rather than an empty string", () => {
    const hit = findLinkTo(
      `<a href="https://target.com"><img src="/logo.png" alt="Target"></a>`,
      "target.com",
    );
    expect(hit?.anchorText).toBeNull();
  });

  it("takes the first link, which is the contextual one, not the footer", () => {
    const html = `
      <article><p>As <a href="https://target.com/guide">explained here</a>…</p></article>
      <footer><a href="https://target.com" rel="nofollow">Target.com</a></footer>`;
    const hit = findLinkTo(html, "target.com");
    expect(hit?.anchorText).toBe("explained here");
    expect(hit?.rel).toBeNull();
  });

  it("reads rel regardless of attribute order or quoting", () => {
    expect(
      findLinkTo(`<a rel='nofollow noopener' href='https://target.com'>x</a>`, "target.com")?.rel,
    ).toBe("nofollow noopener");
  });

  it("ignores an <a> with no href", () => {
    const html = `<a name="anchor">target.com</a><a href="https://target.com">real</a>`;
    expect(findLinkTo(html, "target.com")?.anchorText).toBe("real");
  });
});

describe("followFromRel", () => {
  it("treats a missing rel as dofollow", () => {
    expect(followFromRel(null)).toBe("dofollow");
  });

  it.each(["nofollow", "sponsored", "ugc"])(
    "treats rel=%s as nofollow, because none of them pass ranking signal",
    (token) => {
      expect(followFromRel(token)).toBe("nofollow");
    },
  );

  it("is case- and whitespace-insensitive", () => {
    expect(followFromRel("  NoFollow  ")).toBe("nofollow");
  });

  it("finds the token among several", () => {
    expect(followFromRel("noopener noreferrer nofollow")).toBe("nofollow");
  });

  it("keeps noopener/noreferrer as dofollow", () => {
    // The regression this guards: every CMS adds noopener to external
    // links. Treating any rel at all as nofollow would write off most of
    // the real dofollow links on the web and under-report every result.
    expect(followFromRel("noopener")).toBe("dofollow");
    expect(followFromRel("noopener noreferrer")).toBe("dofollow");
  });

  it("does not match a token that merely contains nofollow", () => {
    expect(followFromRel("nofollowers")).toBe("dofollow");
  });

  it('handles a namespaced token beside nofollow, as MediaWiki writes it', () => {
    // Found by running the reader against a real page rather than a
    // fixture: every external link on Wikipedia carries
    // rel="mw:ExtLink nofollow". A rel parser that matched the whole
    // attribute instead of splitting it into tokens would call this
    // dofollow, and Wikipedia is a common enough result to matter.
    expect(followFromRel("mw:ExtLink nofollow")).toBe("nofollow");
    expect(followFromRel("mw:ExtLink")).toBe("dofollow");
  });
});

describe("pageTitle", () => {
  it("reads and cleans the title", () => {
    expect(pageTitle(`<head><title>  Best tools &amp; kit\n</title></head>`)).toBe(
      "Best tools & kit",
    );
  });

  it("handles a title tag with attributes", () => {
    expect(pageTitle(`<title data-x="1">Hello</title>`)).toBe("Hello");
  });

  it("returns null when there is no title", () => {
    expect(pageTitle(`<p>no head here</p>`)).toBeNull();
  });

  it("returns null for an empty title rather than an empty string", () => {
    expect(pageTitle(`<title>   </title>`)).toBeNull();
  });
});

describe("normaliseDomain", () => {
  it.each([
    ["target.com", "target.com"],
    ["www.target.com", "target.com"],
    ["https://target.com/some/path?q=1", "target.com"],
    ["HTTPS://WWW.Target.COM", "target.com"],
    ["target.com/", "target.com"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected);
  });
});
