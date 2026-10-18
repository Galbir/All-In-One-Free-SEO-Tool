"use client";

import { useActionState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { runLinkIntersect, type IntersectState } from "./actions";
import type { IntersectRow } from "@/lib/link-intersect";

export function IntersectForm() {
  const [state, formAction, pending] = useActionState<IntersectState | null, FormData>(
    runLinkIntersect,
    null,
  );

  return (
    <>
      <form
        action={formAction}
        className="glass-apple relative overflow-hidden rounded-2xl p-5 space-y-4"
      >
        <Field
          name="yourDomain"
          label="Your domain"
          placeholder="mysite.com"
          required
          hint="Checked on every page we read, so a link you already have is never pitched back to you."
        />

        <fieldset className="space-y-2">
          <legend className="text-xs text-muted-foreground">
            Competitor domains — two or three beats one
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <input
              name="competitor1"
              required
              placeholder="rival-one.com"
              className={inputClass}
            />
            <input name="competitor2" placeholder="rival-two.com" className={inputClass} />
            <input name="competitor3" placeholder="rival-three.com" className={inputClass} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            A site that has linked to two of your competitors has shown the
            pattern rather than made a one-off decision, so those rank
            first. With a single competitor there is no pattern to find.
          </p>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center rounded-md bg-violet-500/15 px-5 text-sm font-medium text-violet-300 ring-1 ring-inset ring-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Reading pages… (1–4 min)
            </>
          ) : (
            "Find the gap"
          )}
        </button>
      </form>

      {state && !state.ok && (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/30">
          {state.error}
        </p>
      )}

      {state?.ok && <Results result={state.result} />}
    </>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-white/10 bg-card/60 px-3 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40";

function Field({
  name,
  label,
  placeholder,
  hint,
  required,
}: {
  name: string;
  label: string;
  placeholder: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input name={name} required={required} placeholder={placeholder} className={inputClass} />
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Results({ result }: { result: NonNullable<IntersectState & { ok: true }>["result"] }) {
  const { gaps, alreadyLinkingToYou, stats, errors, competitors } = result;
  const strong = gaps.filter((g) => g.competitors.length > 1).length;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-4">
        <Tile label="Sites to contact" value={gaps.length} tone="emerald" />
        <Tile label="Link to 2+ rivals" value={strong} tone="violet" />
        <Tile label="Already link to you" value={alreadyLinkingToYou.length} tone="neutral" />
        <Tile label="Pages read" value={stats.pagesRead} tone="neutral" />
      </section>

      <p className="text-[11px] text-muted-foreground">
        Read {stats.pagesRead} of {stats.candidatePages} candidate pages
        {stats.pagesUnreachable > 0 && (
          <> · {stats.pagesUnreachable} could not be fetched</>
        )}{" "}
        · checked against {result.yourDomain} and {competitors.length}{" "}
        competitor{competitors.length === 1 ? "" : "s"}.{" "}
        <strong className="text-foreground">Page-level evidence.</strong> A
        site can link to you from a page these searches never surfaced, so
        &ldquo;already links to you&rdquo; means on a page we actually read.
      </p>

      {errors.length > 0 && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300 ring-1 ring-inset ring-amber-500/30">
          Notes: {errors.join(" · ")}
        </p>
      )}

      <RowList
        title="Link to a competitor, not to you"
        subtitle="Sorted by how many of your competitors each one links to. Start at the top."
        rows={gaps}
        empty="Nothing came back as a gap. Either the searches found no pages linking to these competitors, or every page that did also links to you."
        tone="emerald"
      />

      {alreadyLinkingToYou.length > 0 && (
        <RowList
          title="Already linking to you"
          subtitle="Here so you don't pitch them again. Worth checking the anchor text and whether the link is still dofollow."
          rows={alreadyLinkingToYou}
          empty=""
          tone="neutral"
        />
      )}
    </>
  );
}

function RowList({
  title,
  subtitle,
  rows,
  empty,
  tone,
}: {
  title: string;
  subtitle: string;
  rows: IntersectRow[];
  empty: string;
  tone: "emerald" | "neutral";
}) {
  return (
    <section className="glass-apple relative overflow-hidden rounded-2xl">
      <header className="border-b border-white/[0.06] px-5 py-4">
        <h2 className="text-base font-semibold">
          {title}{" "}
          <span className="font-normal text-muted-foreground">({rows.length})</span>
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {rows.map((row) => (
            <li key={row.domain} className="px-5 py-3.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{row.domain}</span>
                <span className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${
                      row.competitors.length > 1
                        ? "bg-violet-500/15 text-violet-300 ring-violet-500/30"
                        : tone === "emerald"
                          ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                          : "bg-white/5 text-muted-foreground ring-white/10"
                    }`}
                  >
                    {row.competitors.length} competitor
                    {row.competitors.length === 1 ? "" : "s"}
                  </span>
                  {row.dofollow > 0 && (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30">
                      {row.dofollow} dofollow
                    </span>
                  )}
                </span>
              </div>

              <ul className="mt-2 space-y-1.5">
                {row.pages.map((p, i) => (
                  <li key={`${p.url}-${p.competitor}-${i}`} className="text-[11px]">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 truncate hover:underline"
                    >
                      {p.title || p.url}
                      <ExternalLink className="size-3 shrink-0 opacity-60" />
                    </a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                      <span>
                        links to <span className="text-foreground">{p.competitor}</span>
                      </span>
                      {p.anchorText && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono">
                          {p.anchorText}
                        </span>
                      )}
                      <span
                        className={p.follow === "dofollow" ? "text-sky-300" : undefined}
                        title={p.rel ? `rel="${p.rel}"` : "No rel attribute"}
                      >
                        {p.follow}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "emerald" | "violet";
}) {
  const t = {
    neutral: "text-foreground",
    emerald: "text-emerald-300",
    violet: "text-violet-300",
  }[tone];
  return (
    <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${t}`}>{value}</div>
    </div>
  );
}
