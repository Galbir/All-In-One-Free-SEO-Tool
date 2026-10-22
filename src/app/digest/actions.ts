"use server";

import { z } from "zod";
import { buildWeeklyDigest } from "@/lib/weekly-digest";
import { sendMail } from "@/lib/mailer";
import { setSetting, getSetting } from "@/lib/settings-store";
import { guardAction } from "@/lib/action-guard";

const sendSchema = z.object({
  to: z.string().email(),
  subject: z.string().trim().min(2).max(120).default("Weekly SEO digest"),
});

export type SendState =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export async function sendDigest(
  _prev: SendState | null,
  formData: FormData,
): Promise<SendState> {
  await guardAction("edit", formData.get("clientId"));
  const parsed = sendSchema.safeParse({
    to: formData.get("to"),
    subject: formData.get("subject") || "Weekly SEO digest",
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid email address",
    };
  }

  const digest = await buildWeeklyDigest();

  const result = await sendMail({
    to: [parsed.data.to],
    subject: parsed.data.subject,
    text: digest.textVersion,
    html: digest.htmlVersion,
  });
  if (!result.ok) return { ok: false, error: result.error ?? "Send failed" };

  // Save the email so we can use it as the default for the auto-schedule
  await setSetting("digest.recipient_email", parsed.data.to);
  await setSetting("digest.last_sent_at", new Date().toISOString());

  return { ok: true, messageId: result.messageId ?? null };
}

export type ScheduleState =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function setSchedule(
  _prev: ScheduleState | null,
  formData: FormData,
): Promise<ScheduleState> {
  await guardAction("edit", formData.get("clientId"));
  const enabled = formData.get("enabled") === "on";
  const email = String(formData.get("email") ?? "").trim();
  if (enabled) {
    const r = z.string().email().safeParse(email);
    if (!r.success)
      return { ok: false, error: "Valid recipient email required to enable." };
    await setSetting("digest.recipient_email", email);
    await setSetting("digest.auto_send_enabled", true);
    return {
      ok: true,
      message: `Auto-send enabled. Will run every Monday 09:00 UTC to ${email}.`,
    };
  }
  await setSetting("digest.auto_send_enabled", false);
  return { ok: true, message: "Auto-send disabled." };
}

export async function loadDigestSettings() {
  await guardAction("read");
  return {
    recipientEmail:
      (await getSetting<string>("digest.recipient_email")) ?? "",
    autoSendEnabled: Boolean(
      await getSetting<boolean>("digest.auto_send_enabled"),
    ),
    lastSentAt: (await getSetting<string>("digest.last_sent_at")) ?? null,
  };
}
