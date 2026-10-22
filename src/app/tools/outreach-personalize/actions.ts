"use server";

import { z } from "zod";
import {
  personalizeOutreach,
  type PersonalizeResult,
} from "@/lib/outreach-personalizer";
import { saveToolRun } from "@/lib/tool-runs";
import { guardAction } from "@/lib/action-guard";

const inputSchema = z.object({
  prospectUrl: z
    .string()
    .trim()
    .min(3)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url()),
  template: z.string().trim().min(20).max(4_000),
  templateSubject: z.string().trim().max(200).optional(),
  senderName: z.string().trim().max(80).optional(),
  goal: z.string().trim().max(200).optional(),
});

export type OutreachState =
  | { ok: true; result: PersonalizeResult }
  | { ok: false; error: string };

export async function runPersonalize(
  _prev: OutreachState | null,
  formData: FormData,
): Promise<OutreachState> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = inputSchema.safeParse({
    prospectUrl: formData.get("prospectUrl"),
    template: formData.get("template"),
    templateSubject: formData.get("templateSubject") || undefined,
    senderName: formData.get("senderName") || undefined,
    goal: formData.get("goal") || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const r = await personalizeOutreach(parsed.data);
  if (!r.ok) return { ok: false, error: r.error };
  await saveToolRun({
    toolId: "outreach-personalize",
    label: parsed.data.prospectUrl,
    input: { prospectUrl: parsed.data.prospectUrl, goal: parsed.data.goal },
    result: { ok: true, result: r },
  }).catch(() => undefined);
  return { ok: true, result: r };
}
