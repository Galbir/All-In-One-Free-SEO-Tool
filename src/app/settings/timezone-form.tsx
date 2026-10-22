"use client";

import { useActionState } from "react";
import { saveWorkspaceTimeZone } from "./timezone-actions";

export function TimeZoneForm({
  current,
  serverZone,
  zones,
}: {
  current: string | null;
  serverZone: string;
  zones: string[];
}) {
  const [state, action, pending] = useActionState(saveWorkspaceTimeZone, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">Time zone</span>
        <select
          name="timezone"
          defaultValue={current ?? ""}
          className="flex h-10 w-72 max-w-full rounded-md border border-input bg-background px-3 text-[14px] shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Server time ({serverZone})</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.ok && <span className="text-xs text-emerald-300">Saved.</span>}
      {state && !state.ok && (
        <span className="text-xs text-rose-300">{state.error}</span>
      )}
    </form>
  );
}
