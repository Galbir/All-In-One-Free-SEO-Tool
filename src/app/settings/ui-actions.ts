"use server";

import { revalidatePath } from "next/cache";
import { setSetting, getSetting } from "@/lib/settings-store";
import { guardAction } from "@/lib/action-guard";

export async function setUiMode(mode: "guided" | "pro") {
  await guardAction("personal");
  await setSetting("ui.mode", mode);
  revalidatePath("/", "layout");
}

export async function getUiMode(): Promise<"guided" | "pro"> {
  await guardAction("personal");
  const m = await getSetting<"guided" | "pro">("ui.mode");
  return m ?? "guided";
}
