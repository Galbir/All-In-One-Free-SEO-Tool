/**
 * Fair turns through a list that is bigger than one run's budget.
 *
 * Several background steps cap how much they do per run — 30 clients, 8
 * AI audits, 30 keywords — which is right. But they took the FIRST N rows
 * every time, with no ordering, so the same N got all the attention and
 * client #31 never had its robots.txt watched, its sitemap checked, or
 * its traffic-drop alert run. Nothing said so.
 *
 * This hands out turns in id order, resuming after the last id served
 * and wrapping round, so every row is reached within ceil(total / N) runs.
 */

import { getSetting, setSetting } from "./settings-store";

/** Pure part: which `n` ids come next after `cursor`, wrapping around. */
export function pickRotating(ids: number[], cursor: number, n: number): number[] {
  if (n <= 0 || ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (sorted.length <= n) return sorted;
  const start = sorted.findIndex((id) => id > cursor);
  const from = start === -1 ? 0 : start;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(sorted[(from + i) % sorted.length]);
  return out;
}

/**
 * Pick this run's rows and remember where it stopped. The cursor is
 * saved before the work runs, so a step that crashes half way moves on
 * next time rather than retrying the same poisonous row forever.
 */
export async function takeTurn<T extends { id: number }>(
  step: string,
  rows: T[],
  n: number,
): Promise<T[]> {
  const key = `automation.cursor.${step}` as const;
  const cursor = (await getSetting<number>(key).catch(() => null)) ?? 0;
  const picked = pickRotating(
    rows.map((r) => r.id),
    typeof cursor === "number" ? cursor : 0,
    n,
  );
  if (picked.length > 0 && rows.length > n) {
    await setSetting(key, picked[picked.length - 1]).catch(() => undefined);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return picked.map((id) => byId.get(id)!).filter(Boolean);
}

/** "8 of 40 clients (rotating)" — so a capped step says it was capped. */
export function coverageNote(done: number, total: number, noun: string): string {
  return total > done
    ? `${done} of ${total} ${noun} this run (the rest take their turn on later runs)`
    : `${done} ${noun}`;
}
