/**
 * Link intersect: sites that link to competitors but not to you.
 *
 * This is the question link building actually starts from. "Find my
 * competitor's backlinks" is only interesting once you subtract the ones
 * you already have, because the remainder is the list you can do
 * something about — a site that has already linked to two companies doing
 * what you do has demonstrated it will link to a third.
 *
 * ## Why this fetches each page once and asks about every domain
 *
 * The obvious build is: discover your backlinks, discover each
 * competitor's, subtract one set from the other. That needs N+1 full
 * discovery runs, and it compares two *best-effort* lists — so a site
 * that links to you would be recommended for outreach whenever your own
 * discovery happened to miss it. Missing a link is the normal case
 * without a paid index, so the error would be common and silent.
 *
 * Instead: candidate pages come from cheap DuckDuckGo searches for every
 * competitor, then each page is fetched **once** and asked, from the same
 * HTML, whether it links to you and whether it links to each competitor.
 * One GET answers the whole row, and "does this page link to you" is read
 * from the page itself rather than inferred from the absence of a search
 * result.
 *
 * ## What this is not
 *
 * It is page-level evidence, not a domain-level guarantee. A site can
 * link to you from a page that never appeared in these searches, so
 * `linksToYou` means "on a page we actually read", and the UI says so.
 * That is the honest shape of the claim and it is still the right
 * granularity for outreach: the resource page listing three competitors
 * and not you is the thing you write to.
 */

import {
  findCandidatePages,
  fetchPageHtml,
  findLinkTo,
  followFromRel,
  normaliseDomain,
  pageTitle,
  type FollowStatus,
} from "./backlink-discovery";

export type IntersectPage = {
  url: string;
  title: string | null;
  /** The competitor this page links to. */
  competitor: string;
  anchorText: string | null;
  rel: string | null;
  follow: FollowStatus;
};

export type IntersectRow = {
  /** The linking site — the thing you would contact. */
  domain: string;
  /** Which of the competitors it links to, deduped. */
  competitors: string[];
  /** The pages that carry those links. */
  pages: IntersectPage[];
  /** A page we read on this domain also links to you. */
  linksToYou: boolean;
  /** How many of its competitor links pass ranking signal. */
  dofollow: number;
};

export type IntersectResult = {
  yourDomain: string;
  competitors: string[];
  /** Sites linking to a competitor and not to you. The outreach list. */
  gaps: IntersectRow[];
  /** Sites already linking to you. Kept so you don't pitch them twice. */
  alreadyLinkingToYou: IntersectRow[];
  stats: {
    candidatePages: number;
    pagesRead: number;
    pagesUnreachable: number;
  };
  errors: string[];
};

/** Ceiling on page fetches for one intersect run. */
export const MAX_PAGES = 90;

/** Concurrency for the fetch pass, matching the discovery crawler. */
const BATCH = 6;

export async function linkIntersect(opts: {
  yourDomain: string;
  competitorDomains: string[];
  /** Candidate pages requested per competitor before the cap. */
  perCompetitor?: number;
  signal?: AbortSignal;
}): Promise<IntersectResult> {
  const errors: string[] = [];
  const you = normaliseDomain(opts.yourDomain);
  if (!you) {
    return empty(opts.yourDomain, [], ["Enter your own domain first."]);
  }

  const competitors = Array.from(
    new Set(
      opts.competitorDomains
        .map((d) => normaliseDomain(d))
        .filter((d): d is string => !!d && d !== you),
    ),
  );
  if (!competitors.length) {
    return empty(you, [], ["Add at least one competitor domain."]);
  }

  // ---- 1. Candidate pages, per competitor, from DuckDuckGo only -------
  const perCompetitor = opts.perCompetitor ?? 30;
  const candidates = new Map<string, { url: string; title: string | null }>();
  const own = new Set([you, ...competitors]);

  for (const competitor of competitors) {
    const found = await findCandidatePages(competitor, perCompetitor, errors, opts.signal);
    for (const c of found) {
      // A competitor's own pages, and your own, tell us nothing about who
      // else would link out.
      if (own.has(c.domain) || [...own].some((d) => c.domain.endsWith(`.${d}`))) continue;
      const key = c.url.split("#")[0];
      if (!candidates.has(key)) candidates.set(key, { url: c.url, title: c.title });
    }
  }

  const candidateList = Array.from(candidates.values()).slice(0, MAX_PAGES);
  if (!candidateList.length) {
    // Measured on a blocked network: three queries per competitor, each
    // failing with the same captcha message, produced nine near-identical
    // lines and a tenth that hedged. The distinction that actually matters
    // is whether the searches ran at all — because "no gaps found" after a
    // refused search is not a finding about these domains, and a reader
    // will take it for one unless told otherwise.
    const refused = errors.length > 0;
    return empty(you, competitors, [
      ...summariseErrors(errors),
      refused
        ? "No pages could be searched for, so this is not a result about these domains. Every search was refused. Try again later or from a different network."
        : "The searches ran and returned no pages that mention these competitors. Try better-known competitor domains, or check the spelling.",
    ]);
  }

  // ---- 2. One fetch per page, every domain asked of the same HTML -----
  const read: ReadPage[] = [];
  let pagesUnreachable = 0;

  for (let i = 0; i < candidateList.length; i += BATCH) {
    if (opts.signal?.aborted) break;
    const batch = candidateList.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (c) => ({ candidate: c, html: await fetchPageHtml(c.url, opts.signal) })),
    );

    for (const s of settled) {
      if (s.status !== "fulfilled" || !s.value.html) {
        pagesUnreachable++;
        continue;
      }
      read.push({
        url: s.value.candidate.url,
        fallbackTitle: s.value.candidate.title,
        html: s.value.html,
      });
    }
  }

  const all = buildRows(read, you, competitors);

  return {
    yourDomain: you,
    competitors,
    gaps: all.filter((r) => !r.linksToYou),
    alreadyLinkingToYou: all.filter((r) => r.linksToYou),
    stats: {
      candidatePages: candidateList.length,
      pagesRead: read.length,
      pagesUnreachable,
    },
    errors: summariseErrors(errors),
  };
}

/**
 * One line per distinct cause, with a count.
 *
 * Every search failure arrives per query — three queries per competitor —
 * and they are almost always the same cause, so the raw list is the same
 * sentence up to nine times. The query that failed is not useful to the
 * reader; the reason is.
 */
export function summariseErrors(errors: string[]): string[] {
  const counts = new Map<string, number>();
  for (const e of errors) {
    const reason = e.replace(/^DuckDuckGo search failed for .*?: /, "");
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Array.from(counts, ([reason, n]) =>
    n > 1 ? `${reason} (${n} searches)` : reason,
  );
}

/** A page that was fetched successfully, ready to be read. */
export type ReadPage = {
  url: string;
  /** The search result's title, used only if the page has none. */
  fallbackTitle: string | null;
  html: string;
};

/**
 * Turn fetched pages into ranked rows, one per linking site.
 *
 * Separate from the fetching so it can be tested on fixture HTML without
 * a network. This is where every judgement that affects the output lives:
 * whether a page counts, which domain it belongs to, and the order.
 */
export function buildRows(
  pages: ReadPage[],
  you: string,
  competitors: string[],
): IntersectRow[] {
  const rows = new Map<string, IntersectRow>();

  for (const page of pages) {
    const hits = competitors
      .map((competitor) => ({ competitor, hit: findLinkTo(page.html, competitor) }))
      .filter((x): x is { competitor: string; hit: NonNullable<typeof x.hit> } => x.hit !== null);

    // A page that names a competitor without linking to it is not
    // evidence of anything, and there is no outreach angle in it.
    if (!hits.length) continue;

    const domain = hostOf(page.url);
    if (!domain) continue;
    const title = pageTitle(page.html) ?? page.fallbackTitle;
    const linksToYou = findLinkTo(page.html, you) !== null;

    const row =
      rows.get(domain) ??
      ({ domain, competitors: [], pages: [], linksToYou: false, dofollow: 0 } as IntersectRow);

    for (const { competitor, hit } of hits) {
      const follow = followFromRel(hit.rel);
      row.pages.push({
        url: page.url,
        title,
        competitor,
        anchorText: hit.anchorText,
        rel: hit.rel,
        follow,
      });
      if (!row.competitors.includes(competitor)) row.competitors.push(competitor);
      if (follow === "dofollow") row.dofollow++;
    }
    // Once any page we read on this domain links to you, the domain does.
    row.linksToYou = row.linksToYou || linksToYou;
    rows.set(domain, row);
  }

  return Array.from(rows.values()).sort(rank);
}

/**
 * Most competitors linked first: a site that has linked to two of them is
 * a far better prospect than one that linked to a single company, because
 * it has shown the pattern rather than a one-off. Dofollow count breaks
 * ties, then the domain name so the order is stable between runs.
 */
function rank(a: IntersectRow, b: IntersectRow): number {
  if (a.competitors.length !== b.competitors.length) {
    return b.competitors.length - a.competitors.length;
  }
  if (a.dofollow !== b.dofollow) return b.dofollow - a.dofollow;
  return a.domain.localeCompare(b.domain);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function empty(you: string, competitors: string[], errors: string[]): IntersectResult {
  return {
    yourDomain: you,
    competitors,
    gaps: [],
    alreadyLinkingToYou: [],
    stats: { candidatePages: 0, pagesRead: 0, pagesUnreachable: 0 },
    errors,
  };
}
