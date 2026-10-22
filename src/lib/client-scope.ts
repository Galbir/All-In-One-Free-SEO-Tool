/**
 * Client visibility for members and viewers.
 *
 * Two things have to be true for "this person only sees their clients"
 * to actually hold:
 *
 *   1. Lists must not show clients they can't open.
 *   2. Typing the URL of one directly must not work either.
 *
 * (1) is `clientScope()` — a filter callers apply to their own query.
 * (2) is `assertClientAccess()`, wired in via a `layout.tsx` on each
 * per-client route segment, so it runs before the page renders and
 * cannot be forgotten by whoever writes the next page under it.
 *
 * On a solo install both are no-ops: `currentUser()` returns null, the
 * scope is "everything", and nothing changes. Owners and managers get
 * the same treatment by role. Only members and viewers pay the cost of
 * the filter, which is also the only case where the extra table lookup
 * is doing any work.
 */

import { cache } from "react";
import { notFound } from "next/navigation";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { clients } from "@/db/schema";
import { currentUser, seesAllClients, visibleClientIds } from "./auth";

/**
 * `null` means unrestricted. Callers branch on that rather than being
 * handed a list of every id — an agency with 200 clients should not get
 * a 200-element IN clause on every page load to express "no limit".
 */
export const scopedClientIds = cache(async (): Promise<number[] | null> => {
  const me = await currentUser();
  if (!me) return null;
  if (seesAllClients(me.role)) return null;
  return visibleClientIds(me);
});

/**
 * A Drizzle condition to AND into a clients query, or undefined when the
 * caller should not filter at all.
 *
 * Usage:
 *   const scope = await clientScope();
 *   db.select().from(clients).where(scope)          // when that's the only filter
 *   db.select().from(clients).where(and(other, scope))  // and() drops undefined
 */
export async function clientScope(): Promise<SQL | undefined> {
  const ids = await scopedClientIds();
  if (ids === null) return undefined;
  // An empty assignment list means "no clients", not "all clients". The
  // difference is a member who has been given nothing yet seeing either
  // an empty page or the entire agency's book of business.
  if (ids.length === 0) return inArray(clients.id, [-1]);
  return inArray(clients.id, ids);
}

/**
 * Refuse the request if the signed-in user may not see this client.
 *
 * 404 rather than 403 on purpose: "you're not allowed to see client 12"
 * still confirms that client 12 exists. For an agency whose client list
 * is commercially sensitive, that is a real leak — a junior contractor
 * could enumerate ids and learn the whole roster.
 */
export async function assertClientAccess(clientId: number): Promise<void> {
  const ids = await scopedClientIds();
  if (ids === null) return;
  if (!ids.includes(clientId)) notFound();
}

/** Parses the `clientId` route param and asserts access in one step. */
export async function assertClientParam(raw: string | undefined): Promise<void> {
  const id = Number(raw);
  if (!Number.isInteger(id)) return; // let the page's own handling deal with it
  await assertClientAccess(id);
}

/**
 * The WHERE condition for a data export: the client the link asked for
 * (`?clientId=` — `?client=` is accepted too, for old bookmarks), AND
 * only clients the signed-in user may see.
 *
 * Exports were the one place neither rule was applied. The per-client
 * "Export keywords" and "Download disavow file" links sent a clientId the
 * routes never read, so each produced every client's data — and a member
 * could download the entire agency's book from any export URL.
 *
 * An unparseable clientId yields an empty export rather than everything.
 */
export async function exportScope(
  column: SQLiteColumn,
  req: Request,
): Promise<SQL | undefined> {
  const params = new URL(req.url).searchParams;
  const raw = params.get("clientId") ?? params.get("client");
  const conditions: SQL[] = [];
  if (raw !== null && raw !== "") {
    const id = Number(raw);
    conditions.push(
      Number.isInteger(id) && id > 0 ? eq(column, id) : inArray(column, [-1]),
    );
  }
  const ids = await scopedClientIds();
  if (ids !== null) {
    conditions.push(inArray(column, ids.length > 0 ? ids : [-1]));
  }
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

/**
 * Non-throwing form of `assertClientAccess`, for route handlers that
 * answer with their own 404 rather than Next's notFound() page.
 */
export async function canAccessClient(clientId: number): Promise<boolean> {
  const ids = await scopedClientIds();
  return ids === null || ids.includes(clientId);
}
