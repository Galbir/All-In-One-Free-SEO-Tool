import { describe, expect, it } from "vitest";
import {
  describeGbpApiError,
  describeGbpAuthError,
  isGbpLocationName,
  toV1LocationName,
  toV4LocationName,
  trimGbpSummary,
} from "./gbp-api";
import { toAbsoluteHttpsUrl } from "./daily-automations";

/**
 * Issue #43: posting to Google Business Profile failed every time. The
 * schedule's location was free text, so a business name became the URL
 * path and Google answered with an HTML 404 page, which was then stored
 * verbatim as the error.
 */
describe("GBP location names", () => {
  it("accepts only the full v4 form", () => {
    expect(isGbpLocationName("accounts/123/locations/456")).toBe(true);
    expect(isGbpLocationName("Mono Web")).toBe(false);
    expect(isGbpLocationName("locations/456")).toBe(false);
    expect(isGbpLocationName("accounts/1/locations/2/extra")).toBe(false);
    expect(isGbpLocationName("accounts/1 2/locations/3")).toBe(false);
    expect(isGbpLocationName(null)).toBe(false);
    expect(isGbpLocationName("")).toBe(false);
  });

  it("converts between the v1 and v4 shapes", () => {
    expect(toV4LocationName("locations/9", "accounts/1")).toBe(
      "accounts/1/locations/9",
    );
    expect(toV4LocationName("accounts/1/locations/9", "accounts/1")).toBe(
      "accounts/1/locations/9",
    );
    expect(toV4LocationName("", "accounts/1")).toBe("");
    expect(toV1LocationName("accounts/1/locations/9")).toBe("locations/9");
    expect(toV1LocationName("locations/9")).toBe("locations/9");
  });
});

describe("trimGbpSummary", () => {
  it("leaves short posts alone", () => {
    expect(trimGbpSummary("  Hello there.  ")).toBe("Hello there.");
  });

  it("ends at a sentence break rather than mid-word", () => {
    const text = `${"a".repeat(80)}. ${"b".repeat(40)} tail words`;
    const out = trimGbpSummary(text, 100);
    expect(out.endsWith(".")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it("falls back to a word boundary", () => {
    const text = "word ".repeat(400);
    const out = trimGbpSummary(text, 1500);
    expect(out.length).toBeLessThanOrEqual(1500);
    expect(out.endsWith("word")).toBe(true);
  });
});

describe("readable Google errors", () => {
  it("never stores Google's HTML error page", () => {
    const msg = describeGbpApiError(
      404,
      "Not Found",
      "<!DOCTYPE html><html><title>Error 404 (Not Found)!!1</title>",
      "accounts/1/locations/2",
    );
    expect(msg).not.toContain("<");
    expect(msg).toContain("404");
    expect(msg).toContain("accounts/1/locations/2");
  });

  it("uses the JSON error message when there is one", () => {
    const msg = describeGbpApiError(
      400,
      "Bad Request",
      JSON.stringify({ error: { message: "Request contains an invalid argument." } }),
      "accounts/1/locations/2",
    );
    expect(msg).toBe("Google API 400: Request contains an invalid argument.");
  });

  it("explains an expired refresh token", () => {
    const msg = describeGbpAuthError(
      new Error("invalid_grant: Token has been expired or revoked."),
    );
    expect(msg).toMatch(/Reconnect Google/);
    expect(msg).toMatch(/Testing/);
  });
});

describe("call-to-action url", () => {
  it("normalises a bare domain to https", () => {
    expect(toAbsoluteHttpsUrl("example.com/")).toBe("https://example.com/");
    expect(toAbsoluteHttpsUrl("http://example.com")).toBe("http://example.com/");
  });

  it("rejects things that are not a site", () => {
    expect(toAbsoluteHttpsUrl("")).toBeNull();
    expect(toAbsoluteHttpsUrl(null)).toBeNull();
    expect(toAbsoluteHttpsUrl("localhost")).toBeNull();
  });
});
