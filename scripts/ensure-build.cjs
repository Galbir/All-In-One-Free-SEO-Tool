// Make sure the production build matches the code on disk before
// `next start` serves it. Runs from `start:daily`, after migrate.cjs.
//
// Why this exists: no update path ever rebuilt. The launcher's Update
// button (bin/seo-update.cjs) and Settings → Update (/api/update) pull
// the new code, install and migrate — and the launchers then see
// .next/BUILD_ID, choose production mode, and serve the OLD bundle. The
// update appeared to work and changed nothing until someone deleted
// .next by hand. Replacing the folder with a newer zip while keeping
// .next did the same.
//
// So the build is stamped with the package version it was made from, and
// a mismatch triggers a rebuild here.
//
//   node scripts/ensure-build.cjs          check, rebuild if stale
//   node scripts/ensure-build.cjs --stamp  record the current version
//                                          (run after `next build`)
//   node scripts/ensure-build.cjs --cleanup  only the stale-file cleanup
//                                          (run before build and dev)
//
// Also removes src/middleware.ts left behind next to src/proxy.ts by an
// over-the-top update: v0.7.0 renamed the file, and Next refuses to build
// with both present.
//
// CJS and dependency-free for the same reason as migrate.cjs: it runs in
// the minimal runtime image and before any TS tooling.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const NEXT_DIR = path.join(ROOT, ".next");
const STAMP = path.join(NEXT_DIR, "SEO_TOOL_VERSION");

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

function removeStaleMiddleware() {
  const proxy = path.join(ROOT, "src", "proxy.ts");
  const middleware = path.join(ROOT, "src", "middleware.ts");
  if (!fs.existsSync(proxy) || !fs.existsSync(middleware)) return;
  // Only our own old auth gate — never a file someone wrote themselves.
  const text = fs.readFileSync(middleware, "utf8");
  if (!text.includes("stb_auth") || !text.includes("PUBLIC_PATHS")) {
    console.warn(
      "[ensure-build] src/middleware.ts and src/proxy.ts both exist; Next will refuse to build. Remove one.",
    );
    return;
  }
  fs.unlinkSync(middleware);
  console.log("[ensure-build] Removed src/middleware.ts (renamed to src/proxy.ts in v0.7.0).");
}

function stamp() {
  const v = version();
  if (!v || !fs.existsSync(NEXT_DIR)) return;
  fs.writeFileSync(STAMP, v);
}

function main() {
  removeStaleMiddleware();

  if (process.argv.includes("--cleanup")) return;
  if (process.argv.includes("--stamp")) {
    stamp();
    return;
  }

  // No build at all: the launchers decide between dev and a first build.
  if (!fs.existsSync(path.join(NEXT_DIR, "BUILD_ID"))) return;
  if (process.env.SEO_SKIP_BUILD_CHECK === "1") return;

  const want = version();
  const have = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, "utf8").trim() : null;
  if (!want || have === want) return;

  console.log(
    `[ensure-build] The production build is from ${have ? `v${have}` : "an earlier version"}; the code is v${want}. Rebuilding (1-2 minutes, once)...`,
  );
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const r = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status === 0) {
    stamp();
    console.log("[ensure-build] Rebuilt.");
  } else {
    // Keep serving the previous build rather than refusing to start —
    // an old version running beats nothing running. Say so plainly.
    console.error(
      "[ensure-build] Rebuild failed; starting the previous build. Run `pnpm build` to see why.",
    );
  }
}

try {
  main();
} catch (err) {
  console.error("[ensure-build]", err && err.message ? err.message : err);
}
