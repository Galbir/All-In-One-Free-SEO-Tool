/**
 * Every relative link in a published markdown file must resolve.
 *
 * The regression this exists for: the README's top navigation linked
 * `TROUBLESHOOTING.md` and `ROADMAP.md` at the repository root while both
 * files live in `docs/`. Measured on GitHub — `/blob/main/TROUBLESHOOTING.md`
 * returned 404 — so the one link a stuck user clicks from the front page
 * went nowhere, and had done for as long as the files had been in `docs/`.
 *
 * Nobody files a bug for a broken link in a README; they just leave. And
 * it is exactly the kind of breakage that a file move causes silently,
 * which is why it belongs in the build rather than in a review checklist.
 *
 * This also covers the opposite direction: a markdown file that is itself
 * no longer published, but is still linked from one that is.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function trackedMarkdown(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

/** Tracked files, as a set, so a link to an untracked file is a failure. */
function trackedFiles(): Set<string> {
  return new Set(
    execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean),
  );
}

/**
 * Markdown inline links, minus the ones that do not point at a file in
 * this repository: absolute URLs, mail and other schemes, and pure
 * fragments.
 */
function relativeLinks(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // http:, mailto:, etc.
    if (href.startsWith("#")) continue;
    if (href.startsWith("//")) continue;
    out.push(href);
  }
  return out;
}

describe("published markdown", () => {
  it("has files to check", () => {
    // Guards the guard: a glob that matched nothing would make every
    // assertion below pass for the wrong reason.
    expect(trackedMarkdown().length).toBeGreaterThan(10);
  });

  it("every relative link points at a file that exists on disk", async () => {
    const broken: string[] = [];

    for (const file of trackedMarkdown()) {
      const body = await readFile(join(ROOT, file), "utf8");
      for (const href of relativeLinks(body)) {
        const target = href.split("#")[0];
        if (!target) continue;
        const abs = resolve(ROOT, dirname(file), target);
        if (!existsSync(abs)) broken.push(`${file} -> ${href}`);
      }
    }

    expect(broken).toEqual([]);
  });

  it("the README pins no release version", async () => {
    // The download block used to read "Download v0.6.2" and link
    // .../releases/download/v0.6.2/seo-tool-v0.6.2.zip — the version
    // written into the link text and the asset path, making the README a
    // second place the version lives. It drifted in exactly one release:
    // v0.6.3 shipped and the front page still offered v0.6.2.
    //
    // /releases/latest shows the notes and the single zip asset, so there
    // is no reason for a version to appear here at all. Release notes
    // under docs/releases/ are exempt — a version is the whole point of
    // those.
    const body = await readFile(join(ROOT, "README.md"), "utf8");
    const pinned = [...body.matchAll(/releases\/(?:download|tag)\/(v?\d+\.\d+\.\d+)/g)].map(
      (m) => m[0],
    );
    expect(pinned).toEqual([]);
  });

  it("every relative link points at a file that is also published", async () => {
    // A link can resolve on the maintainer's disk and 404 for everyone
    // else, which is what happens the moment a linked file is untracked.
    const tracked = trackedFiles();
    const unpublished: string[] = [];

    for (const file of trackedMarkdown()) {
      const body = await readFile(join(ROOT, file), "utf8");
      for (const href of relativeLinks(body)) {
        const target = href.split("#")[0];
        if (!target) continue;
        // Normalise to a repo-relative posix path, the way git lists them.
        const repoPath = posix.normalize(posix.join(posix.dirname(file), target));
        if (repoPath.startsWith("..")) continue;
        const isDir = existsSync(resolve(ROOT, repoPath)) && !tracked.has(repoPath);
        if (!tracked.has(repoPath) && !isDir) unpublished.push(`${file} -> ${href}`);
      }
    }

    expect(unpublished).toEqual([]);
  });
});
