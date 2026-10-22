"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { uptimeTargets } from "@/db/schema";
import { pingAll } from "@/lib/uptime";
import { guardAction } from "@/lib/action-guard";

export async function addTarget(formData: FormData) {
  await guardAction("edit", formData.get("clientId"));
  const url = String(formData.get("url") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim() || null;
  const expectedStatus = Number(formData.get("expectedStatus") ?? 200);
  const expectedText = String(formData.get("expectedText") ?? "").trim() || null;
  if (!url) return { ok: false as const, error: "URL required." };
  if (!/^https?:\/\//i.test(url))
    return { ok: false as const, error: "URL must start with http(s)://" };
  await db.insert(uptimeTargets).values({
    url,
    label,
    expectedStatus,
    expectedText,
    enabled: true,
  });
  revalidatePath("/tools/uptime");
  return { ok: true as const };
}

export async function deleteTarget(id: number) {
  await guardAction("edit");
  await db.delete(uptimeTargets).where(eq(uptimeTargets.id, id));
  revalidatePath("/tools/uptime");
}

export async function toggleTarget(id: number, enabled: boolean) {
  await guardAction("edit");
  await db
    .update(uptimeTargets)
    .set({ enabled })
    .where(eq(uptimeTargets.id, id));
  revalidatePath("/tools/uptime");
}

export async function runPingNow() {
  await guardAction("edit");
  const r = await pingAll();
  revalidatePath("/tools/uptime");
  return r;
}
