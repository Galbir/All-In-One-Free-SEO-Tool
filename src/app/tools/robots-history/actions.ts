"use server";

import { revalidatePath } from "next/cache";
import { snapshotRobots, listSnapshots } from "@/lib/robots-snapshots";
import { guardAction } from "@/lib/action-guard";

export type SnapshotState =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export async function runSnapshot(
  _prev: SnapshotState | null,
  formData: FormData,
): Promise<SnapshotState> {
  await guardAction("edit", formData.get("clientId"));
  const host = String(formData.get("host") ?? "").trim();
  if (!host) return { ok: false, error: "Enter a domain." };
  const r = await snapshotRobots(host);
  revalidatePath("/tools/robots-history");
  if (!r.ok) return { ok: false, error: r.error ?? "Snapshot failed" };
  return { ok: true, changed: r.changed };
}

export async function loadSnapshots(host: string) {
  await guardAction("read");
  return listSnapshots(host);
}
