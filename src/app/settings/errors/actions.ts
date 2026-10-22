"use server";

import { revalidatePath } from "next/cache";
import { clearAllResolved, markErrorResolved } from "@/lib/error-log";
import { guardAction } from "@/lib/action-guard";

export async function resolveErrorAction(id: number): Promise<void> {
  await guardAction("settings");
  await markErrorResolved(id);
  revalidatePath("/settings/errors");
}

export async function clearResolvedAction(): Promise<void> {
  await guardAction("settings");
  await clearAllResolved();
  revalidatePath("/settings/errors");
}
