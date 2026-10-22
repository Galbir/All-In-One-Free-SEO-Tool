import { afterEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientKey, isRateLimited, trustedClientIp } from "./rate-limit";

describe("isRateLimited", () => {
  it("reads without counting", () => {
    const key = `peek-${Math.random()}`;
    for (let i = 0; i < 5; i++) expect(isRateLimited(key, 2).limited).toBe(false);
    checkRateLimit(key, { max: 2, windowMs: 60_000 });
    checkRateLimit(key, { max: 2, windowMs: 60_000 });
    expect(isRateLimited(key, 2).limited).toBe(true);
  });
});

describe("trustedClientIp", () => {
  const prev = process.env.TRUSTED_PROXY;
  afterEach(() => {
    process.env.TRUSTED_PROXY = prev;
  });

  it("ignores forwarding headers without a trusted proxy", () => {
    delete process.env.TRUSTED_PROXY;
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(trustedClientIp(h)).toBeNull();
    expect(clientKey(new Request("http://x/", { headers: h }))).toBe("shared");
  });

  it("uses the entry the proxy appended, not the one the client sent", () => {
    process.env.TRUSTED_PROXY = "1";
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(trustedClientIp(h)).toBe("203.0.113.9");
  });
});
