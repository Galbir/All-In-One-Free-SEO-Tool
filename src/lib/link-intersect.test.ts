/**
 * Tests for the part of link intersect that decides what the user sees:
 * which pages count, which site they belong to, whether you already have
 * the link, and the order.
 *
 * All of it runs on fixture HTML, because the output is a list somebody
 * will spend an afternoon emailing. The expensive mistake here is not a
 * crash — it is recommending outreach to a site that already links to
 * you, or burying the site that links to three competitors below one that
 * links to one.
 */

import { describe, expect, it } from "vitest";
import { buildRows, type ReadPage } from "./link-intersect";

const YOU = "mysite.com";
const COMPETITORS = ["rival-a.com", "rival-b.com", "rival-c.com"];

function page(url: string, body: string, title = "A page"): ReadPage {
  return { url, fallbackTitle: null, html: `<html><head><title>${title}</title></head><body>${body}</body></html>` };
}

const link = (domain: string, anchor: string, rel?: string) =>
  `<a href="https://${domain}/thing"${rel ? ` rel="${rel}"` : ""}>${anchor}</a>`;

describe("buildRows", () => {
  it("keeps a page that links to a competitor and not to you", () => {
    const rows = buildRows(
      [page("https://blog.example.com/tools", link("rival-a.com", "Rival A"))],
      YOU,
      COMPETITORS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: "blog.example.com",
      competitors: ["rival-a.com"],
      linksToYou: false,
      dofollow: 1,
    });
    expect(rows[0].pages[0]).toMatchObject({
      competitor: "rival-a.com",
      anchorText: "Rival A",
      rel: null,
      follow: "dofollow",
    });
  });

  it("marks a page that links to both, so it is not pitched again", () => {
    // The whole point of reading the page rather than subtracting two
    // search-derived lists: this is read off the HTML, so a link to you
    // that no search surfaced still counts.
    const rows = buildRows(
      [
        page(
          "https://roundup.example.com/best",
          link("rival-a.com", "Rival A") + link(YOU, "Us"),
        ),
      ],
      YOU,
      COMPETITORS,
    );

    expect(rows[0].linksToYou).toBe(true);
  });

  it("drops a page that names a competitor without linking to it", () => {
    const rows = buildRows(
      [page("https://news.example.com/a", "<p>We compared rival-a.com and others.</p>")],
      YOU,
      COMPETITORS,
    );
    expect(rows).toEqual([]);
  });

  it("drops a page that links only to you", () => {
    const rows = buildRows(
      [page("https://fan.example.com/a", link(YOU, "Us"))],
      YOU,
      COMPETITORS,
    );
    expect(rows).toEqual([]);
  });

  it("groups several pages of one site into a single row", () => {
    const rows = buildRows(
      [
        page("https://hub.example.com/one", link("rival-a.com", "A")),
        page("https://hub.example.com/two", link("rival-b.com", "B")),
        page("https://www.hub.example.com/three", link("rival-b.com", "B again")),
      ],
      YOU,
      COMPETITORS,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe("hub.example.com");
    expect(rows[0].competitors).toEqual(["rival-a.com", "rival-b.com"]);
    expect(rows[0].pages).toHaveLength(3);
  });

  it("treats the whole site as already linking to you if any page does", () => {
    const rows = buildRows(
      [
        page("https://hub.example.com/one", link("rival-a.com", "A")),
        page("https://hub.example.com/about", link("rival-b.com", "B") + link(YOU, "Us")),
      ],
      YOU,
      COMPETITORS,
    );
    expect(rows[0].linksToYou).toBe(true);
  });

  it("counts one page that links to two competitors as two links, one row", () => {
    const rows = buildRows(
      [
        page(
          "https://list.example.com/best",
          link("rival-a.com", "A") + link("rival-b.com", "B"),
        ),
      ],
      YOU,
      COMPETITORS,
    );

    expect(rows[0].competitors).toEqual(["rival-a.com", "rival-b.com"]);
    expect(rows[0].pages).toHaveLength(2);
    expect(rows[0].dofollow).toBe(2);
  });

  it("ranks more competitors above fewer", () => {
    const rows = buildRows(
      [
        page("https://one.example.com/x", link("rival-a.com", "A")),
        page(
          "https://three.example.com/x",
          link("rival-a.com", "A") + link("rival-b.com", "B") + link("rival-c.com", "C"),
        ),
        page("https://two.example.com/x", link("rival-a.com", "A") + link("rival-b.com", "B")),
      ],
      YOU,
      COMPETITORS,
    );

    expect(rows.map((r) => r.domain)).toEqual([
      "three.example.com",
      "two.example.com",
      "one.example.com",
    ]);
  });

  it("breaks a tie on dofollow count, so a nofollow-only site ranks lower", () => {
    const rows = buildRows(
      [
        page("https://nf.example.com/x", link("rival-a.com", "A", "nofollow")),
        page("https://df.example.com/x", link("rival-a.com", "A")),
      ],
      YOU,
      COMPETITORS,
    );

    expect(rows.map((r) => r.domain)).toEqual(["df.example.com", "nf.example.com"]);
    expect(rows[0].dofollow).toBe(1);
    expect(rows[1].dofollow).toBe(0);
    expect(rows[1].pages[0].follow).toBe("nofollow");
  });

  it("orders by domain when competitors and dofollow both tie, so runs are stable", () => {
    const rows = buildRows(
      [
        page("https://zebra.example.com/x", link("rival-a.com", "A")),
        page("https://apple.example.com/x", link("rival-a.com", "A")),
      ],
      YOU,
      COMPETITORS,
    );
    expect(rows.map((r) => r.domain)).toEqual(["apple.example.com", "zebra.example.com"]);
  });

  it("records sponsored and ugc as nofollow, since neither passes signal", () => {
    const rows = buildRows(
      [
        page(
          "https://aff.example.com/x",
          link("rival-a.com", "A", "sponsored") + link("rival-b.com", "B", "ugc"),
        ),
      ],
      YOU,
      COMPETITORS,
    );
    expect(rows[0].dofollow).toBe(0);
    expect(rows[0].pages.map((p) => p.follow)).toEqual(["nofollow", "nofollow"]);
  });

  it("keeps a noopener link as dofollow", () => {
    // Every CMS adds noopener to outbound links. Counting it as nofollow
    // would report almost every real prospect as worthless.
    const rows = buildRows(
      [page("https://wp.example.com/x", link("rival-a.com", "A", "noopener noreferrer"))],
      YOU,
      COMPETITORS,
    );
    expect(rows[0].dofollow).toBe(1);
  });

  it("prefers the page's own title over the search result's", () => {
    const rows = buildRows(
      [
        {
          url: "https://t.example.com/x",
          fallbackTitle: "Stale search snippet",
          html: `<title>The real title</title>${link("rival-a.com", "A")}`,
        },
      ],
      YOU,
      COMPETITORS,
    );
    expect(rows[0].pages[0].title).toBe("The real title");
  });

  it("falls back to the search result's title when the page has none", () => {
    const rows = buildRows(
      [
        {
          url: "https://t.example.com/x",
          fallbackTitle: "From DuckDuckGo",
          html: link("rival-a.com", "A"),
        },
      ],
      YOU,
      COMPETITORS,
    );
    expect(rows[0].pages[0].title).toBe("From DuckDuckGo");
  });

  it("skips a page whose url will not parse rather than throwing", () => {
    const rows = buildRows(
      [{ url: "not a url", fallbackTitle: null, html: link("rival-a.com", "A") }],
      YOU,
      COMPETITORS,
    );
    expect(rows).toEqual([]);
  });

  it("returns nothing for no pages", () => {
    expect(buildRows([], YOU, COMPETITORS)).toEqual([]);
  });
});
