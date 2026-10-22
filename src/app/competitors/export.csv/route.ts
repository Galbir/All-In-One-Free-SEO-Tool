import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, competitors } from "@/db/schema";
import { csvResponse } from "@/lib/csv-export";
import { exportScope } from "@/lib/client-scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scope = await exportScope(competitors.clientId, req);
  const rows = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      url: competitors.url,
      notes: competitors.notes,
      createdAt: competitors.createdAt,
      clientName: clients.name,
      clientUrl: clients.url,
    })
    .from(competitors)
    .leftJoin(clients, eq(competitors.clientId, clients.id))
    .where(scope)
    .orderBy(desc(competitors.createdAt));

  return csvResponse(
    "competitors.csv",
    ["id", "client", "client_url", "name", "url", "notes", "created_at"],
    rows.map((r) => [
      r.id,
      r.clientName,
      r.clientUrl,
      r.name,
      r.url,
      r.notes,
      r.createdAt,
    ]),
  );
}
