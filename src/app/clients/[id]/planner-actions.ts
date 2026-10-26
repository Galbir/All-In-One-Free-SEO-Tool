"use server";

import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/action-guard";
import { discoverClientKeywords, trackKeywords } from "@/lib/google-ads";

export type TrackPlannerResult = { ok: boolean; message: string };

/** Track the best planner ideas for a client, or ones the user ticked. */
export async function trackPlannerKeywords(
  clientId: number,
  chosen: string[] | null,
): Promise<TrackPlannerResult> {
  await guardAction("edit", clientId);
  try {
    const texts =
      chosen ??
      (await discoverClientKeywords(clientId, { limit: 10 })).map((i) => i.text);
    const added = await trackKeywords(clientId, texts.slice(0, 50));
    revalidatePath(`/clients/${clientId}`);
    return {
      ok: true,
      message:
        added > 0
          ? `Now tracking ${added} new keyword${added === 1 ? "" : "s"}.`
          : "Those are already tracked.",
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Ask the planner again, ignoring the one-day cache. */
export async function refreshPlannerIdeas(clientId: number) {
  await guardAction("edit", clientId);
  try {
    await discoverClientKeywords(clientId, { refresh: true });
  } catch {
    // the panel shows the error on its next render
  }
  revalidatePath(`/clients/${clientId}`);
}
