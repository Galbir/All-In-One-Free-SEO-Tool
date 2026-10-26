"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { refreshPlannerIdeas, trackPlannerKeywords } from "./planner-actions";

export function PlannerButtons({ clientId }: { clientId: number }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            setMsg((await trackPlannerKeywords(clientId, null)).message);
          })
        }
      >
        Track the top 10
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => start(() => refreshPlannerIdeas(clientId))}
      >
        Ask again
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
