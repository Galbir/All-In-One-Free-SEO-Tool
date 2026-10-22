"use server";

import {
  scoreAllPassages,
  suggestRewriteHint,
  type PassageScore,
} from "@/lib/aio-passage-scorer";
import { extractMainContent } from "@/lib/main-content-extractor";
import { saveToolRun } from "@/lib/tool-runs";
import { guardAction } from "@/lib/action-guard";

export type AnalyzeState =
  | { ok: true; passages: PassageScore[]; sourceUrl?: string; sourceTitle?: string }
  | { ok: false; error: string }
  | null;

export async function analyzePassages(
  _prev: AnalyzeState,
  formData: FormData,
): Promise<AnalyzeState> {
  await guardAction("edit", formData.get("clientId"));
  const md = String(formData.get("markdown") ?? "").trim();
  if (!md) return { ok: false, error: "Paste a draft first." };
  const passages = scoreAllPassages(md);
  if (passages.length === 0) {
    return {
      ok: false,
      error:
        "Couldn't extract any passages — make sure paragraphs are separated by blank lines.",
    };
  }
  const avg = Math.round(
    passages.reduce((s, p) => s + p.score, 0) / passages.length,
  );
  await saveToolRun({
    toolId: "aio-passage",
    label: `${passages.length} passages · avg score ${avg}`,
    input: { markdown: md.slice(0, 4000) },
    result: { ok: true, passages },
  }).catch(() => undefined);
  return { ok: true, passages };
}

export async function suggestRewrite(
  passage: string,
  score: number,
): Promise<{ ok: true; rewrite: string } | { ok: false; error: string }> {
  await guardAction("edit");
  const r = await suggestRewriteHint(passage, score);
  if (!r)
    return {
      ok: false,
      error:
        "AI didn't return a rewrite. Either the passage already scores 70+ or no AI provider is configured.",
    };
  return { ok: true, rewrite: r };
}

/**
 * Fetch a live URL, extract its readable main content, and run the
 * passage scorer against it. Same result shape as analyzePassages,
 * plus source metadata so the UI can show "analyzed: <title>".
 */
export async function analyzeUrl(
  _prev: AnalyzeState,
  formData: FormData,
): Promise<AnalyzeState> {
  await guardAction("edit", formData.get("clientId"));
  const rawUrl = String(formData.get("url") ?? "").trim();
  if (!rawUrl) return { ok: false, error: "Enter a URL first." };
  let url = rawUrl;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  const extracted = await extractMainContent(url);
  if (!extracted.ok) {
    return {
      ok: false,
      error: extracted.error ?? "Couldn't fetch or parse that URL.",
    };
  }
  const passages = scoreAllPassages(extracted.markdown);
  if (passages.length === 0) {
    return {
      ok: false,
      error:
        "Fetched the page but couldn't split it into scoreable passages. " +
        "The main content may be too short or too fragmented.",
    };
  }
  const avg = Math.round(
    passages.reduce((s, p) => s + p.score, 0) / passages.length,
  );
  await saveToolRun({
    toolId: "aio-passage",
    label: `${extracted.title || url} · ${passages.length} passages · avg ${avg}`,
    input: { url },
    result: { ok: true, passages, sourceUrl: url, sourceTitle: extracted.title },
  }).catch(() => undefined);
  return {
    ok: true,
    passages,
    sourceUrl: url,
    sourceTitle: extracted.title,
  };
}

/**
 * Batch-rewrite every passage scoring below `threshold` in parallel,
 * so the user gets a full "before → after" report in one click
 * instead of clicking "Rewrite" one passage at a time.
 *
 * Runs at most 8 concurrent AI calls so we don't burst the free-tier
 * rate limits (Gemini free = 15 rpm, Groq = 30 rpm).
 */
export async function batchRewrite(
  passages: PassageScore[],
  threshold = 70,
): Promise<{
  ok: true;
  rewrites: { index: number; before: string; after: string | null }[];
} | { ok: false; error: string }> {
  await guardAction("edit");
  const targets = passages.filter((p) => p.score < threshold);
  if (targets.length === 0) {
    return {
      ok: true,
      rewrites: [],
    };
  }
  const MAX_CONCURRENT = 8;
  const rewrites: { index: number; before: string; after: string | null }[] = [];
  for (let i = 0; i < targets.length; i += MAX_CONCURRENT) {
    const batch = targets.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(
      batch.map((p) => suggestRewriteHint(p.text, p.score).catch(() => null)),
    );
    batch.forEach((p, j) => {
      rewrites.push({ index: p.index, before: p.text, after: results[j] });
    });
  }
  return { ok: true, rewrites };
}
