/**
 * Next.js runs this once per server process, at boot, before any
 * request is handled. It is the correct hook for starting background
 * work that must not depend on a user visiting a page.
 *
 * This is what makes the automation actually automatic: the scheduler
 * used to be kicked off from the dashboard component, so a self-hosted
 * instance that nobody opened did nothing at all — no rank checks, no
 * page monitoring, no alerts, no scheduled reports, no weekly digest.
 */
export async function register() {
  // Guard on runtime: this file is also evaluated for the edge runtime,
  // where better-sqlite3 and the browser pool don't exist.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Publish the auth mode to process.env before anything is served.
  //
  // Middleware runs in the Edge sandbox and cannot open the database, so
  // it cannot discover on its own whether this install has user accounts
  // or is still in single-password mode. It reads these two variables
  // instead. They must be set here, at boot, because a request that
  // arrives before them would be evaluated under the wrong mode.
  try {
    const { ensureSessionSecret } = await import("./lib/session-secret");
    ensureSessionSecret(); // also assigns process.env.SEO_SESSION_SECRET

    const { accountsEnabled } = await import("./lib/auth");
    if (accountsEnabled()) process.env.SEO_ACCOUNTS_ENABLED = "1";
  } catch (err) {
    // A fresh install whose migrations haven't run yet lands here. That
    // is the same state as "no accounts", which is the safe default —
    // but say so, because silently choosing an auth mode is exactly the
    // kind of thing that should never be invisible.
    console.warn("[instrumentation] could not determine auth mode:", err);
  }

  try {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  } catch (err) {
    // Never let a scheduler problem stop the server from serving. A
    // half-built install (missing native module) should still render
    // the UI so the user can see what's wrong.
    console.error("[instrumentation] scheduler failed to start:", err);
  }
}

/**
 * The real reason a page failed, kept where the owner can read it.
 *
 * Next redacts server errors in production. The browser is handed only:
 *
 *   "An error occurred in the Server Components render. The specific
 *    message is omitted in production builds to avoid leaking sensitive
 *    details. A digest property is included..."
 *
 * That is correct for a public SaaS and actively unhelpful here, where
 * the person running the server and the person seeing the error are the
 * same person. Issue #31 was filed with exactly that text and nothing
 * else — no message, no stack, no digest — because the real error was
 * only ever written to a terminal nobody was watching.
 *
 * This hook receives the unredacted error plus the digest the browser
 * was given, so the two can be matched up: the error page shows a
 * digest, Settings → Errors has the row with the same digest and the
 * actual message.
 *
 * Next calls this for every server-side error, so it must never throw
 * and never be slow — logError already swallows its own failures.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string | undefined> },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logError } = await import("./lib/error-log");
    const digest =
      typeof error === "object" && error !== null && "digest" in error
        ? String((error as { digest?: unknown }).digest ?? "")
        : "";

    // The digest goes in the context rather than the message, so
    // de-duplication still groups repeats of the same fault together —
    // Next issues a fresh digest per occurrence.
    const where = context.routePath || request.path || "unknown route";
    await logError({
      source: "server",
      context: digest ? `${where} · digest ${digest}` : where,
      error,
      url: request.path ?? null,
    });
  } catch {
    // Never let error reporting become the error.
  }
}
