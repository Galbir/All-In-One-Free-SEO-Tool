"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { clients, tasks } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { currentUserId } from "@/lib/auth";

type Recur = "daily" | "weekly" | "monthly" | "quarterly";

function nextDueDate(prev: Date | null, interval: Recur): Date {
  const base = prev ?? new Date();
  const next = new Date(base.getTime());
  if (interval === "daily") next.setDate(next.getDate() + 1);
  else if (interval === "weekly") next.setDate(next.getDate() + 7);
  else if (interval === "monthly") next.setMonth(next.getMonth() + 1);
  else if (interval === "quarterly") next.setMonth(next.getMonth() + 3);
  return next;
}

type TaskRow = typeof tasks.$inferSelect;

/**
 * Change one task's status, with everything that goes with it: who
 * completed it, the activity entry, and the next instance of a recurring
 * task. Shared by the single and bulk paths — bulk "mark done" used to
 * skip both the activity log and recurrence.
 */
async function applyTaskStatus(
  existing: TaskRow,
  status: "todo" | "in_progress" | "done" | "skipped",
  completedByUserId: number | null,
): Promise<void> {
  // Record who finished it. Cleared when a task is reopened, so the
  // column always means "who completed the state it's in now" rather
  // than "who touched it once" — /capacity and the monthly report both
  // read it as the former.
  await db
    .update(tasks)
    .set({
      status,
      completedByUserId: status === "done" ? completedByUserId : null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, existing.id));

  if (status !== "done" || existing.status === "done") return;

  await logActivity({
    kind: "task.completed",
    message: `Completed task: ${existing.title}`,
    level: "success",
    clientId: existing.clientId,
    entityType: "task",
    entityId: existing.id,
  });

  if (!existing.recurringInterval) return;

  // Done → reopened → done again used to clone a second next instance
  // each time (easy on the Kanban board). If an open instance of this
  // recurring task already exists, that is the next one.
  const [openInstance] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.clientId, existing.clientId),
        eq(tasks.title, existing.title),
        eq(tasks.recurringInterval, existing.recurringInterval),
        inArray(tasks.status, ["todo", "in_progress"]),
        ne(tasks.id, existing.id),
      ),
    )
    .limit(1);
  if (openInstance) return;

  await db.insert(tasks).values({
    clientId: existing.clientId,
    title: existing.title,
    description: existing.description,
    whyItMatters: existing.whyItMatters,
    // These were dropped, so recurring work lost its owner, its estimate
    // and its link to the tool that does it.
    toolPath: existing.toolPath,
    priority: existing.priority,
    status: "todo",
    dueDate: nextDueDate(
      existing.dueDate,
      existing.recurringInterval as Recur,
    ),
    recurringInterval: existing.recurringInterval,
    estimatedMinutes: existing.estimatedMinutes,
    assignedUserId: existing.assignedUserId,
    source: existing.source,
    sourceRef: existing.sourceRef,
  });
}

export async function setTaskStatus(
  taskId: number,
  status: "todo" | "in_progress" | "done" | "skipped",
) {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;

  const [existing] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!existing) return;

  const completedByUserId =
    status === "done" ? await currentUserId() : null;
  await applyTaskStatus(existing, status, completedByUserId);

  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function deleteTask(taskId: number) {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;
  await db.delete(tasks).where(eq(tasks.id, taskId));
  revalidatePath("/tasks");
  revalidatePath("/");
}

const newTaskSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  title: z.string().trim().min(2).max(200),
  whyItMatters: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  dueInDays: z.coerce.number().int().min(0).max(365).optional(),
  recurringInterval: z
    .enum(["daily", "weekly", "monthly", "quarterly"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CreateTaskResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

export async function createTask(
  _prev: CreateTaskResult | null,
  formData: FormData,
): Promise<CreateTaskResult> {
  await guardAction("edit", formData.get("clientId"));
  const raw = {
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    whyItMatters: formData.get("whyItMatters") ?? undefined,
    priority: formData.get("priority") ?? "medium",
    dueInDays: formData.get("dueInDays") ?? undefined,
    recurringInterval:
      formData.get("recurringInterval") === ""
        ? undefined
        : (formData.get("recurringInterval") ?? undefined),
  };
  const parsed = newTaskSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.data.clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found." };

  const dueDate =
    typeof parsed.data.dueInDays === "number"
      ? new Date(Date.now() + parsed.data.dueInDays * 86_400_000)
      : null;

  const [row] = await db
    .insert(tasks)
    .values({
      clientId: parsed.data.clientId,
      title: parsed.data.title,
      whyItMatters: parsed.data.whyItMatters,
      priority: parsed.data.priority,
      status: "todo",
      dueDate,
      recurringInterval: parsed.data.recurringInterval,
    })
    .returning({ id: tasks.id });

  await logActivity({
    kind: "task.created",
    message: `New task: ${parsed.data.title}`,
    clientId: parsed.data.clientId,
    entityType: "task",
    entityId: row.id,
  });

  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true, id: row.id };
}

export async function setTaskRecurrence(
  taskId: number,
  recurringInterval:
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | null,
) {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;
  await db
    .update(tasks)
    .set({ recurringInterval, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  revalidatePath("/tasks");
}

export async function logTaskTime(input: {
  taskId: number;
  /** Minutes to add. Negative subtracts. */
  minutes: number;
}): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  await guardAction("edit");
  if (!Number.isFinite(input.taskId) || input.taskId <= 0) {
    return { ok: false, error: "Invalid task" };
  }
  if (!Number.isFinite(input.minutes) || input.minutes === 0) {
    return { ok: false, error: "Enter minutes" };
  }
  const [t] = await db
    .select({ id: tasks.id, actualMinutes: tasks.actualMinutes })
    .from(tasks)
    .where(eq(tasks.id, input.taskId))
    .limit(1);
  if (!t) return { ok: false, error: "Task not found" };
  const newTotal = Math.max(0, (t.actualMinutes ?? 0) + Math.round(input.minutes));
  await db
    .update(tasks)
    .set({ actualMinutes: newTotal, updatedAt: new Date() })
    .where(eq(tasks.id, input.taskId));
  revalidatePath("/tasks");
  revalidatePath("/capacity");
  return { ok: true, total: newTotal };
}

export async function setTaskEstimate(
  taskId: number,
  estimatedMinutes: number | null,
): Promise<void> {
  await guardAction("edit");
  if (!Number.isFinite(taskId) || taskId <= 0) return;
  const v =
    estimatedMinutes === null || !Number.isFinite(estimatedMinutes)
      ? null
      : Math.max(0, Math.round(estimatedMinutes));
  await db
    .update(tasks)
    .set({ estimatedMinutes: v, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));
  revalidatePath("/tasks");
  revalidatePath("/capacity");
}

// Bulk operations

function validIds(ids: number[]): number[] {
  return ids.filter((id) => Number.isFinite(id) && id > 0);
}

export async function bulkSetTaskStatus(
  ids: number[],
  status: "todo" | "in_progress" | "done" | "skipped",
) {
  await guardAction("edit");
  const valid = validIds(ids);
  if (valid.length === 0) return;
  const completedByUserId =
    status === "done" ? await currentUserId() : null;
  const rows = await db.select().from(tasks).where(inArray(tasks.id, valid));
  for (const row of rows) {
    await applyTaskStatus(row, status, completedByUserId);
  }
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function bulkSetTaskPriority(
  ids: number[],
  priority: "high" | "medium" | "low",
) {
  await guardAction("edit");
  const valid = validIds(ids);
  if (valid.length === 0) return;
  await db
    .update(tasks)
    .set({ priority, updatedAt: new Date() })
    .where(inArray(tasks.id, valid));
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function bulkDeleteTasks(ids: number[]) {
  await guardAction("edit");
  const valid = validIds(ids);
  if (valid.length === 0) return;
  await db.delete(tasks).where(inArray(tasks.id, valid));
  revalidatePath("/tasks");
  revalidatePath("/");
}

import { getPlaybook } from "@/lib/niche-templates";
import { guardAction } from "@/lib/action-guard";

export async function applyPlaybookToClient(input: {
  playbookId: string;
  clientId: number;
}): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  await guardAction("edit", input?.clientId);
  if (!Number.isFinite(input.clientId) || input.clientId <= 0) {
    return { ok: false, error: "Invalid client" };
  }
  const pb = getPlaybook(input.playbookId);
  if (!pb) return { ok: false, error: "Unknown playbook" };

  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, input.clientId))
    .limit(1);
  if (!client) return { ok: false, error: "Client not found" };

  const now = Date.now();
  const rows = pb.tasks.map((t) => ({
    clientId: input.clientId,
    title: t.title,
    description: t.description,
    whyItMatters: t.whyItMatters,
    priority: t.priority,
    status: "todo" as const,
    dueDate:
      typeof t.offsetDays === "number"
        ? new Date(now + t.offsetDays * 86_400_000)
        : null,
  }));

  await db.insert(tasks).values(rows);
  revalidatePath("/tasks");
  revalidatePath("/");
  return { ok: true, created: rows.length };
}
