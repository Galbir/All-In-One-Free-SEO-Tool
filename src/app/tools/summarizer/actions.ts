"use server";

import { summarizeContent, type Summary } from "@/lib/content-ai-helpers";
import { saveToolRun } from "@/lib/tool-runs";
import { guardAction } from "@/lib/action-guard";

export type SumState =
  | { ok: true; summary: Summary }
  | { ok: false; error: string };

export async function runSummarize(
  _prev: SumState | null,
  formData: FormData,
): Promise<SumState> {
  await guardAction("edit", formData.get("clientId"));
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { ok: false, error: "Paste some content." };
  const r = await summarizeContent({ text });
  if (!r.ok) return { ok: false, error: r.error };
  await saveToolRun({
    toolId: "summarizer",
    label: `${text.split(/\s+/).length} words → summary`,
    input: { length: text.length },
    result: { ok: true, summary: r.summary },
  }).catch(() => undefined);
  return { ok: true, summary: r.summary };
}
