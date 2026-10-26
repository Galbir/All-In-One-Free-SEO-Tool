/**
 * Works through a client's open tasks one after another, highest priority
 * first, each in its own Claude conversation.
 *
 * Nothing is closed when a task finishes: its chat stays on the task's
 * page with everything Claude did, and the next task gets a chat of its
 * own. A task is tried once per run, so one that Claude does not mark done
 * cannot loop forever. Three failures in a row (Claude missing, signed
 * out, no network) stop the run instead of burning through the list.
 *
 * The queue lives in memory. A restart ends the run; the finished tasks
 * keep their status and their chats, and starting it again picks up the
 * tasks that are still open.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { tasks } from "@/db/schema";
import { firstPrompt, resolveTaskFolder } from "./folder";
import { setTurnEndHook, startTurn, stopTurn, type TurnEnd } from "./runner";

export type QueueState = {
  clientId: number;
  /** Set when the run is limited to chosen tasks (autopilot). */
  only?: number[];
  active: boolean;
  startedAt: number;
  /** Open tasks when the run began, for "3 of 12". */
  total: number;
  current: number | null;
  attempted: number[];
  failed: number[];
  note: string | null;
};

type Store = { queues: Map<number, QueueState> };
const g = globalThis as unknown as { __taskQueue?: Store };
const store: Store = (g.__taskQueue ??= { queues: new Map() });

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const MAX_FAILURES_IN_A_ROW = 3;

export function queueFor(clientId: number): QueueState | null {
  return store.queues.get(clientId) ?? null;
}

async function openTasks(clientId: number, only?: number[]) {
  const rows = (
    await db
      .select({ id: tasks.id, priority: tasks.priority, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(eq(tasks.clientId, clientId), inArray(tasks.status, ["todo", "in_progress"])))
  ).filter((t) => !only || only.includes(t.id));
  return rows.sort(
    (a, b) =>
      (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
      (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) ||
      a.id - b.id,
  );
}

async function advance(q: QueueState) {
  if (!q.active) return;
  const next = (await openTasks(q.clientId, q.only)).find((t) => !q.attempted.includes(t.id));
  if (!next) {
    q.active = false;
    q.current = null;
    q.note = "All open tasks were worked through.";
    return;
  }
  const folder = await resolveTaskFolder(next.id);
  if (!folder.ok) {
    q.active = false;
    q.current = null;
    q.note = folder.error;
    return;
  }
  q.attempted.push(next.id);
  q.current = next.id;
  const started = startTurn(next.id, folder.dir, firstPrompt(next.id), folder.workflow);
  if (!started.ok) {
    q.failed.push(next.id);
    q.current = null;
    // Something else is running on that task; do not wait on it.
    await advance(q);
  }
}

function owner(taskId: number): QueueState | undefined {
  for (const q of store.queues.values()) if (q.active && q.current === taskId) return q;
  return undefined;
}

setTurnEndHook((taskId: number, how: TurnEnd) => {
  const q = owner(taskId);
  if (!q) return;
  q.current = null;
  if (how === "stopped") {
    q.active = false;
    q.note = "Stopped.";
    return;
  }
  if (how === "error") {
    q.failed.push(taskId);
    const tail = q.attempted.slice(-MAX_FAILURES_IN_A_ROW);
    if (tail.length === MAX_FAILURES_IN_A_ROW && tail.every((id) => q.failed.includes(id))) {
      q.active = false;
      q.note = "Stopped after three failures in a row. Open the last chat to see why.";
      return;
    }
  }
  void advance(q);
});

/**
 * `only` limits the run to those tasks (the autopilot hands over just the
 * ones it chose); without it every open task of the client is worked.
 * `first` is the task the run opens with, for the caller to show.
 */
export async function startQueue(
  clientId: number,
  only?: number[],
): Promise<{ ok: true; first: number | null } | { ok: false; error: string }> {
  const existing = store.queues.get(clientId);
  if (existing?.active) return { ok: false, error: "The queue is already running." };
  const open = await openTasks(clientId, only);
  if (open.length === 0) return { ok: false, error: "This client has no open tasks." };
  const folder = await resolveTaskFolder(open[0].id);
  if (!folder.ok) return { ok: false, error: folder.error };

  const q: QueueState = {
    clientId,
    only,
    active: true,
    startedAt: Date.now(),
    total: open.length,
    current: null,
    attempted: [],
    failed: [],
    note: null,
  };
  store.queues.set(clientId, q);
  await advance(q);
  return { ok: true, first: q.current };
}

export function stopQueue(clientId: number): boolean {
  const q = store.queues.get(clientId);
  if (!q?.active) return false;
  q.active = false;
  q.note = "Stopped.";
  if (q.current !== null) stopTurn(q.current);
  q.current = null;
  return true;
}

/**
 * "Continue with next", from the chat of a task that is done (or stopped):
 * Claude goes on with the client's other open tasks, in priority order.
 *
 * If a run is already going, nothing new is started and the task it is on
 * is returned, so the caller just opens that one. If an earlier run was
 * limited to chosen tasks (autopilot), the rest of those come first.
 */
export async function continueWithNext(
  taskId: number,
): Promise<{ ok: true; next: number | null } | { ok: false; error: string }> {
  const [task] = await db
    .select({ clientId: tasks.clientId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return { ok: false, error: "Task not found." };

  const existing = store.queues.get(task.clientId);
  if (existing?.active) {
    return existing.current !== null && existing.current !== taskId
      ? { ok: true, next: existing.current }
      : { ok: false, error: "The queue is already running." };
  }

  const skip = new Set([taskId, ...(existing?.attempted ?? [])]);
  let rest = (await openTasks(task.clientId, existing?.only)).filter((t) => !skip.has(t.id));
  if (rest.length === 0 && existing?.only) {
    // The chosen tasks are used up; carry on with whatever else is open.
    rest = (await openTasks(task.clientId)).filter((t) => t.id !== taskId);
  }
  if (rest.length === 0) return { ok: false, error: "No more open tasks for this client." };

  const started = await startQueue(
    task.clientId,
    rest.map((t) => t.id),
  );
  return started.ok ? { ok: true, next: started.first } : started;
}
