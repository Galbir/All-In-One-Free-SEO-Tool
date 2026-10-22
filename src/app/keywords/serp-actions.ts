"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { clients, keywordRankings, keywords, serpScans } from "@/db/schema";
import { scanSerp } from "@/lib/serp-scanner";
import { guardAction } from "@/lib/action-guard";

export type RunSerpScanResult =
  | { ok: true; id: number; aiOverviewPresent: boolean; topResults: number }
  | { ok: false; error: string };

export async function runSerpScan(
  keywordId: number,
): Promise<RunSerpScanResult> {
  await guardAction("edit");
  const [k] = await db
    .select()
    .from(keywords)
    .where(eq(keywords.id, keywordId))
    .limit(1);
  if (!k) return { ok: false, error: "Keyword not found" };

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, k.clientId))
    .limit(1);

  const result = await scanSerp({
    query: k.query,
    country: k.country,
    clientDomain: client?.url,
  });

  const [row] = await db
    .insert(serpScans)
    .values({
      keywordId: k.id,
      ok: result.ok,
      error: result.error ?? null,
      aiOverviewPresent: result.aiOverviewPresent,
      aiOverviewText: result.aiOverviewText,
      aiOverviewSources: result.aiOverviewSources,
      paaQuestions: result.paaQuestions,
      relatedSearches: result.relatedSearches,
      topResults: result.topResults,
      featuredSnippet: result.featuredSnippet,
      localPackPresent: result.localPackPresent,
      totalResults: result.totalResults,
    })
    .returning({ id: serpScans.id });

  // Mirror SERP feature flags onto the latest keyword_rankings row so the
  // keyword table can render them inline next to the rank. If no ranking row
  // exists yet (haven't checked rank), insert a stub so the flags persist.
  if (result.ok) {
    const [latest] = await db
      .select({ id: keywordRankings.id })
      .from(keywordRankings)
      .where(eq(keywordRankings.keywordId, k.id))
      .orderBy(desc(keywordRankings.checkedAt))
      .limit(1);

    const flags = {
      hasAiOverview: result.aiOverviewPresent,
      hasFeaturedSnippet: !!result.featuredSnippet,
      hasLocalPack: result.localPackPresent,
      paaCount: result.paaQuestions.length,
    };
    if (latest) {
      await db
        .update(keywordRankings)
        .set(flags)
        .where(eq(keywordRankings.id, latest.id));
    } else {
      await db.insert(keywordRankings).values({
        keywordId: k.id,
        position: null,
        url: null,
        ...flags,
      });
    }
  }

  revalidatePath(`/keywords/c/${k.clientId}`);
  revalidatePath(`/keywords/${k.id}/serp`);

  if (!result.ok) {
    return { ok: false, error: result.error ?? "SERP scan failed" };
  }

  return {
    ok: true,
    id: row.id,
    aiOverviewPresent: result.aiOverviewPresent,
    topResults: result.topResults.length,
  };
}
