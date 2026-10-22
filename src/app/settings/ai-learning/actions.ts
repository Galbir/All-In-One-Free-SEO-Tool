"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { aiPreferences } from "@/db/schema";
import { distillPreferences } from "@/lib/ai-learn";
import { guardAction } from "@/lib/action-guard";

export async function runDistill(): Promise<{
  ok: boolean;
  ruleCount: number;
  error?: string;
}> {
  await guardAction("settings");
  try {
    const r = await distillPreferences();
    revalidatePath("/settings/ai-learning");
    return { ok: true, ruleCount: r.ruleCount };
  } catch (err) {
    return { ok: false, ruleCount: 0, error: (err as Error).message };
  }
}

export async function togglePreference(id: number): Promise<void> {
  await guardAction("settings");
  if (!Number.isFinite(id) || id <= 0) return;
  const [row] = await db
    .select({ active: aiPreferences.active })
    .from(aiPreferences)
    .where(eq(aiPreferences.id, id))
    .limit(1);
  if (!row) return;
  await db
    .update(aiPreferences)
    .set({ active: !row.active, updatedAt: new Date() })
    .where(eq(aiPreferences.id, id));
  revalidatePath("/settings/ai-learning");
}

export async function deletePreference(id: number): Promise<void> {
  await guardAction("settings");
  if (!Number.isFinite(id) || id <= 0) return;
  await db.delete(aiPreferences).where(eq(aiPreferences.id, id));
  revalidatePath("/settings/ai-learning");
}
