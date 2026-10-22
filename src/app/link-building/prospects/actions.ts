"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, seoResources, resourceSubmissions } from "@/db/schema";
import { findProspects, type ProspectResult } from "@/lib/link-prospector";
import { guardAction } from "@/lib/action-guard";

const inputSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  topic: z.string().trim().min(2).max(200),
  competitor: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type ProspectSearchResult =
  | { ok: true; results: ProspectResult[] }
  | { ok: false; error: string };

export async function findLinkProspects(
  _prev: ProspectSearchResult | null,
  formData: FormData,
): Promise<ProspectSearchResult> {
  await guardAction("read", formData.get("clientId"));
  const parsed = inputSchema.safeParse({
    clientId: formData.get("clientId"),
    topic: formData.get("topic"),
    competitor: formData.get("competitor") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const [client] = await db
    .select({ id: clients.id, url: clients.url })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found" };

  try {
    const results = await findProspects({
      topic: parsed.data.topic,
      competitorDomain: parsed.data.competitor,
      myDomain: client.url,
      perQueryLimit: 8,
      totalLimit: 50,
    });
    return { ok: true, results };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message ?? "Search failed",
    };
  }
}

/**
 * Convert a discovered prospect into a tracked submission for this client.
 * Creates the seo_resource row if it doesn't exist (so the curated
 * directory grows organically as users prospect).
 */
export async function trackProspect(formData: FormData): Promise<void> {
  await guardAction("edit", formData.get("clientId"));
  const url = String(formData.get("url") ?? "").trim();
  const clientId = Number(formData.get("clientId"));
  const strategy = String(formData.get("strategy") ?? "resource_pages");
  if (!url || !Number.isFinite(clientId) || clientId <= 0) return;

  let domain: string;
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }

  // Find existing matching resource by URL, or create one
  const [existing] = await db
    .select({ id: seoResources.id })
    .from(seoResources)
    .where(eq(seoResources.url, url))
    .limit(1);

  let resourceId = existing?.id;
  if (!resourceId) {
    const [row] = await db
      .insert(seoResources)
      .values({
        url,
        domain,
        category: strategyToCategory(strategy),
        notes: `Discovered via prospecting: ${strategy}`,
      })
      .returning({ id: seoResources.id });
    resourceId = row.id;
  }

  // Idempotent track
  const [tracked] = await db
    .select({ id: resourceSubmissions.id })
    .from(resourceSubmissions)
    .where(eq(resourceSubmissions.resourceId, resourceId))
    .limit(1);
  if (!tracked) {
    await db.insert(resourceSubmissions).values({
      resourceId,
      clientId,
      status: "pending",
    });
  }
}

function strategyToCategory(strategy: string): string {
  switch (strategy) {
    case "guest_post":
      return "guest_post";
    case "resource_pages":
    case "links_pages":
      return "resource_page";
    case "industry_directories":
      return "directory";
    case "competitor_mentions":
      return "competitor_mention";
    case "broken_link":
      return "broken_link";
    default:
      return "other";
  }
}
