"use server";

import { z } from "zod";
import { linkIntersect, type IntersectResult } from "@/lib/link-intersect";
import { recordToolRun } from "@/lib/tool-findings";
import { linkIntersectFindings } from "@/lib/tool-finding-builders";
import { guardAction } from "@/lib/action-guard";

const domain = z.string().trim().min(3).max(255);

const inputSchema = z.object({
  yourDomain: domain,
  // Three fields rather than a textarea: the form is the instruction. A
  // single box invites one competitor, and one competitor cannot show
  // the signal this tool exists for — that a site links to several.
  competitor1: domain,
  competitor2: z.string().trim().max(255).optional(),
  competitor3: z.string().trim().max(255).optional(),
});

export type IntersectState =
  | { ok: true; result: IntersectResult }
  | { ok: false; error: string };

export async function runLinkIntersect(
  _prev: IntersectState | null,
  formData: FormData,
): Promise<IntersectState> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = inputSchema.safeParse({
    yourDomain: formData.get("yourDomain"),
    competitor1: formData.get("competitor1"),
    competitor2: formData.get("competitor2") || undefined,
    competitor3: formData.get("competitor3") || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.path.join(".") === "competitor1"
          ? "Add at least one competitor domain."
          : (parsed.error.issues[0]?.message ?? "Invalid input"),
    };
  }

  const { yourDomain, competitor1, competitor2, competitor3 } = parsed.data;
  const competitorDomains = [competitor1, competitor2, competitor3].filter(
    (d): d is string => !!d && d.length >= 3,
  );

  try {
    const result = await linkIntersect({ yourDomain, competitorDomains });
    // recordToolRun rather than saveToolRun: the opportunities become
    // findings the rest of the app reads (the client's ranked list, the
    // agent's task planner), instead of a table on this screen only.
    await recordToolRun({
      toolId: "link-intersect",
      label: `${result.yourDomain} vs ${result.competitors.join(", ")}`,
      input: parsed.data,
      result: { ok: true, result },
      findings: linkIntersectFindings(result),
    }).catch(() => undefined);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "Link intersect failed" };
  }
}
