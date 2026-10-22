import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every exported server action must start with `await guardAction(...)`.
 *
 * Roles were enforced by page layouts only, and a server action can be
 * POSTed directly with any arguments — so a "read-only" viewer could
 * delete clients and a manager could replace API keys. This test is what
 * stops the next action from being added without the check.
 */

// Deliberately public: they serve people who will never have an account.
const PUBLIC_ACTION_FILES = new Set([
  "src/app/embed/grader/actions.ts", // embeddable grader on the agency's site
  "src/app/portal/[token]/chat-actions.ts", // client portal, authorised by its share token
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const ROOT = process.cwd();
const serverActionFiles = walk(path.join(ROOT, "src"))
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
  .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
  .filter((f) => /^["']use server["'];?/m.test(readFileSync(f, "utf8")));

describe("server action guard coverage", () => {
  it("finds the server action files", () => {
    expect(serverActionFiles.length).toBeGreaterThan(100);
  });

  it("every exported server action starts with guardAction()", () => {
    const missing: string[] = [];
    for (const file of serverActionFiles) {
      if (PUBLIC_ACTION_FILES.has(file)) continue;
      const src = readFileSync(file, "utf8");
      const re = /^export async function\s+(\w+)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        // The guard must be the first statement of the body. Look at the
        // text between this export and the next one.
        const rest = src.slice(m.index);
        const next = rest.slice(1).search(/^export /m);
        const body = next === -1 ? rest : rest.slice(0, next + 1);
        const firstStatement = body
          .slice(body.indexOf("{", body.indexOf(")")))
          .match(/\{\s*([^\n]*)/);
        const guarded =
          /await guardAction\(/.test(firstStatement?.[1] ?? "") ||
          /\n  await guardAction\(/.test(body);
        if (!guarded) missing.push(`${file} → ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("only allows exports that can be guarded", () => {
    // `export const x = async () => …` would slip past the check above.
    const offenders = serverActionFiles.filter((f) =>
      /^export (const|let|default)\b/m.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The guard's decisions
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  headers: null as Headers | null,
  accounts: true,
  user: null as { id: number; role: string } | null,
  visible: new Set<number>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!state.headers) throw new Error("outside a request scope");
    return state.headers;
  },
}));

vi.mock("./auth", () => ({
  accountsEnabled: () => state.accounts,
  currentUser: async () => state.user,
  canEdit: (role: string) => role !== "viewer",
  canManageSettings: (role: string) => role === "owner",
  canSeeClient: async (user: { role: string }, id: number) =>
    user.role === "owner" || user.role === "manager" || state.visible.has(id),
}));

const { guardAction } = await import("./action-guard");

const actionRequest = () => new Headers({ "next-action": "abc123" });

describe("guardAction", () => {
  beforeEach(() => {
    state.headers = actionRequest();
    state.accounts = true;
    state.user = { id: 1, role: "owner" };
    state.visible = new Set();
  });

  it("lets background jobs through (no request scope)", async () => {
    state.headers = null;
    state.user = null;
    await expect(guardAction("settings")).resolves.toBeUndefined();
  });

  it("lets page renders through (not a server-action request)", async () => {
    state.headers = new Headers({ accept: "text/html" });
    state.user = { id: 2, role: "viewer" };
    await expect(guardAction("edit")).resolves.toBeUndefined();
  });

  it("treats a form POST as an action even without the header", async () => {
    state.headers = new Headers({ "content-type": "multipart/form-data; boundary=x" });
    state.user = { id: 2, role: "viewer" };
    await expect(guardAction("edit")).rejects.toThrow(/read-only/);
  });

  it("is a no-op on installs without accounts", async () => {
    state.accounts = false;
    state.user = null;
    await expect(guardAction("settings")).resolves.toBeUndefined();
  });

  it("requires a signed-in user", async () => {
    state.user = null;
    await expect(guardAction("read")).rejects.toThrow(/Sign in/);
  });

  it("keeps viewers read-only", async () => {
    state.user = { id: 2, role: "viewer" };
    state.visible.add(5);
    await expect(guardAction("read", 5)).resolves.toBeUndefined();
    await expect(guardAction("edit", 5)).rejects.toThrow(/read-only/);
  });

  it("keeps settings owner-only", async () => {
    state.user = { id: 3, role: "manager" };
    await expect(guardAction("edit", 9)).resolves.toBeUndefined();
    await expect(guardAction("settings")).rejects.toThrow(/owner/);
  });

  it("keeps members to their assigned clients", async () => {
    state.user = { id: 4, role: "member" };
    state.visible.add(7);
    await expect(guardAction("edit", 7)).resolves.toBeUndefined();
    await expect(guardAction("edit", "7")).resolves.toBeUndefined();
    await expect(guardAction("edit", 8)).rejects.toThrow(/not found/);
    // A missing or non-numeric client id is not a client restriction.
    await expect(guardAction("edit", null)).resolves.toBeUndefined();
  });
});
