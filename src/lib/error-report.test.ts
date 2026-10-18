import { describe, it, expect } from "vitest";
import { friendlyError } from "./friendly-error";

/**
 * Issue #31 was filed from the error page and contained nothing that
 * could be acted on: a redacted production message, no digest, and a
 * "My setup" section where every line still read "(run `git rev-parse
 * --short HEAD` in the repo)".
 *
 * None of that was the reporter's fault. The template asked somebody
 * whose app had just broken to go and run git commands, so of course it
 * came back blank — and the one field that would have identified the
 * real error, the digest, was not in the template at all.
 *
 * These assert the report carries what a maintainer needs without the
 * reporter typing anything.
 */

const REDACTED =
  "An error occurred in the Server Components render. The specific message is " +
  "omitted in production builds to avoid leaking sensitive details. A digest " +
  "property is included on this error instance which may provide additional details.";

const ENV = {
  version: "0.6.0",
  commit: "a1b2c3d",
  node: "v22.11.0",
  platform: "win32 10.0.26220",
  mode: "production",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141",
  digest: "3983558387",
};

describe("the pre-filled bug report", () => {
  it("never asks the reporter to run a command", () => {
    const fe = friendlyError(REDACTED, "page-error-boundary", undefined, ENV);
    const body = fe.githubIssue?.body ?? "";
    expect(body).not.toContain("git rev-parse");
    expect(body).not.toContain("node -v");
    expect(body).not.toMatch(/\(Windows \/ macOS \/ Linux/);
  });

  it("carries the version, runtime and platform it was told", () => {
    const body = friendlyError(REDACTED, "page-error-boundary", undefined, ENV)
      .githubIssue?.body ?? "";
    expect(body).toContain("0.6.0");
    expect(body).toContain("a1b2c3d");
    expect(body).toContain("v22.11.0");
    expect(body).toContain("win32");
    expect(body).toContain("production");
    expect(body).toContain("Chrome/141");
  });

  it("carries the digest when the real error could not be resolved", () => {
    // The digest alone is what connects the notice the browser shows to
    // the unredacted message onRequestError wrote. It used to tell the
    // reader to look it up in Settings; the page now does that itself,
    // so this path only runs when the lookup came back empty.
    const body = friendlyError(REDACTED, "page-error-boundary", undefined, ENV)
      .githubIssue?.body ?? "";
    expect(body).toContain("3983558387");
    expect(body).toMatch(/no matching row|restarted/i);
  });

  it("still produces a usable report when nothing could be collected", () => {
    // An install with no git, or a failed fetch, must not produce a
    // body full of "undefined".
    const body = friendlyError(REDACTED, "page-error-boundary").githubIssue?.body ?? "";
    expect(body).not.toContain("undefined");
    expect(body).toContain("unknown");
    expect(body).toContain("Error message");
  });
});

describe("resolving a digest to the real error", () => {
  const REDACTED_MSG =
    "An error occurred in the Server Components render. The specific message is omitted.";

  it("leads with the real message when it was found", () => {
    const body =
      friendlyError(REDACTED_MSG, "page-error-boundary", undefined, {
        digest: "2102528023",
        realMessage: "TypeError: Cannot read properties of null (reading 'id')",
        realStack: "    at getClient (src/lib/clients.ts:42:10)",
      }).githubIssue?.body ?? "";

    // Issue #36 arrived with a correct digest and no message, which is
    // a report nobody can act on even though the answer was sitting in
    // the reporter's own database.
    expect(body).toContain("The actual server error");
    expect(body).toContain("Cannot read properties of null");
    expect(body).toContain("getClient");
    expect(body).toContain("2102528023");
  });

  it("says the row is gone rather than implying nothing happened", () => {
    const body =
      friendlyError(REDACTED_MSG, "page-error-boundary", undefined, {
        digest: "999999",
      }).githubIssue?.body ?? "";
    expect(body).toContain("999999");
    expect(body).toMatch(/no matching row|restarted/i);
    expect(body).not.toContain("The actual server error");
  });
});
