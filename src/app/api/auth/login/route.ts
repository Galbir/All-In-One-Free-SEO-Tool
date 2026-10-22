import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/secure-compare";
import { expectedToken } from "@/lib/password-token";
import {
  accountsEnabled,
  authenticate,
  isHttps,
  issueSession,
  normaliseEmail,
} from "@/lib/auth";
import { checkRateLimit, clientKey, isRateLimited } from "@/lib/rate-limit";

/**
 * FAILED attempts allowed per window, per account and per caller. There
 * was no limit at all: the 250ms delay on a wrong password is per
 * request, so parallel requests sprayed passwords at full speed.
 *
 * Only failures count, so a team signing in in the morning never trips
 * it. Without a trusted proxy every caller shares one key (Next does not
 * expose the socket address), so that key gets a higher ceiling; the
 * per-account limit is the one that stops guessing.
 */
const LOGIN_FAILURES_PER_ACCOUNT = 10;
const LOGIN_FAILURES_PER_CALLER = 10;
const LOGIN_FAILURES_SHARED = 50;
const LOGIN_WINDOW_MS = 15 * 60_000;

function failureKeys(req: NextRequest, email: string | null) {
  const caller = clientKey(req);
  const keys: { key: string; max: number }[] = [
    {
      key: `login:${caller}`,
      max: caller === "shared" ? LOGIN_FAILURES_SHARED : LOGIN_FAILURES_PER_CALLER,
    },
  ];
  if (email) {
    keys.push({ key: `login:email:${normaliseEmail(email)}`, max: LOGIN_FAILURES_PER_ACCOUNT });
  }
  return keys;
}

function blocked(keys: { key: string; max: number }[]): number | null {
  for (const k of keys) {
    const r = isRateLimited(k.key, k.max);
    if (r.limited) return r.resetAt;
  }
  return null;
}

function recordFailure(keys: { key: string; max: number }[]): void {
  for (const k of keys) {
    checkRateLimit(k.key, { max: k.max, windowMs: LOGIN_WINDOW_MS });
  }
}

function tooMany(resetAt: number) {
  const mins = Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
  return NextResponse.json(
    {
      error: `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    },
    { status: 429, headers: { "retry-after": String(mins * 60) } },
  );
}

export const dynamic = "force-dynamic";

/**
 * Two login modes behind one endpoint, because which one applies is a
 * property of the install, not of the request: if accounts exist we want
 * an email and a password, otherwise this is the original shared-password
 * mode and we want just a password.
 *
 * Accounts take precedence deliberately. Once an agency has real users, a
 * still-set APP_PASSWORD must not remain a back door around them — and it
 * usually IS still set, because that's how the instance was deployed
 * before anyone registered.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { password?: string; email?: string }
    | null;
  const submitted = body?.password ?? "";

  const keys = failureKeys(
    req,
    typeof body?.email === "string" && body.email ? body.email : null,
  );
  const until = blocked(keys);
  if (until !== null) return tooMany(until);

  if (accountsEnabled()) {
    const email = body?.email ?? "";
    if (!email) {
      return NextResponse.json(
        { error: "Enter your email address." },
        { status: 400 },
      );
    }
    const result = await authenticate(email, submitted);
    if (!result.ok) {
      recordFailure(keys);
      // Same jitter as below — a fast "no such user" next to a slow
      // "wrong password" is exactly how account enumeration works.
      await new Promise((r) => setTimeout(r, 250));
      return NextResponse.json({ error: result.error }, { status: 401 });
    }
    await issueSession(result.user);
    return NextResponse.json({
      ok: true,
      user: {
        id: result.user.id,
        name: result.user.name,
        role: result.user.role,
      },
    });
  }

  const required = process.env.APP_PASSWORD;
  if (!required) {
    return NextResponse.json(
      { error: "Auth disabled (APP_PASSWORD not set)" },
      { status: 400 },
    );
  }

  if (!timingSafeEqual(submitted, required)) {
    recordFailure(keys);
    // Small jitter on top of the constant-time compare — defense in depth
    // against any timing inference at the network layer.
    await new Promise((r) => setTimeout(r, 250));
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  // Cookie value is the hashed token, NEVER the raw password. If the
  // cookie leaks, the attacker has to crack SHA-256 to recover the
  // password — not a free read.
  const token = await expectedToken(required);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "stb_auth",
    value: token,
    httpOnly: true,
    sameSite: "lax",
    // Behind a TLS-terminating proxy the request itself is plain http, so
    // honour x-forwarded-proto the way the accounts-mode cookie does.
    secure: req.nextUrl.protocol === "https:" || (await isHttps()),
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
