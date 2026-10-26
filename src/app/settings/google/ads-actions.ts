"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteSetting, setSetting } from "@/lib/settings-store";
import { encrypt } from "@/lib/crypto";
import { guardAction } from "@/lib/action-guard";

const tenDigits = (v: string) => v.replace(/\D/g, "").length === 10;

const adsSchema = z.object({
  developerToken: z.string().trim().max(200),
  customerId: z.string().trim().refine(tenDigits, "Ten digits, like 123-456-7890"),
  loginCustomerId: z
    .string()
    .trim()
    .refine((v) => v === "" || tenDigits(v), "Ten digits, or leave empty"),
});

export type SaveAdsResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

export async function saveGoogleAds(
  _prev: SaveAdsResult | null,
  formData: FormData,
): Promise<SaveAdsResult> {
  await guardAction("settings");
  const parsed = adsSchema.safeParse({
    developerToken: formData.get("developerToken") ?? "",
    customerId: formData.get("customerId") ?? "",
    loginCustomerId: formData.get("loginCustomerId") ?? "",
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? "_";
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const { developerToken, customerId, loginCustomerId } = parsed.data;
  // An empty token field keeps the saved one.
  if (developerToken) {
    await setSetting("google_ads.developer_token", encrypt(developerToken));
  }
  await setSetting("google_ads.customer_id", customerId.replace(/\D/g, ""));
  if (loginCustomerId) {
    await setSetting(
      "google_ads.login_customer_id",
      loginCustomerId.replace(/\D/g, ""),
    );
  } else {
    await deleteSetting("google_ads.login_customer_id");
  }
  revalidatePath("/settings/google");
  return { ok: true };
}

export async function clearGoogleAds() {
  await guardAction("settings");
  await Promise.all([
    deleteSetting("google_ads.developer_token"),
    deleteSetting("google_ads.customer_id"),
    deleteSetting("google_ads.login_customer_id"),
    deleteSetting("google_ads.refresh_token"),
  ]);
  revalidatePath("/settings/google");
}

export type TestAdsResult = { ok: boolean; message: string };

/** One small planner call, to show the setup works before a schedule needs it. */
export async function testGoogleAds(): Promise<TestAdsResult> {
  await guardAction("settings");
  try {
    const { generateKeywordIdeas } = await import("@/lib/google-ads");
    const ideas = await generateKeywordIdeas({ seeds: ["seo"], limit: 5 });
    const first = ideas[0];
    return {
      ok: true,
      message: `Works. Keyword Planner returned ${ideas.length} ideas${
        first
          ? ` (for example "${first.text}", ${first.volume.toLocaleString()} searches a month)`
          : ""
      }.`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
