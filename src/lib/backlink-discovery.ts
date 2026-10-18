/**
 * Backlink discovery. Closes the gap with Ahrefs/Semrush as much as is
 * possible without a paid index. Two steps:
 *
 *   1. **DuckDuckGo HTML** searches with multiple query forms —
 *      `"target.com" -site:target.com`, `link:target.com`, and the bare
 *      brand name — to produce candidate pages.
 *   2. **Crawl-to-confirm** — for each candidate we do a tiny GET and
 *      look for an actual `<a href>` to the target. Promotes a page from
 *      "mentions" to "verified backlink" and extracts the anchor text and
 *      the `rel`. This is the step that makes the result a real backlink
 *      list rather than a mention finder.
 *
 * Returns a deduped list with anchor text and follow status.
 *
 * ## Common Crawl was removed, and it is worth saying why
 *
 * This used to advertise a third source: the Common Crawl CDX index. It
 * contributed nothing, in two separate ways, and said nothing about it.
 *
 * The query was `url=*.<target>&matchType=domain`. Measured against the
 * live index (CC-MAIN-2026-39): that form returns **zero** captures —
 * the `*.` prefix and `matchType=domain` do not combine. `example.com`
 * without the prefix returns 10 rows, `*.example.com` returns none. So
 * the step had always been dead, and because an empty result is
 * indistinguishable from "no backlinks found" it never surfaced.
 *
 * Fixing the query would have made the output *worse*. `matchType=domain`
 * returns pages **on** the target and its subdomains, not pages linking
 * to it. Those were only excluded when the hostname matched exactly, so
 * `blog.target.com` would have passed as a backlink candidate — and
 * crawl-to-confirm would then have found the nav link home and marked it
 * **verified**, reporting a site's own subdomain as a backlink with
 * anchor text.
 *
 * There is no cheap correct version. CDX has no full-text search, so
 * "which pages link here" cannot be asked of it; that lives in Common
 * Crawl's WAT/web-graph bulk files, which are gigabytes per crawl and
 * not an API. Two sources honestly described beat three with one that
 * lies.
 */

import { searchDuckDuckGo } from "./link-prospector";
import { guardedFetch } from "./url-guard";

const USER_AGENT =
  "Mozilla/5.0 (compatible; SeoToolBot/1.0; +https://example.com/bot)";

/** How a link counts for SEO, as the page itself declares it. */
export type FollowStatus = "dofollow" | "nofollow" | "unknown";

/** Ceiling on crawl-to-confirm GETs in one discovery run. */
export const MAX_PAGES_FETCHED = 60;

export type DiscoveredBacklink = {
  /** External page that links to / mentions the target. */
  url: string;
  domain: string;
  /** Page title pulled when we crawl-to-confirm. */
  title: string | null;
  /** What the link's <a> text actually says, when present. */
  anchorText: string | null;
  /** "verified" = found a real <a href> to target. "mention" = only text. */
  status: "verified" | "mention";
  /** The raw rel attribute, when the page had one. null = none present. */
  rel: string | null;
  /** Derived from rel. "unknown" while the page is only a mention. */
  follow: FollowStatus;
  /** Where we found this URL. */
  source: "ddg";
};

export type DiscoveryResult = {
  target: string;
  candidates: number;
  verified: number;
  mentions: number;
  links: DiscoveredBacklink[];
  errors: string[];
};

export async function discoverBacklinks(opts: {
  targetDomain: string;
  /** Hard cap on confirmed link list length, default 60. */
  limit?: number;
  /** Skip the crawl-to-confirm pass (much faster but only mentions). */
  skipVerify?: boolean;
  signal?: AbortSignal;
}): Promise<DiscoveryResult> {
  const target = normaliseDomain(opts.targetDomain);
  if (!target) {
    return {
      target: opts.targetDomain,
      candidates: 0,
      verified: 0,
      mentions: 0,
      links: [],
      errors: ["Invalid domain"],
    };
  }
  const limit = opts.limit ?? 60;
  const errors: string[] = [];

  // The crawl-to-confirm pass is the expensive half: one GET per page, six
  // at a time, ten seconds each. Capping the candidate list bounds the
  // worst case at roughly a hundred seconds no matter what `limit` says.
  const candidateList = await findCandidatePages(
    target,
    Math.min(limit * 2, MAX_PAGES_FETCHED),
    errors,
    opts.signal,
  );

  if (opts.skipVerify) {
    return {
      target,
      candidates: candidateList.length,
      verified: 0,
      mentions: candidateList.length,
      links: candidateList.slice(0, limit),
      errors,
    };
  }

  const checked: DiscoveredBacklink[] = [];
  for (let i = 0; i < candidateList.length; i += 6) {
    const batch = candidateList.slice(i, i + 6);
    const results = await Promise.allSettled(
      batch.map((c) => verifyLink(c, target, opts.signal)),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) checked.push(r.value);
    }
    if (checked.filter((l) => l.status === "verified").length >= limit) break;
  }

  // Verified links first — a confirmed <a href> is worth more than a page
  // that merely says the name.
  checked.sort((a, b) => {
    if (a.status !== b.status) return a.status === "verified" ? -1 : 1;
    return 0;
  });

  return {
    target,
    candidates: candidateList.length,
    verified: checked.filter((l) => l.status === "verified").length,
    mentions: checked.filter((l) => l.status === "mention").length,
    links: checked.slice(0, limit),
    errors,
  };
}

/**
 * The DuckDuckGo half, on its own, because link-intersect needs candidate
 * pages for several domains before it verifies any of them — it fetches
 * each page once and asks about every domain at the same time.
 */
export async function findCandidatePages(
  target: string,
  max: number,
  errors: string[],
  signal?: AbortSignal,
): Promise<DiscoveredBacklink[]> {
  const queries = [
    `"${target}" -site:${target}`,
    `link:${target}`,
    `"${target.replace(/\..+$/, "")}" -site:${target}`,
  ];

  const candidates = new Map<string, DiscoveredBacklink>();
  for (const q of queries) {
    try {
      const rows = await searchDuckDuckGo(q, { signal });
      for (const r of rows) {
        const key = r.url.split("#")[0];
        if (candidates.has(key)) continue;
        let domain: string;
        try {
          domain = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
        } catch {
          continue;
        }
        if (domain === target || domain.endsWith(`.${target}`)) continue;
        candidates.set(key, {
          url: r.url,
          domain,
          title: r.title || null,
          anchorText: null,
          status: "mention",
          rel: null,
          follow: "unknown",
          source: "ddg",
        });
      }
    } catch (err) {
      errors.push(`DuckDuckGo search failed for ${q}: ${(err as Error).message}`);
    }
  }

  return Array.from(candidates.values()).slice(0, max);
}

/**
 * Crawl-to-confirm: fetch the candidate page and look for a real
 * `<a href>` linking to the target domain.
 */
async function verifyLink(
  candidate: DiscoveredBacklink,
  target: string,
  signal?: AbortSignal,
): Promise<DiscoveredBacklink> {
  const page = await fetchPageHtml(candidate.url, signal);
  if (!page) return candidate;

  const hit = findLinkTo(page, target);
  return {
    ...candidate,
    title: pageTitle(page) ?? candidate.title,
    anchorText: hit?.anchorText ?? null,
    rel: hit?.rel ?? null,
    follow: hit ? followFromRel(hit.rel) : "unknown",
    status: hit ? "verified" : "mention",
  };
}

/**
 * One GET, capped and guarded. Returns the HTML, or null for anything
 * that is not a readable HTML page.
 *
 * Guarded because these URLs come from DuckDuckGo, not from us, so the
 * host is whatever somebody managed to get indexed.
 */
export async function fetchPageHtml(
  url: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000);
    const onAbort = () => ac.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await guardedFetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: ac.signal,
        redirect: "follow",
      });
      if (!res.ok) return null;
      if (!/text\/html/i.test(res.headers.get("content-type") ?? "")) return null;
      return (await res.text()).slice(0, 1_500_000);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    return null;
  }
}

export type LinkHit = {
  anchorText: string | null;
  /** Raw rel attribute as written, or null when the tag had none. */
  rel: string | null;
};

/**
 * Find the first `<a href>` on a page pointing at `target`, and report
 * its anchor text and rel.
 *
 * The first hit is taken deliberately: on a page that links to a site
 * more than once, the earliest is usually the contextual one and the
 * later ones are navigation, footers or share widgets.
 *
 * Exported because link-intersect asks this of one page for several
 * domains at once. There is exactly one implementation of "does this
 * HTML link to that domain, and how" and this is it.
 */
export function findLinkTo(html: string, target: string): LinkHit | null {
  const normalised = target.replace(/^www\./i, "").toLowerCase();
  const linkRe = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(linkRe)) {
    const attrs = match[1];
    const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    if (!hrefPointsAt(hrefMatch[1], normalised)) continue;

    const anchor = cleanText(match[2].replace(/<[^>]+>/g, " ")).slice(0, 200);
    const relMatch = attrs.match(/rel\s*=\s*["']([^"']+)["']/i);
    return {
      anchorText: anchor || null,
      rel: relMatch ? relMatch[1].trim() : null,
    };
  }
  return null;
}

/**
 * What a rel attribute means for link value.
 *
 * `nofollow`, `sponsored` and `ugc` all tell Google not to pass ranking
 * signal, so for the purpose of "is this link worth having" they are one
 * answer. A rel that says only `noopener` is not one of them — treating
 * any rel at all as nofollow would write off most modern outbound links,
 * since `noopener` is what every CMS adds to external links by default.
 */
export function followFromRel(rel: string | null): FollowStatus {
  if (rel === null) return "dofollow";
  const tokens = rel.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.some((t) => t === "nofollow" || t === "sponsored" || t === "ugc")) {
    return "nofollow";
  }
  return "dofollow";
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? cleanText(m[1]).slice(0, 200) || null : null;
}

function hrefPointsAt(href: string, target: string): boolean {
  if (!href) return false;
  const lower = href.toLowerCase();
  // Absolute and protocol-relative forms. A path-relative href can never
  // reach another host, so there is nothing to match there.
  return (
    lower.includes(`://${target}`) ||
    lower.includes(`://www.${target}`) ||
    lower.startsWith(`//${target}`) ||
    lower.startsWith(`//www.${target}`)
  );
}

function cleanText(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseDomain(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return (
      input
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/.*$/, "")
        .toLowerCase() || null
    );
  }
}
