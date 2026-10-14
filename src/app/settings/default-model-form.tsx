"use client";

import { useState, useTransition } from "react";
import { Check, Cpu } from "lucide-react";
import { MODEL_PRESETS } from "@/lib/ai-model-presets";
import type { ActiveProvider } from "@/lib/api-keys";
import { saveDefaultModel } from "./actions";

/**
 * Choose the model every AI feature uses.
 *
 * Until now there was no way to. `defaultModelFor()` returned the first
 * preset for the active provider, and the only picker in the product
 * lived inside three chat screens and was forgotten the moment you left
 * them. Issue #30 asked, in plain words, "how to set which AI model to
 * use in the AI settings?" — and the honest answer was that you could
 * not.
 *
 * The list comes from MODEL_PRESETS, which is already the single table
 * of model ids and prices, so this cannot offer a model the dispatcher
 * does not know.
 */
export function DefaultModelForm({
  provider,
  initial,
}: {
  provider: ActiveProvider;
  initial: string | null;
}) {
  const presets = MODEL_PRESETS[provider] ?? [];
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (presets.length === 0) return null;

  function choose(next: string) {
    setValue(next);
    setSaved(false);
    startTransition(async () => {
      await saveDefaultModel(next);
      setSaved(true);
    });
  }

  return (
    <div className="space-y-2 border-t border-white/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <Cpu className="size-3.5 text-violet-300" />
        Model
        {saved && !pending && (
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <Check className="size-3" /> saved
          </span>
        )}
      </div>

      <select
        value={value}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
        className="h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">
          Default ({presets[0].label})
        </option>
        {presets.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
            {m.hint ? ` — ${m.hint}` : ""}
          </option>
        ))}
      </select>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Used by every AI feature unless a screen offers its own picker. The
        choice is remembered per provider — switching provider falls back to
        that provider&apos;s default rather than sending it a model it does not
        have.
      </p>
    </div>
  );
}
