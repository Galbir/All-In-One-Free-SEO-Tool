/**
 * The Playwright version is written in two places that must agree, and
 * they drifted.
 *
 * `package.json` pins the `playwright` package; the Dockerfile builds on
 * `mcr.microsoft.com/playwright:vX-noble`, which carries the browser
 * build for exactly that release. Playwright resolves its browsers
 * through a revision directory named after the version it was compiled
 * against, so when the two disagree Chromium is sitting in the image and
 * Playwright cannot see it.
 *
 * The failure says "the headless browser isn't installed", which sounds
 * like a missing download rather than a version mismatch, and no amount
 * of running `playwright install` in the container fixes it past the next
 * recreate. It is a lie-shaped bug: a confident, specific, wrong
 * diagnosis.
 *
 * Measured in issue #47: the image sat at v1.56.0 while package.json had
 * moved to 1.59.1, so rank checks, SERP scraping and screenshots were
 * broken on every Docker install — reported by a user whose stack trace
 * showed `/app` paths and `@playwright/test@1.59.1` side by side.
 *
 * This is the project's fourth standing rule exactly: never a second
 * hardcoded copy of something that already exists. The Dockerfile cannot
 * read package.json — `FROM` is resolved before any build context — so
 * the copy has to stay. This test is what keeps it honest.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function playwrightVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const spec =
    pkg.dependencies?.playwright ?? pkg.devDependencies?.playwright ?? "";
  // Exact pins only. A range would make "which browser build" unanswerable
  // at image-build time, which is the whole problem this guards.
  expect(spec, "package.json does not pin `playwright`").toMatch(
    /^\d+\.\d+\.\d+$/,
  );
  return spec;
}

function dockerfileImageTags(): string[] {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  return [
    ...dockerfile.matchAll(
      /^FROM\s+mcr\.microsoft\.com\/playwright:v([\d.]+)-\w+/gm,
    ),
  ].map((m) => m[1]);
}

describe("the Docker image ships the browsers this Playwright expects", () => {
  it("the Dockerfile builds on Playwright's image", () => {
    // Guards the guard: a Dockerfile that stopped using the Playwright
    // image would make every assertion below pass for the wrong reason.
    const tags = dockerfileImageTags();
    expect(
      tags.length,
      "no `FROM mcr.microsoft.com/playwright:v...` lines found — if the base " +
        "image changed, this test needs rewriting rather than deleting",
    ).toBeGreaterThan(0);
  });

  it("every stage names the same version as package.json", () => {
    const expected = playwrightVersion();
    const wrong = dockerfileImageTags().filter((t) => t !== expected);
    expect(
      wrong,
      `package.json pins playwright ${expected} but the Dockerfile builds on ` +
        `${wrong.join(", ")}. The image carries the browsers for its own ` +
        `release, so Chromium will be present and invisible, and the app will ` +
        `report "the headless browser isn't installed" on every Docker install.`,
    ).toEqual([]);
  });

  it("all stages agree with each other", () => {
    // A multi-stage build whose deps and runner stages differ installs
    // against one browser set and runs against another.
    expect(new Set(dockerfileImageTags()).size).toBe(1);
  });

  it("@playwright/test, when present, matches too", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const test =
      pkg.devDependencies?.["@playwright/test"] ??
      pkg.dependencies?.["@playwright/test"];
    if (!test) return;
    expect(
      test,
      "@playwright/test and playwright must be the same version — they share " +
        "the browser registry",
    ).toBe(playwrightVersion());
  });
});
