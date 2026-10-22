/**
 * Restore endpoint. POST receives a .db file (multipart/form-data) and
 * REPLACES the running data.db with it.
 *
 * Safety:
 *   - Backs up the current data.db to data.db.bak-<timestamp> first
 *   - Validates the upload is a valid SQLite file by checking the
 *     16-byte SQLite header magic
 *   - Refuses to restore if uploaded size > 500 MB (sanity cap)
 *
 * After restore, the server has to be restarted to release the SQLite
 * handle and open the new file. Response includes that instruction.
 */

import { writeFileSync, copyFileSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { guardAdminRequest } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 500 * 1024 * 1024;
const SQLITE_HEADER = "SQLite format 3\0";

function dbPath(): string {
  return process.env.SEO_DB_PATH ?? path.join(process.cwd(), "data.db");
}

export async function POST(req: Request) {
  const denied = await guardAdminRequest(req);
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Couldn't read upload. Send as multipart/form-data with field 'file'." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { ok: false, error: "Missing 'file' field." },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      {
        ok: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.`,
      },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // Validate SQLite header
  const header = buf.subarray(0, 16).toString("utf-8");
  if (header !== SQLITE_HEADER) {
    return Response.json(
      {
        ok: false,
        error:
          "That doesn't look like a SQLite database file. Pick the data.db (or seo-tool-backup-*.db) you downloaded via Backup.",
      },
      { status: 400 },
    );
  }

  const p = dbPath();

  // Back up existing db
  if (existsSync(p)) {
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace(/T/, "_")
      .slice(0, 19);
    const backupPath = `${p}.bak-${stamp}`;
    try {
      copyFileSync(p, backupPath);
    } catch (err) {
      return Response.json(
        {
          ok: false,
          error: `Couldn't back up current data.db before restore: ${(err as Error).message}`,
        },
        { status: 500 },
      );
    }
  }

  try {
    writeFileSync(p, buf);
  } catch (err) {
    return Response.json(
      { ok: false, error: `Couldn't write the new data.db: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  // Also handle the WAL + SHM sidecar files — the SQLite engine may have
  // left them; safer to remove them so the new DB opens fresh.
  for (const suffix of ["-shm", "-wal"]) {
    const side = p + suffix;
    if (existsSync(side)) {
      try {
        // Don't delete — just truncate so SQLite re-creates them cleanly
        writeFileSync(side, Buffer.alloc(0));
      } catch {
        // ignore — SQLite will fix on next open
      }
    }
  }

  const sizeMb = (statSync(p).size / 1024 / 1024).toFixed(2);

  return Response.json({
    ok: true,
    message: `Restored ${sizeMb} MB. Stop the dev server and re-run the installer to reload the new database.`,
    bytes: buf.length,
  });
}

// Self-verification helper — surfaces info about the current DB without
// returning the data itself. Used by the Settings UI to confirm the file
// exists before suggesting backup. Filesystem paths are NOT exposed to
// the client to avoid leaking install layout to remote callers.
export async function GET(req: Request) {
  const denied = await guardAdminRequest(req);
  if (denied) return denied;

  const p = dbPath();
  if (!existsSync(p)) {
    return Response.json({ ok: false, error: "data.db not found" });
  }
  const size = statSync(p).size;
  // Read header to verify it's actually SQLite
  const header = readFileSync(p, { encoding: null }).subarray(0, 16).toString("utf-8");
  return Response.json({
    ok: true,
    bytes: size,
    valid: header === SQLITE_HEADER,
  });
}
