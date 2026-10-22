"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/db/client";
import { clients } from "@/db/schema";

function generateToken(): string {
  // 24 random bytes → 32 chars urlsafe base64. Plenty of entropy for an
  // unlisted share link.
  return randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generateShareToken(clientId: number): Promise<void> {
  await guardAction("edit", clientId);
  if (!Number.isFinite(clientId) || clientId <= 0) return;
  let attempts = 0;
  while (attempts < 5) {
    const token = generateToken();
    try {
      await db
        .update(clients)
        .set({ shareToken: token, updatedAt: new Date() })
        .where(eq(clients.id, clientId));
      revalidatePath(`/clients/${clientId}`);
      return;
    } catch {
      attempts++;
    }
  }
}

export async function revokeShareToken(clientId: number): Promise<void> {
  await guardAction("edit", clientId);
  if (!Number.isFinite(clientId) || clientId <= 0) return;
  await db
    .update(clients)
    .set({ shareToken: null, updatedAt: new Date() })
    .where(eq(clients.id, clientId));
  revalidatePath(`/clients/${clientId}`);
}

import { sendMail } from "@/lib/mailer";
import { getSetting } from "@/lib/settings-store";
import { guardAction } from "@/lib/action-guard";

export type EmailPortalResult =
  | { ok: true }
  | { ok: false; error: string };

export async function emailPortalLink(input: {
  clientId: number;
  recipientEmail?: string;
  baseUrl: string;
}): Promise<EmailPortalResult> {
  await guardAction("edit", input?.clientId);
  if (!Number.isFinite(input.clientId) || input.clientId <= 0) {
    return { ok: false, error: "Invalid client" };
  }
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found" };
  if (!client.shareToken) {
    return {
      ok: false,
      error: "Generate a share link first.",
    };
  }
  const recipient =
    input.recipientEmail?.trim() || client.email?.trim() || "";
  if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) {
    return {
      ok: false,
      error:
        "Need a recipient email — set one on the client, or pass it explicitly.",
    };
  }

  const brandName = (await getSetting<string>("brand.name")) ?? "Your SEO team";
  const portalUrl = `${input.baseUrl.replace(/\/$/, "")}/portal/${client.shareToken}`;

  const subject = `Your ${client.name} SEO progress — live link`;
  const text = `Hi,

Here's your live SEO progress portal for ${client.name}:

${portalUrl}

You'll see the latest audit score, recent work completed, and what's coming next. The link is read-only and updates automatically — no login required.

Bookmark it and check back any time.

— ${brandName}`;

  const html = `<p>Hi,</p>
<p>Here&rsquo;s your live SEO progress portal for <strong>${escapeHtml(client.name)}</strong>:</p>
<p><a href="${escapeAttr(portalUrl)}">${escapeHtml(portalUrl)}</a></p>
<p>You&rsquo;ll see the latest audit score, recent work completed, and what&rsquo;s coming next. The link is read-only and updates automatically &mdash; no login required.</p>
<p>Bookmark it and check back any time.</p>
<p>&mdash; ${escapeHtml(brandName)}</p>`;

  const sendResult = await sendMail({
    to: [recipient],
    subject,
    text,
    html,
  });
  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
