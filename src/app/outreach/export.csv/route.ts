import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, outreachContacts } from "@/db/schema";
import { csvResponse } from "@/lib/csv-export";
import { exportScope } from "@/lib/client-scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scope = await exportScope(outreachContacts.clientId, req);
  const rows = await db
    .select({
      id: outreachContacts.id,
      name: outreachContacts.name,
      email: outreachContacts.email,
      website: outreachContacts.website,
      status: outreachContacts.status,
      notes: outreachContacts.notes,
      lastContactedAt: outreachContacts.lastContactedAt,
      createdAt: outreachContacts.createdAt,
      clientName: clients.name,
      clientUrl: clients.url,
    })
    .from(outreachContacts)
    .leftJoin(clients, eq(outreachContacts.clientId, clients.id))
    .where(scope)
    .orderBy(desc(outreachContacts.createdAt));

  return csvResponse(
    "outreach.csv",
    [
      "id",
      "client",
      "client_url",
      "name",
      "email",
      "website",
      "status",
      "notes",
      "last_contacted_at",
      "created_at",
    ],
    rows.map((r) => [
      r.id,
      r.clientName,
      r.clientUrl,
      r.name,
      r.email,
      r.website,
      r.status,
      r.notes,
      r.lastContactedAt,
      r.createdAt,
    ]),
  );
}
