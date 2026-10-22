/**
 * Tiny in-memory rate limiter. One sliding window per key. Self-hosted
 * single-process app — no Redis, no distributed concerns.
 *
 * Usage:
 *   const allowed = checkRateLimit(`test:${ip}`, { max: 10, windowMs: 60_000 });
 *   if (!allowed) return new Response("rate limited", { status: 429 });
 *
 * Cleanup: stale buckets are pruned lazily on each check, so memory
 * usage stays bounded even when many distinct keys appear.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitOpts = {
  /** Max requests permitted in the window */
  max: number;
  /** Window length in ms */
  windowMs: number;
};

export function checkRateLimit(key: string, opts: RateLimitOpts): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    const bucket: Bucket = { count: 1, resetAt: now + opts.windowMs };
    buckets.set(key, bucket);
    // Opportunistic cleanup — drop expired buckets so the map stays bounded
    if (buckets.size > 1000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(k);
      }
    }
    return { allowed: true, remaining: opts.max - 1, resetAt: bucket.resetAt };
  }

  if (existing.count >= opts.max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: opts.max - existing.count,
    resetAt: existing.resetAt,
  };
}

/**
 * Is `key` currently over `max`? Reads without counting — for limits
 * that should only count failures (a sign-in limit that counted every
 * attempt would lock a whole team out on a busy morning).
 */
export function isRateLimited(key: string, max: number): {
  limited: boolean;
  resetAt: number;
} {
  const b = buckets.get(key);
  if (!b || Date.now() >= b.resetAt) return { limited: false, resetAt: 0 };
  return { limited: b.count >= max, resetAt: b.resetAt };
}

/**
 * The caller's IP, when it can be known, or null.
 *
 * `X-Forwarded-For` is a list the client starts and each proxy appends
 * to. The FIRST entry is whatever the client chose to send, so keying a
 * rate limit on it let anyone rotate past the limit by inventing a new
 * header per request — even behind nginx, which appends rather than
 * replaces. The entry a proxy you control vouches for is the LAST one.
 *
 * Without a trusted proxy (TRUSTED_PROXY=1), forwarding headers are not
 * evidence of anything and are ignored. Next does not expose the socket
 * address to server actions or route handlers, so the answer is null and
 * callers fall back to a global limit.
 */
export function trustedClientIp(headers: Headers): string | null {
  if (process.env.TRUSTED_PROXY !== "1") return null;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}

/**
 * A stable rate-limit key for a request: the trusted client IP, else one
 * shared key. For a self-hosted local app that is effectively "this
 * machine", which is what the limits below are written for.
 */
export function clientKey(req: Request): string {
  return trustedClientIp(req.headers) ?? "shared";
}
