import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, tasks } from "@/db/schema";
import { csvResponse } from "@/lib/csv-export";
import { exportScope } from "@/lib/client-scope";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const scope = await exportScope(tasks.clientId, req);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      whyItMatters: tasks.whyItMatters,
      priority: tasks.priority,
      status: tasks.status,
      dueDate: tasks.dueDate,
      recurringInterval: tasks.recurringInterval,
      estimatedMinutes: tasks.estimatedMinutes,
      actualMinutes: tasks.actualMinutes,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      clientName: clients.name,
      clientUrl: clients.url,
    })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(scope)
    .orderBy(desc(tasks.createdAt));

  return csvResponse(
    "tasks.csv",
    [
      "id",
      "client",
      "client_url",
      "title",
      "why_it_matters",
      "priority",
      "status",
      "due_date",
      "recurring",
      "estimated_minutes",
      "actual_minutes",
      "created_at",
      "updated_at",
    ],
    rows.map((r) => [
      r.id,
      r.clientName,
      r.clientUrl,
      r.title,
      r.whyItMatters,
      r.priority,
      r.status,
      r.dueDate,
      r.recurringInterval,
      r.estimatedMinutes,
      r.actualMinutes,
      r.createdAt,
      r.updatedAt,
    ]),
  );
}
