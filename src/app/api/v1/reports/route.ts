import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { reportArchives, clients } from "@/db/schema";
import {
  authenticateRequest,
  jsonError,
  parseLimit,
  jsonOk,
  requireScope,
} from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const key = await authenticateRequest(req);
  if (!key) return jsonError(401, "Unauthorized");
  if (!requireScope(key, "read")) return jsonError(403, "Read scope required.");

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const limit = parseLimit(url.searchParams.get("limit"), 50, 200);
  const cid = clientId ? Number(clientId) : null;

  const q = db
    .select({
      id: reportArchives.id,
      clientId: reportArchives.clientId,
      clientName: clients.name,
      title: reportArchives.title,
      periodStart: reportArchives.periodStart,
      periodEnd: reportArchives.periodEnd,
      template: reportArchives.template,
      execSummary: reportArchives.execSummary,
      pdfBytes: reportArchives.pdfBytes,
      pinned: reportArchives.pinned,
      createdAt: reportArchives.createdAt,
    })
    .from(reportArchives)
    .leftJoin(clients, eq(reportArchives.clientId, clients.id))
    .orderBy(desc(reportArchives.createdAt))
    .limit(limit);

  const rows = cid ? await q.where(eq(reportArchives.clientId, cid)) : await q;

  return jsonOk({ reports: rows, count: rows.length });
}
