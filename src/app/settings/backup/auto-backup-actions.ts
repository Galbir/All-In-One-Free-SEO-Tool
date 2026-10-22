"use server";

import { revalidatePath } from "next/cache";
import { setSetting } from "@/lib/settings-store";
import { guardAction } from "@/lib/action-guard";

/**
 * Save the auto-backup preferences. Bound to the form on
 * AutoBackupCard. Clamps inputs to sane ranges so a malicious or
 * accidental "retention=999999999" can't fill the disk.
 */
export async function saveAutoBackupSettings(formData: FormData) {
  await guardAction("settings", formData.get("clientId"));
  const enabled = formData.get("enabled") === "on";
  const cadenceRaw = Number(formData.get("cadence_hours"));
  const retentionRaw = Number(formData.get("retention"));

  const cadence =
    Number.isFinite(cadenceRaw) && cadenceRaw >= 1 && cadenceRaw <= 720
      ? Math.round(cadenceRaw)
      : 24;
  const retention =
    Number.isFinite(retentionRaw) && retentionRaw >= 1 && retentionRaw <= 365
      ? Math.round(retentionRaw)
      : 7;

  await setSetting("autobackup.enabled", enabled);
  await setSetting("autobackup.cadence_hours", cadence);
  await setSetting("autobackup.retention", retention);
  revalidatePath("/settings/backup");
}
