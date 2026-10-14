/**
 * The facts a bug report needs, gathered by the machine that has them.
 *
 * The error page used to pre-fill a GitHub issue containing this:
 *
 *     - App version: (run `git rev-parse --short HEAD` in the repo)
 *     - OS: (Windows / macOS / Linux + version)
 *     - Node: (run `node -v`)
 *
 * Issue #31 was submitted with every one of those left exactly as
 * written. That is the only reasonable outcome: somebody whose app just
 * broke is not going to open a terminal and run git commands to help us.
 * Asking produced a report with no version, no platform and no runtime —
 * nothing that could be acted on.
 *
 * The server knows all three without asking anyone. The browser supplies
 * its own user agent client-side.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const exec = promisify(execFile);

async function gitCommit(): Promise<string | null> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "--short", "HEAD"], {
      cwd: process.cwd(),
      timeout: 2000,
    });
    return stdout.trim() || null;
  } catch {
    // A zip install has no .git, which is normal and not worth an error.
    return null;
  }
}

function packageVersion(): string | null {
  try {
    return (
      JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
        .version ?? null
    );
  } catch {
    return null;
  }
}

export async function GET() {
  const [commit] = await Promise.all([gitCommit()]);

  return Response.json({
    version: packageVersion(),
    commit,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    // Whether this is a built production server or a dev one changes
    // which errors are even possible, and is the first thing to ask.
    mode: process.env.NODE_ENV ?? "unknown",
  });
}
