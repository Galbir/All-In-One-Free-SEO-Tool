"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deleteSetting, setSetting } from "@/lib/settings-store";
import { sendToWebhook, detectKind } from "@/lib/notifier";
import { guardAction } from "@/lib/action-guard";

const webhookSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Must be http(s)");

export type WebhookActionResult =
  | { ok: true; message: string; kind?: string }
  | { ok: false; error: string };

export async function saveWebhookUrl(
  _prev: WebhookActionResult | null,
  formData: FormData,
): Promise<WebhookActionResult> {
  await guardAction("settings", formData.get("clientId"));
  const raw = String(formData.get("url") ?? "").trim();

  if (raw === "") {
    await deleteSetting("webhook.url");
    revalidatePath("/settings");
    return { ok: true, message: "Webhook removed." };
  }

  const parsed = webhookSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid http(s) URL." };
  }

  await setSetting("webhook.url", parsed.data);
  revalidatePath("/settings");
  return {
    ok: true,
    message: "Webhook saved.",
    kind: detectKind(parsed.data),
  };
}

export async function testWebhook(
  _prev: WebhookActionResult | null,
  formData: FormData,
): Promise<WebhookActionResult> {
  await guardAction("settings", formData.get("clientId"));
  const raw = String(formData.get("url") ?? "").trim();

  const parsed = webhookSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Save a valid webhook URL first." };
  }

  const result = await sendToWebhook(parsed.data, {
    title: "👋 SEO tool connected",
    body: "If you see this message, your webhook is wired up correctly. You'll get notifications here when audits complete or scores drop.",
    level: "info",
    fields: [
      { label: "Service", value: detectKind(parsed.data) },
      { label: "Sent at", value: new Date().toLocaleString() },
    ],
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    message: `Test sent successfully (HTTP ${result.status}, ${result.kind} format).`,
  };
}

/**
 * Remember which model the AI features should use.
 *
 * An empty string clears it, which falls back to the provider's first
 * preset — the behaviour before this setting existed.
 */
export async function saveDefaultModel(model: string): Promise<void> {
  await guardAction("settings");
  const trimmed = String(model ?? "").trim().slice(0, 120);
  await setSetting("ai.default_model", trimmed);
  revalidatePath("/settings");
}
