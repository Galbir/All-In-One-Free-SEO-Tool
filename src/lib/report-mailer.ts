import { eq, and, lte, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, reportSchedules } from "@/db/schema";
import { generateReportPdf, type ReportTemplate } from "./report-generator";
import { sendMail } from "./mailer";
import { getSetting } from "./settings-store";
import { logActivity } from "./activity";
import { isWhiteLabelled, loadBrand } from "./brand";
import { daysInMonth, wallClock, workspaceTimeZone, zonedTime } from "./timezone";

/**
 * Compute the next time this schedule should fire. We store it on the row
 * so the runner can do a fast `nextSendAt <= now` query.
 */
/**
 * When to try a failed scheduled report again: 30 min, 1h, 2h, 4h, 8h,
 * 16h — then stop retrying this period and wait for the next regular
 * slot, so a permanently broken setup (no SMTP, bad address) costs six
 * attempts, not one every few minutes forever.
 */
export function nextAttemptAfterFailure(
  failures: number,
  now: Date,
  nextRegular: () => Date,
): { at: Date; gaveUp: boolean } {
  const MAX_ATTEMPTS = 6;
  if (failures >= MAX_ATTEMPTS) return { at: nextRegular(), gaveUp: true };
  const delayMs = 30 * 60_000 * 2 ** (failures - 1);
  return { at: new Date(now.getTime() + delayMs), gaveUp: false };
}

export function computeNextSendAt(
  schedule: {
    frequency: "weekly" | "monthly";
    dayOfMonth: number | null;
    dayOfWeek: number | null;
    hourOfDay: number;
  },
  from: Date = new Date(),
  timeZone?: string | null,
): Date {
  const now = wallClock(from, timeZone);
  const hour = Math.max(0, Math.min(23, schedule.hourOfDay));

  if (schedule.frequency === "monthly") {
    // Day 29-31 means "that day, or the month's last day if it is
    // shorter". It used to be clamped to the 28th in every month.
    const want = Math.max(1, Math.min(31, schedule.dayOfMonth ?? 1));
    let year = now.year;
    let month = now.month;
    for (let i = 0; i < 3; i++) {
      const day = Math.min(want, daysInMonth(year, month));
      const at = zonedTime(year, month, day, hour, timeZone);
      if (at > from) return at;
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }
  }

  // Weekly (and the unreachable monthly fall-through).
  const targetDow = schedule.dayOfWeek ?? 1;
  let daysAhead = (targetDow - now.weekday + 7) % 7;
  let at = zonedTime(now.year, now.month, now.day + daysAhead, hour, timeZone);
  if (at <= from) {
    daysAhead += 7;
    at = zonedTime(now.year, now.month, now.day + daysAhead, hour, timeZone);
  }
  return at;
}

/**
 * Run all due report schedules. The scheduler (lib/scheduler.ts) owns the
 * cadence; this used to keep its own 5-minute gate in settings on top,
 * a leftover from when it ran off dashboard page loads.
 */
export async function tickScheduleRunner(): Promise<{
  fired: number;
  errors: string[];
}> {
  return runDueSchedules();
}

/**
 * Page-monitor sweep — re-fetches every active monitored page, diffs
 * against the prior snapshot, inserts to pageChanges, and fires any wired
 * webhooks/automations on change.
 *
 * The scheduler decides when (daily). This used to keep a second 24h gate
 * of its own, written BEFORE the work and wrapped in a catch-all — so the
 * Automations screen showed "hourly", the real cadence was daily, a crash
 * cost a full day, and a failure never reached Settings → Automations.
 */
export async function tickPageMonitorRunner(): Promise<void> {
  const { checkAllMonitoredPages } = await import("@/app/monitor/actions");
  await checkAllMonitoredPages();
}

export async function runDueSchedules(): Promise<{
  fired: number;
  errors: string[];
}> {
  const now = new Date();
  const due = await db
    .select()
    .from(reportSchedules)
    .where(
      and(
        eq(reportSchedules.enabled, true),
        isNotNull(reportSchedules.nextSendAt),
        lte(reportSchedules.nextSendAt, now),
      ),
    );

  let fired = 0;
  const errors: string[] = [];

  for (const s of due) {
    try {
      await fireSchedule(s.id);
      fired += 1;
    } catch (err) {
      errors.push(`schedule ${s.id}: ${(err as Error).message}`);
    }
  }
  return { fired, errors };
}

export async function fireSchedule(scheduleId: number): Promise<void> {
  const [s] = await db
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.id, scheduleId))
    .limit(1);
  if (!s) throw new Error("Schedule not found");

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, s.clientId))
    .limit(1);
  if (!client) throw new Error("Client not found");

  const result = await sendReportEmail({
    clientId: s.clientId,
    template: s.template,
    recipients: s.recipients,
  });

  if (!result.ok) {
    // Leaving nextSendAt untouched made the schedule due again on every
    // scheduler tick: the PDF was rebuilt in a headless browser and
    // another error row logged ~96 times a day until someone noticed.
    // Back off instead, and after a day of failures give up on this
    // period and wait for the next regular slot.
    const failuresKey = `automation.report_schedule.${s.id}.failures` as const;
    const failures =
      ((await getSetting<number>(failuresKey).catch(() => null)) ?? 0) + 1;
    const { setSetting } = await import("./settings-store");
    await setSetting(failuresKey, failures).catch(() => undefined);
    const tz = await workspaceTimeZone();
    const plan = nextAttemptAfterFailure(failures, new Date(), () =>
      computeNextSendAt(
        {
          frequency: s.frequency,
          dayOfMonth: s.dayOfMonth,
          dayOfWeek: s.dayOfWeek,
          hourOfDay: s.hourOfDay,
        },
        new Date(),
        tz,
      ),
    );
    await db
      .update(reportSchedules)
      .set({ nextSendAt: plan.at, updatedAt: new Date() })
      .where(eq(reportSchedules.id, scheduleId));
    await logActivity({
      kind: "report.generated",
      message: plan.gaveUp
        ? `Gave up emailing the ${s.template} report for ${client.name} this period after ${failures} failed attempts: ${result.error}. Next try ${plan.at.toISOString().slice(0, 16).replace("T", " ")} UTC.`
        : `Failed to email report for ${client.name} (attempt ${failures}): ${result.error}. Retrying ${plan.at.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      level: "error",
      clientId: client.id,
    });
    if (plan.gaveUp) await setSetting(failuresKey, 0).catch(() => undefined);
    throw new Error(result.error);
  }
  {
    const { setSetting } = await import("./settings-store");
    await setSetting(`automation.report_schedule.${s.id}.failures`, 0).catch(
      () => undefined,
    );
  }

  // Advance nextSendAt
  const next = computeNextSendAt(
    {
      frequency: s.frequency,
      dayOfMonth: s.dayOfMonth,
      dayOfWeek: s.dayOfWeek,
      hourOfDay: s.hourOfDay,
    },
    new Date(),
    await workspaceTimeZone(),
  );
  await db
    .update(reportSchedules)
    .set({
      lastSentAt: new Date(),
      nextSendAt: next,
      updatedAt: new Date(),
    })
    .where(eq(reportSchedules.id, scheduleId));

  await logActivity({
    kind: "report.generated",
    message: `Emailed ${s.template} report for ${client.name} to ${s.recipients.length} recipient${s.recipients.length === 1 ? "" : "s"}.`,
    level: "success",
    clientId: client.id,
  });
}

/**
 * Generate + email a report on demand. Reused by both the runner and the
 * "Send now" button. Returns ok+messageId or ok=false+error.
 */
export async function sendReportEmail(opts: {
  clientId: number;
  template: ReportTemplate;
  recipients: string[];
  /**
   * Send THIS pdf rather than rendering a fresh one.
   *
   * Required by the review workflow, and not an optimisation. A report
   * is generated, a human reads it, approves it — and if sending
   * regenerated the PDF, the client would receive a document nobody had
   * reviewed. Data moves between those two moments: a rank check runs,
   * an audit completes, a task is ticked off. The approved bytes are
   * the ones that must go out.
   */
  pdf?: Buffer;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  if (opts.recipients.length === 0) {
    return { ok: false, error: "No recipients" };
  }
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, opts.clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found" };

  let pdf: Buffer;
  if (opts.pdf) {
    pdf = opts.pdf;
  } else {
    try {
      pdf = await generateReportPdf(opts.clientId, opts.template);
    } catch (err) {
      return { ok: false, error: `PDF generation failed: ${(err as Error).message}` };
    }
  }

  const periodLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // The email is the last thing between an agency and their client, and
  // it was the least branded surface in the product: no agency name, no
  // sign-off, no contact details. A report that arrives from nobody
  // looks automated, which is the opposite of what an agency is
  // charging for.
  const brand = await loadBrand();
  const agency = isWhiteLabelled(brand) ? brand.name!.trim() : null;

  const subject = agency
    ? `${client.name} — SEO report, ${periodLabel} (${agency})`
    : `${client.name} — SEO Report (${periodLabel})`;

  const signOff: string[] = [];
  if (agency) {
    signOff.push(``, `— ${agency}`);
    // Only lines the user actually filled in. A signature with blank
    // rows where a phone number should be looks worse than none.
    if (brand.website) signOff.push(brand.website);
    if (brand.email) signOff.push(brand.email);
    if (brand.phone) signOff.push(brand.phone);
  }
  if (brand.footerText) signOff.push(``, brand.footerText);

  const text = [
    `Hi,`,
    ``,
    agency
      ? `Attached is your SEO report for ${client.name} (${periodLabel}), from ${agency}.`
      : `Attached is your SEO report for ${client.name} (${periodLabel}).`,
    ``,
    `Highlights inside:`,
    `· Health score with WoW delta`,
    `· Top organic keywords from Search Console`,
    `· Quick-win opportunities (positions 4-15)`,
    `· Tasks completed and recommendations for next month`,
    ``,
    `Reply to this email if anything's unclear.`,
    ...signOff,
  ].join("\n");

  const result = await sendMail({
    to: opts.recipients,
    subject,
    text,
    attachments: [
      {
        filename: `${slugify(client.name)}-seo-report-${periodLabel.toLowerCase().replace(/\s/g, "-")}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });

  return result;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
