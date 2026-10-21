"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, dailySchedules, type NewDailySchedule } from "@/db/schema";
import { isGbpLocationName } from "@/lib/gbp-api";
import { guardAction } from "@/lib/action-guard";

export type CreateScheduleState =
  | { ok: true; id: number }
  | { ok: false; error: string }
  | null;

export async function createSchedule(
  _prev: CreateScheduleState,
  formData: FormData,
): Promise<CreateScheduleState> {
  await guardAction("edit", formData.get("clientId"));
  const clientId = Number(formData.get("clientId"));
  const kind = String(formData.get("kind") ?? "");
  const cadenceDays = Math.max(1, Math.min(90, Number(formData.get("cadenceDays") ?? 1)));
  const timeUtc = Math.max(0, Math.min(2359, Number(formData.get("timeUtc") ?? 900)));
  const autoPublishRaw = formData.get("autoPublish") === "on";
  const topicSeed = String(formData.get("topicSeed") ?? "").slice(0, 200);
  const tone = String(formData.get("tone") ?? "").slice(0, 200);
  const gbpLocationName = String(formData.get("gbpLocationName") ?? "")
    .trim()
    .slice(0, 200);
  const postType = String(formData.get("postType") ?? "STANDARD");
  const gbpSource =
    formData.get("gbpSource") === "woo_product" ? "woo_product" : "topic";
  const blogSourceRaw = String(formData.get("blogSource") ?? "topic");
  const blogSource =
    blogSourceRaw === "woo_product" || blogSourceRaw === "woo_products"
      ? blogSourceRaw
      : "topic";
  const socialSource =
    formData.get("socialSource") === "woo_product" ? "woo_product" : "topic";
  const keywordsMode = formData.get("keywordsMode") === "custom" ? "custom" : "top";
  const keywordsCustom = String(formData.get("keywordsCustom") ?? "")
    .split(/[,\n;]/)
    .map((k) => k.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 20);
  const ctaTypeRaw = String(formData.get("ctaType") ?? "auto");
  const ctaType = ["SHOP", "ORDER", "LEARN_MORE", "BOOK", "SIGN_UP", "CALL"].includes(
    ctaTypeRaw,
  )
    ? ctaTypeRaw
    : null;
  const buttonText = String(formData.get("buttonText") ?? "").trim().slice(0, 40);
  const buttonText2 = String(formData.get("buttonText2") ?? "").trim().slice(0, 40);
  const offerCoupon = String(formData.get("offerCoupon") ?? "")
    .trim()
    .slice(0, 58);
  const maxChars = Math.max(
    150,
    Math.min(1500, Number(formData.get("maxChars") ?? 600) || 600),
  );
  // Where the approved item ultimately goes:
  //   "local"     — save in the tool's queue; copy/paste yourself (no integration needed)
  //   "wordpress" — publish via WP bridge plugin
  //   "gbp"       — publish via Google Business Profile API
  const destinationRaw = String(formData.get("destination") ?? "local");
  const destination =
    destinationRaw === "wordpress" || destinationRaw === "gbp"
      ? destinationRaw
      : "local";
  // Local mode is never auto-publish (there's nothing to publish to);
  // suppress the flag if the user toggled it on by mistake.
  const autoPublish = destination === "local" ? false : autoPublishRaw;

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return { ok: false, error: "Bad client." };
  }
  if (
    !["blog_draft", "gbp_post", "social_post", "internal_checklist"].includes(
      kind,
    )
  ) {
    return { ok: false, error: "Pick a kind." };
  }

  // The location becomes a URL path segment. A business name typed here
  // produced `POST /v4/Mono Web/localPosts` and Google's HTML 404 (#43).
  if (kind === "gbp_post" && gbpLocationName && !isGbpLocationName(gbpLocationName)) {
    return {
      ok: false,
      error:
        "The GBP location must look like accounts/…/locations/… — or leave it empty to use the client's listing.",
    };
  }
  if (kind === "gbp_post") {
    const [client] = await db
      .select({ gbpLocationName: clients.gbpLocationName, url: clients.url })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (gbpSource === "woo_product" && !client?.url) {
      return {
        ok: false,
        error:
          "Product posts read the shop's WooCommerce catalogue — add the client's website URL first.",
      };
    }
    if (
      destination === "gbp" &&
      !gbpLocationName &&
      !isGbpLocationName(client?.gbpLocationName)
    ) {
      return {
        ok: false,
        error:
          'This client has no Business Profile listing chosen yet. Pick it under GBP → this client → Reviews ("Which listing"), then create the schedule.',
      };
    }
  }

  if (keywordsMode === "custom" && keywordsCustom.length === 0) {
    return { ok: false, error: "Type at least one keyword, or use the top keywords." };
  }
  if (
    (kind === "blog_draft" && blogSource !== "topic") ||
    (kind === "social_post" && socialSource !== "topic")
  ) {
    const [client] = await db
      .select({ url: clients.url })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client?.url) {
      return {
        ok: false,
        error:
          "Product articles read the shop's WooCommerce catalogue — add the client's website URL first.",
      };
    }
  }

  const config: Record<string, unknown> = { destination };
  config.keywords_mode = keywordsMode;
  if (keywordsMode === "custom") config.keywords_custom = keywordsCustom;
  if (kind === "blog_draft") config.blog_source = blogSource;
  if (kind === "social_post") config.social_source = socialSource;
  if (buttonText && (kind === "blog_draft" || kind === "social_post")) {
    config.button_text = buttonText;
  }
  if (buttonText2 && kind === "blog_draft") config.button_text_2 = buttonText2;
  if (topicSeed) config.topic_seed = topicSeed;
  if (tone) config.tone = tone;
  if (kind === "gbp_post") {
    if (gbpLocationName) config.gbp_location_name = gbpLocationName;
    config.post_type = postType;
    config.gbp_source = gbpSource;
    config.max_chars = maxChars;
    if (ctaType) config.cta_type = ctaType;
    if (postType === "OFFER" && offerCoupon) config.offer_coupon = offerCoupon;
  }

  const insert: NewDailySchedule = {
    clientId,
    kind: kind as NewDailySchedule["kind"],
    cadenceDays,
    timeUtc,
    autoPublish,
    enabled: true,
    configJson: config,
    // Run on the next tick so the user can see it work today
    nextRunAt: new Date(),
  };
  const [row] = await db
    .insert(dailySchedules)
    .values(insert)
    .returning({ id: dailySchedules.id });
  revalidatePath(`/clients/${clientId}/automations`);
  return { ok: true, id: row.id };
}

export async function toggleScheduleEnabled(
  scheduleId: number,
  clientId: number,
): Promise<void> {
  await guardAction("edit", clientId);
  const [s] = await db
    .select()
    .from(dailySchedules)
    .where(
      and(
        eq(dailySchedules.id, scheduleId),
        eq(dailySchedules.clientId, clientId),
      ),
    )
    .limit(1);
  if (!s) return;
  await db
    .update(dailySchedules)
    .set({ enabled: !s.enabled, updatedAt: new Date() })
    .where(eq(dailySchedules.id, scheduleId));
  revalidatePath(`/clients/${clientId}/automations`);
}

export async function deleteSchedule(
  scheduleId: number,
  clientId: number,
): Promise<void> {
  await guardAction("edit", clientId);
  await db
    .delete(dailySchedules)
    .where(
      and(
        eq(dailySchedules.id, scheduleId),
        eq(dailySchedules.clientId, clientId),
      ),
    );
  revalidatePath(`/clients/${clientId}/automations`);
}

/**
 * Generate immediately, bypassing the schedule. Useful when the user
 * wants to test a schedule's prompt before letting it run daily.
 */
export async function runScheduleNow(
  scheduleId: number,
  clientId: number,
): Promise<{ ok: boolean; message: string }> {
  await guardAction("edit", clientId);
  const [s] = await db
    .select()
    .from(dailySchedules)
    .where(
      and(
        eq(dailySchedules.id, scheduleId),
        eq(dailySchedules.clientId, clientId),
      ),
    )
    .limit(1);
  if (!s) return { ok: false, message: "Schedule not found." };

  // Forcing nextRunAt to now and ticking — keeps a single code path.
  await db
    .update(dailySchedules)
    .set({ nextRunAt: new Date(), updatedAt: new Date() })
    .where(eq(dailySchedules.id, s.id));
  const { tickScheduleGeneration } = await import("@/lib/daily-automations");
  const r = await tickScheduleGeneration();
  revalidatePath(`/clients/${clientId}/automations`);
  revalidatePath(`/clients/${clientId}/queue`);
  return {
    ok: r.generated > 0,
    message:
      r.generated > 0
        ? `Generated ${r.generated} item${r.generated === 1 ? "" : "s"}. Check the review queue.`
        : "Nothing was generated. Check the activity log for the reason.",
  };
}
