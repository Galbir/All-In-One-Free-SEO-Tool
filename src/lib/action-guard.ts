/**
 * Who may run a server action.
 *
 * Team roles were enforced by the pages and almost nowhere else. A page's
 * `layout.tsx` calls `assertClientAccess()`, which hides the screen — but
 * a server action is a POST that anyone signed in can send with any
 * arguments. So the role descriptions ("Client viewer: read-only",
 * "Manager: can't change integration keys", "Member: only assigned
 * clients") held in the UI and not on the server: a viewer could delete
 * clients, a manager could replace API keys, a member could act on any
 * client id.
 *
 * Every exported server action now starts with `await guardAction(...)`,
 * and `action-guard.test.ts` fails the build if one doesn't.
 *
 * What it checks, in accounts mode only (solo and shared-password installs
 * have one anonymous user, so there is nothing to tell apart):
 *
 *   "read"     signed in; the client, if given, is one they may see
 *   "personal" signed in (theme, notification read-marks, feedback)
 *   "edit"     + not a viewer
 *   "settings" + owner (keys, integrations, team, deleting clients)
 *
 * Two kinds of call pass straight through, because they are not a person
 * invoking an action:
 *
 *   - no request at all — the background scheduler calls some of these
 *     functions directly (rank checks, page monitoring);
 *   - a request that is not a server-action POST — a server component
 *     calling the same function while rendering a page the layout has
 *     already authorised. This mirrors Next's own test for "is this a
 *     server action" (`getServerActionRequestMetadata`): the Next-Action
 *     header, or a POST with a form content type. A request without
 *     those cannot invoke an action at all, so it cannot skip the guard.
 */

import { headers } from "next/headers";

export type ActionNeed = "read" | "personal" | "edit" | "settings";

export class ActionForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionForbiddenError";
  }
}

function isServerActionRequest(h: Headers): boolean {
  if (h.get("next-action")) return true;
  const ct = h.get("content-type") ?? "";
  return (
    ct.startsWith("multipart/form-data") ||
    ct.startsWith("application/x-www-form-urlencoded")
  );
}

function toClientId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (raw instanceof File) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function guardAction(
  need: ActionNeed = "edit",
  clientIdRaw?: unknown,
): Promise<void> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    return; // background job — no request scope
  }
  if (!isServerActionRequest(h)) return;

  const { accountsEnabled, currentUser, canEdit, canManageSettings, canSeeClient } =
    await import("./auth");
  if (!accountsEnabled()) return;

  const me = await currentUser();
  if (!me) throw new ActionForbiddenError("Sign in first.");

  if (need === "settings" && !canManageSettings(me.role)) {
    throw new ActionForbiddenError("Only the workspace owner can change this.");
  }
  if ((need === "edit" || need === "settings") && !canEdit(me.role)) {
    throw new ActionForbiddenError("You have read-only access.");
  }

  const clientId = toClientId(clientIdRaw);
  if (clientId !== null && !(await canSeeClient(me, clientId))) {
    // Same wording as a missing client: don't confirm that it exists.
    throw new ActionForbiddenError("Client not found.");
  }
}
