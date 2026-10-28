"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { refreshPlannerIdeas, trackPlannerKeywords } from "./planner-actions";

type Idea = {
  text: string;
  volume: number;
  competition: "LOW" | "MEDIUM" | "HIGH" | null;
};

/** The idea list with a checkbox on each row, and the buttons that act on it. */
export function PlannerIdeas({
  clientId,
  ideas,
  error,
}: {
  clientId: number;
  ideas: Idea[];
  error: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const allPicked = ideas.length > 0 && picked.size === ideas.length;
  const toggle = (text: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });

  const track = (chosen: string[] | null) =>
    start(async () => {
      setMsg("Working…");
      const res = await trackPlannerKeywords(clientId, chosen);
      setMsg(res.message);
      if (res.ok) {
        setPicked(new Set());
        router.refresh();
      }
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-5 py-3">
        <Button
          size="sm"
          disabled={busy || picked.size === 0}
          onClick={() => track([...picked])}
        >
          Track selected{picked.size > 0 ? ` (${picked.size})` : ""}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || ideas.length === 0}
          onClick={() => track(null)}
        >
          Track the top 10
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            start(async () => {
              setMsg("Asking Google…");
              const res = await refreshPlannerIdeas(clientId);
              setMsg(res.message);
              setPicked(new Set());
              router.refresh();
            })
          }
        >
          Ask again
        </Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
      {error ? (
        <div className="px-5 py-6 text-sm text-destructive">{error}</div>
      ) : ideas.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No ideas yet. Press Ask again, or check that the site is reachable.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                <th className="w-10 px-5 py-2.5 text-left">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allPicked}
                    onChange={() =>
                      setPicked(
                        allPicked ? new Set() : new Set(ideas.map((i) => i.text)),
                      )
                    }
                  />
                </th>
                <th className="px-3 py-2.5 text-left">Keyword</th>
                <th className="px-3 py-2.5 text-right">Searches / month</th>
                <th className="px-5 py-2.5 text-right">Competition</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((i) => (
                <tr
                  key={i.text}
                  className="cursor-pointer border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                  onClick={() => toggle(i.text)}
                >
                  <td className="px-5 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${i.text}`}
                      checked={picked.has(i.text)}
                      onChange={() => toggle(i.text)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium">{i.text}</td>
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
    </>
  );
}
