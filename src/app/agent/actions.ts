"use server";

import { eq } from "drizzle-orm";
import { safeRevalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/db/client";
import { aiSuggestions, tasks } from "@/db/schema";
import { runSeoAgent, type AgentRunResult } from "@/lib/seo-agent";
import {
  runAgentActions,
  type AgentRunReport,
} from "@/lib/seo-agent-runner";
import { guardAction } from "@/lib/action-guard";

export async function runAgent(clientId: number): Promise<AgentRunResult> {
  await guardAction("edit", clientId);
  const result = await runSeoAgent(clientId);
  safeRevalidatePath(`/agent/c/${clientId}`);
  return result;
}

export async function runAgentExecute(
  clientId: number,
): Promise<AgentRunReport> {
  await guardAction("edit", clientId);
  const report = await runAgentActions(clientId);
  safeRevalidatePath(`/agent/c/${clientId}`);
  safeRevalidatePath(`/clients/${clientId}`);
  safeRevalidatePath("/tasks");
  return report;
}

export async function applySuggestion(suggestionId: number) {
  await guardAction("edit");
  const [s] = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.id, suggestionId))
    .limit(1);
  if (!s) return;

  await db
    .update(aiSuggestions)
    .set({ status: "applied", updatedAt: new Date() })
    .where(eq(aiSuggestions.id, suggestionId));

  safeRevalidatePath(`/agent/c/${s.clientId}`);
}

export async function dismissSuggestion(suggestionId: number) {
  await guardAction("edit");
  const [s] = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.id, suggestionId))
    .limit(1);
  if (!s) return;

  await db
    .update(aiSuggestions)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(eq(aiSuggestions.id, suggestionId));

  safeRevalidatePath(`/agent/c/${s.clientId}`);
}

export async function reopenSuggestion(suggestionId: number) {
  await guardAction("edit");
  const [s] = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.id, suggestionId))
    .limit(1);
  if (!s) return;

  await db
    .update(aiSuggestions)
    .set({ status: "new", updatedAt: new Date() })
    .where(eq(aiSuggestions.id, suggestionId));

  safeRevalidatePath(`/agent/c/${s.clientId}`);
}

/**
 * Promote a suggestion into a real task on the client's task list — useful
 * when the user wants to track applying it as work-in-progress.
 */
export async function suggestionToTask(suggestionId: number) {
  await guardAction("edit");
  const [s] = await db
    .select()
    .from(aiSuggestions)
    .where(eq(aiSuggestions.id, suggestionId))
    .limit(1);
  if (!s) return;

  const titleByType: Record<string, string> = {
    title_rewrite: "Update page title",
    meta_description_rewrite: "Update meta description",
    h1_rewrite: "Update H1",
    quick_win_action: "Quick win optimization",
    content_idea: "Write new content",
    internal_link: "Add internal link",
    schema_markup: "Add structured data",
    general: "AI suggestion",
  };

  await db.insert(tasks).values({
    clientId: s.clientId,
    title: `${titleByType[s.type] ?? "AI suggestion"}${s.targetUrl ? ` — ${new URL(s.targetUrl).pathname}` : ""}`,
    description: s.suggestedValue,
    whyItMatters: s.rationale ?? undefined,
    priority: s.priority,
    status: "todo" as const,
    source: "agent_suggestion",
    sourceRef: `suggestion-${s.id}`,
  });

  await db
    .update(aiSuggestions)
    .set({ status: "applied", updatedAt: new Date() })
    .where(eq(aiSuggestions.id, suggestionId));

  safeRevalidatePath(`/agent/c/${s.clientId}`);
  safeRevalidatePath(`/clients/${s.clientId}`);
  safeRevalidatePath("/tasks");
}
