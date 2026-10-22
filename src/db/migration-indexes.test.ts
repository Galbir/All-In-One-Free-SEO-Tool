import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sqlite } from "./client";

/**
 * Every index a migration creates must exist after migrating.
 *
 * The indexes live only in the hand-written migration SQL, not in
 * schema.ts, so Drizzle does not know about them. A future generated
 * migration that rebuilds a table (SQLite's way of altering a column)
 * would drop that table's indexes without a word, and the symptom would
 * be a slow page months later. This test runs against the per-worker
 * database vitest.setup.ts migrates from these same files.
 */
const MIGRATIONS = path.join(process.cwd(), "src/db/migrations");

function indexesCreatedByMigrations(): string[] {
  const created = new Set<string>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi,
    )) {
      created.add(m[1]);
    }
    for (const m of sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi)) {
      created.delete(m[1]);
    }
  }
  return [...created].sort();
}

describe("migration indexes", () => {
  it("finds the indexes the migrations declare", () => {
    expect(indexesCreatedByMigrations().length).toBeGreaterThan(40);
  });

  it("all exist in a freshly migrated database", () => {
    const present = new Set(
      (
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
          .all() as { name: string }[]
      ).map((r) => r.name),
    );
    const missing = indexesCreatedByMigrations().filter((n) => !present.has(n));
    expect(missing).toEqual([]);
  });
});
