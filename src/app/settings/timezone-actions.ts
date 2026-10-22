"use server";

import { revalidatePath } from "next/cache";
import { guardAction } from "@/lib/action-guard";
import { deleteSetting, setSetting } from "@/lib/settings-store";
import { isValidTimeZone } from "@/lib/timezone";

export async function saveWorkspaceTimeZone(
  _prev: { ok: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await guardAction("settings");
  const tz = String(formData.get("timezone") ?? "").trim();
  if (tz === "") {
    await deleteSetting("workspace.timezone");
  } else if (!isValidTimeZone(tz)) {
    return { ok: false, error: "That isn't a time zone this server recognises." };
  } else {
    await setSetting("workspace.timezone", tz);
  }
  // Re-time existing schedules now, rather than leaving each on its old
  // slot until it next sends.
  const { db } = await import("@/db/client");
  const { reportSchedules } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { computeNextSendAt } = await import("@/lib/report-mailer");
  const zone = tz === "" ? null : tz;
  const rows = await db.select().from(reportSchedules);
  for (const r of rows) {
    if (!r.enabled) continue;
    await db
      .update(reportSchedules)
      .set({
        nextSendAt: computeNextSendAt(
          {
            frequency: r.frequency,
            dayOfMonth: r.dayOfMonth,
            dayOfWeek: r.dayOfWeek,
            hourOfDay: r.hourOfDay,
          },
          new Date(),
          zone,
        ),
        updatedAt: new Date(),
      })
      .where(eq(reportSchedules.id, r.id));
  }
  revalidatePath("/settings");
  return { ok: true };
}
