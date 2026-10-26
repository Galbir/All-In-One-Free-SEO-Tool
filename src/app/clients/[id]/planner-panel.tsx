import { Lightbulb } from "lucide-react";
import { discoverClientKeywords } from "@/lib/google-ads";
import { PlannerButtons } from "./planner-buttons";

/** Keywords Google Keyword Planner suggests for this client's site and market. */
export async function PlannerPanel({ clientId }: { clientId: number }) {
  let error: string | null = null;
  let ideas: Awaited<ReturnType<typeof discoverClientKeywords>> = [];
  try {
    ideas = await discoverClientKeywords(clientId, { limit: 15 });
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <section className="glass-apple relative overflow-hidden rounded-2xl">
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Lightbulb className="size-4 text-amber-300" />
            Keyword ideas from Google
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Found by Keyword Planner for this site and market, best volume with
            least competition first. Tracked ones are left out.
          </p>
        </div>
        <PlannerButtons clientId={clientId} />
      </header>
      {error ? (
        <div className="px-5 py-6 text-sm text-destructive">{error}</div>
      ) : ideas.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No ideas yet. Planner needs the site to be reachable, or a tracked
          keyword to start from.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                <th className="px-5 py-2.5 text-left">Keyword</th>
                <th className="px-3 py-2.5 text-right">Searches / month</th>
                <th className="px-5 py-2.5 text-right">Competition</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((i) => (
                <tr
                  key={i.text}
                  className="border-b border-white/[0.04] last:border-0"
                >
                  <td className="px-5 py-2.5 font-medium">{i.text}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {i.volume.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5 text-right text-muted-foreground">
                    {i.competition?.toLowerCase() ?? "unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
