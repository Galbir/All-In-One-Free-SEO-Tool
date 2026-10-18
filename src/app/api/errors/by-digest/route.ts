/**
 * Turn a digest into the error it stands for.
 *
 * v0.6.1 made this possible: `onRequestError` stores the real,
 * unredacted server error against the digest Next hands the browser.
 * The error page then told the reader to go and look it up themselves
 * in Settings → Errors — and issue #36 arrived with the digest filled
 * in correctly and still no message, because the reporter had no reason
 * to know that lookup existed.
 *
 * So the page asks on their behalf. Same machine, same database, two
 * halves of the same error: there is no reason to make a person carry a
 * number between them.
 */

import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db/client";
import { systemErrors } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const digest = new URL(req.url).searchParams.get("digest")?.trim() ?? "";

  // Next's digests are numeric strings. Anything else is not worth a
  // LIKE against the error table.
  if (!/^[0-9]{4,32}$/.test(digest)) {
    return Response.json({ ok: false, error: "bad digest" }, { status: 400 });
  }

  try {
    const [row] = await db
      .select({
        message: systemErrors.message,
        stack: systemErrors.stack,
        context: systemErrors.context,
        occurrences: systemErrors.occurrences,
        lastSeenAt: systemErrors.lastSeenAt,
      })
      .from(systemErrors)
      .where(
        and(
          eq(systemErrors.source, "server"),
          like(systemErrors.context, `%digest ${digest}%`),
        ),
      )
      .orderBy(desc(systemErrors.lastSeenAt))
      .limit(1);

    if (!row) {
      // Not an error condition. The server may have restarted, or the
      // row may have aged out of retention, and saying so plainly beats
      // a 404 the page has to interpret.
      return Response.json({ ok: true, found: false });
    }

    return Response.json({
      ok: true,
      found: true,
      message: row.message,
      // Enough to locate the fault, not the whole trace — this goes
      // into a public issue body.
      stack: row.stack ? row.stack.split("\n").slice(0, 12).join("\n") : null,
      context: row.context,
      occurrences: row.occurrences,
    });
  } catch {
    return Response.json({ ok: true, found: false });
  }
}
