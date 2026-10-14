/**
 * Client-side error sink. The browser's global error trap (in
 * <ClientErrorCapture />) POSTs here when window.onerror or
 * unhandledrejection fires. Dedupes via the same (source, context,
 * message) tuple as server errors.
 */

import { logError } from "@/lib/error-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    message?: string;
    stack?: string;
    url?: string;
    userAgent?: string;
    context?: string;
    /** Next's production error digest, when the browser was given one. */
    digest?: string | null;
  } | null = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!body?.message) {
    return Response.json({ ok: false, error: "no message" }, { status: 400 });
  }
  // Synthesize an Error so the helper extracts cleanly
  const synthetic = new Error(body.message);
  if (body.stack) synthetic.stack = body.stack;
  // The digest is what ties this browser-side row to the server-side
  // row that holds the real, unredacted message (see onRequestError in
  // instrumentation.ts). Without it the two cannot be matched and the
  // report says nothing, which is how issue #31 arrived.
  const context = [body.context?.slice(0, 160) ?? "browser",
    body.digest ? `digest ${String(body.digest).slice(0, 40)}` : null]
    .filter(Boolean)
    .join(" · ");

  await logError({
    source: "client",
    context,
    error: synthetic,
    url: body.url ?? null,
    userAgent: body.userAgent ?? null,
  });
  return Response.json({ ok: true });
}
