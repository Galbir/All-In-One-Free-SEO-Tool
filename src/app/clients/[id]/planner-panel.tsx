import { Lightbulb } from "lucide-react";
import { discoverClientKeywords } from "@/lib/google-ads";
import { PlannerIdeas } from "./planner-buttons";

/** Keywords Google Keyword Planner suggests for this client's site and market. */
export async function PlannerPanel({ clientId }: { clientId: number }) {
  let error: string | null = null;
  let ideas: Awaited<ReturnType<typeof discoverClientKeywords>> = [];
  try {
    ideas = await discoverClientKeywords(clientId, { limit: 40 });
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <section className="glass-apple relative overflow-hidden rounded-2xl">
      <header className="relative border-b border-white/[0.06] px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Lightbulb className="size-4 text-amber-300" />
          Keyword ideas from Google
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Found by Keyword Planner for this site, in the client&apos;s country
          and language. Tick the ones to track. Best volume with least
          competition first; tracked ones are left out.
        </p>
      </header>
      <PlannerIdeas clientId={clientId} ideas={ideas} error={error} />
    </section>
  );
}
