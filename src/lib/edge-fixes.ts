/**
 * The fix set an edge worker applies, derived from what the agent did.
 *
 * WHY THIS EXISTS
 *
 * Every automatic fix in this tool goes through the WordPress plugin, so
 * a PHP site, a static site or a React app gets the finding and the
 * instructions and nothing else. The two paid tools that do apply fixes
 * to any site — Search Atlas OTTO and Alli AI — both solve it with a
 * JavaScript pixel that rewrites the page in the visitor's browser.
 *
 * That approach has a flaw worth naming, because it is the reason this
 * file takes a different one. AI crawlers do not run JavaScript. Vercel
 * and MERJ measured over 500 million GPTBot fetches and found no
 * evidence of execution; ClaudeBot downloaded JS in about a quarter of
 * requests and ran none of it. So a pixel-applied title is invisible to
 * ChatGPT, Claude and Perplexity — at the exact moment AI search is the
 * thing everyone is worried about. The fixes also disappear when the
 * subscription stops, which is why one review calls them rented.
 *
 * An edge worker rewrites the HTML before it leaves the server. Crawlers
 * that never run JavaScript still see it, because by the time they
 * receive the page the change is in the source.
 *
 * NO SECOND SOURCE OF TRUTH
 *
 * The fix set is derived from `agent_actions` rather than stored
 * separately. That table already records the URL, the field, the new
 * value and whether it was reverted — and CLAUDE.md's fourth standing
 * rule exists because every pair of lists in this repo had already
 * drifted by the time somebody found it. A reverted action disappears
 * from the feed by construction rather than by remembering to delete it.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { agentActions } from "@/db/schema";

/** What the worker knows how to rewrite. */
export type EdgeField =
  | "title"
  | "meta_description"
  | "canonical"
  | "og_title"
  | "twitter_title";

/** One page's worth of rewrites, keyed by path. */
export type EdgePageFixes = Partial<Record<EdgeField, string>>;

export type EdgeFixSet = {
  /** Path (with query, no origin) → the fields to rewrite on it. */
  pages: Record<string, EdgePageFixes>;
  /** So the worker can log which build it is serving. */
  generatedAt: string;
  count: number;
};

/**
 * Agent action kinds that map onto something the worker can rewrite.
 *
 * Deliberately narrow. Schema, internal links and alt text are edits to
 * the body of a document, and an edge worker rewriting article content
 * is a much larger blast radius than rewriting a head tag — a bad
 * selector would corrupt the page for every visitor, not just change a
 * meta value. Head tags only, until the narrow version has run
 * somewhere real for a while.
 */
const KIND_TO_FIELD: Record<string, EdgeField> = {
  write_title: "title",
  write_meta_description: "meta_description",
  write_canonical: "canonical",
  write_social_meta: "og_title",
};

/**
 * Is this action still something the worker should serve?
 *
 * "verified" counts as much as "applied": the executor promotes an
 * action to verified once it has read the change back off the live page,
 * so filtering to "applied" alone would drop exactly the fixes that had
 * been confirmed to work.
 *
 * Everything else is excluded, and "reverted" is the one that matters —
 * a fix somebody took back must stop being served, or undo would appear
 * to work in the app while the edge kept serving the old value forever.
 */
export function isLiveFix(row: { kind: string; status: string }): boolean {
  if (!(row.kind in KIND_TO_FIELD)) return false;
  return row.status === "applied" || row.status === "verified";
}

/**
 * Normalise a URL to the path the worker will match on.
 *
 * The worker sees a request path, not the absolute URL the agent
 * recorded, so the two have to be reduced to the same thing. A trailing
 * slash is kept as-is rather than stripped: "/blog" and "/blog/" can be
 * genuinely different pages, and guessing they are the same is how a fix
 * lands on the wrong one.
 */
export function pathOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    // Already a path, or junk. A leading slash is the only thing that
    // makes it usable as a match key.
    return url.startsWith("/") ? url : null;
  }
}

/**
 * Build the fix set from applied agent actions.
 *
 * Split out from the query so the precedence rules can be tested. The
 * one that matters: for a given page and field, the most recent applied
 * action wins. Without that, a title fixed twice would serve whichever
 * row the database happened to return first.
 */
export function buildFixSet(
  rows: readonly {
    kind: string;
    targetUrl: string | null;
    afterValue: string | null;
    id: number;
  }[],
): EdgeFixSet {
  const pages: Record<string, EdgePageFixes> = {};
  // Newest first, so the first value seen for a page+field is the
  // current one and everything after it is history.
  const seen = new Set<string>();
  let count = 0;

  for (const r of [...rows].sort((a, b) => b.id - a.id)) {
    const field = KIND_TO_FIELD[r.kind];
    if (!field || !r.targetUrl || !r.afterValue) continue;
    const path = pathOf(r.targetUrl);
    if (!path) continue;

    const key = `${path}\0${field}`;
    if (seen.has(key)) continue;
    seen.add(key);

    (pages[path] ??= {})[field] = r.afterValue;
    count++;

    // og:title and twitter:title are written together by the agent, so
    // the worker gets both from the one action rather than needing a
    // second kind that would only ever carry the same string.
    if (field === "og_title") {
      pages[path].twitter_title = r.afterValue;
      count++;
    }
  }

  return { pages, generatedAt: new Date().toISOString(), count };
}

/** The current fix set for one client. */
export async function edgeFixesForClient(
  clientId: number,
): Promise<EdgeFixSet> {
  const rows = await db
    .select({
      id: agentActions.id,
      kind: agentActions.kind,
      status: agentActions.status,
      targetUrl: agentActions.targetUrl,
      afterValue: agentActions.afterValue,
    })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.clientId, clientId),
        isNotNull(agentActions.afterValue),
      ),
    )
    .orderBy(desc(agentActions.id))
    // Bounded. A long-lived client accumulates actions and the worker
    // only ever needs the current value per page.
    .limit(5000);

  return buildFixSet(rows.filter((r) => isLiveFix(r)));
}
