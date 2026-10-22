"use server";

import {
  auditNewsHeadline,
  type HeadlineAudit,
} from "@/lib/content-ai-helpers";
import { saveToolRun } from "@/lib/tool-runs";
import { guardAction } from "@/lib/action-guard";

export type HeadState =
  | { ok: true; audit: HeadlineAudit }
  | { ok: false; error: string };

export async function runHeadline(
  _prev: HeadState | null,
  formData: FormData,
): Promise<HeadState> {
  await guardAction("edit", formData.get("clientId"));
  const headline = String(formData.get("headline") ?? "").trim();
  const topic = String(formData.get("topic") ?? "").trim() || undefined;
  if (!headline) return { ok: false, error: "Headline required." };
  const r = await auditNewsHeadline({ headline, topic });
  if (!r.ok) return { ok: false, error: r.error };
  await saveToolRun({
    toolId: "news-headline",
    label: headline.slice(0, 80),
    input: { headline, topic },
    result: { ok: true, audit: r.audit },
  }).catch(() => undefined);
  return { ok: true, audit: r.audit };
}
