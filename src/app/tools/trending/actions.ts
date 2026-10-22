"use server";

import { z } from "zod";
import {
  findTrendingIdeas,
  type TrendingResult,
} from "@/lib/trending-ideas";
import { saveToolRun } from "@/lib/tool-runs";
import { guardAction } from "@/lib/action-guard";

const inputSchema = z.object({
  topic: z.string().trim().min(2).max(120),
  country: z.string().trim().min(2).max(4).default("US"),
});

export type TrendingState =
  | { ok: true; result: TrendingResult }
  | { ok: false; error: string };

export async function runTrending(
  _prev: TrendingState | null,
  formData: FormData,
): Promise<TrendingState> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = inputSchema.safeParse({
    topic: formData.get("topic"),
    country: formData.get("country") || "US",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const r = await findTrendingIdeas({
    topic: parsed.data.topic,
    country: parsed.data.country,
  });
  if (!r.ok && r.error) return { ok: false, error: r.error };
  await saveToolRun({
    toolId: "trending",
    label: `${parsed.data.topic} (${parsed.data.country})`,
    input: parsed.data,
    result: { ok: true, result: r },
  }).catch(() => undefined);
  return { ok: true, result: r };
}
