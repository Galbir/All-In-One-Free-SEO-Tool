/**
 * Per-client daily automation orchestrator.
 *
 * Two responsibilities:
 *   1. tickScheduleGeneration() — find schedules due now, generate the
 *      right kind of content via AI, drop it into publish_queue.
 *   2. tickQueuePublish() — find approved queue items, route each to the
 *      right publisher (WordPress / GBP / etc), mark published or failed.
 *
 * Both are driven by the scheduler's `content_schedules` runner (every 15
 * minutes), so a schedule runs at its own time of day. daily-agent.ts also
 * calls them as part of its 24h sweep; whichever comes first does the work.
 */

import { pickPlannerKeywords } from "@/lib/google-ads";
import { and, asc, desc, eq, gte, lte, or, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clients,
  dailySchedules,
  keywords,
  keywordRankings,
  publishQueue,
  tasks,
  type Client,
  type DailySchedule,
  type PublishQueueItem,
} from "@/db/schema";
import { callAI } from "./ai-call";
import type { WooProduct } from "./woo-products";
import { logActivity } from "./activity";
import {
  retrieveKnowledge,
  renderKnowledgeContext,
} from "./seo-knowledge-base";

const KIND_LABEL = {
  blog_draft: "Blog draft",
  gbp_post: "GBP post",
  social_post: "Social post",
  internal_checklist: "Daily checklist",
} as const;

export type ScheduleKind = keyof typeof KIND_LABEL;

/**
 * Move a schedule's nextRunAt forward by cadenceDays. Called after
 * either successful generation or a failed attempt — either way the
 * next attempt is one cadence in the future, not immediately.
 */
function computeNextRun(s: DailySchedule, from: Date = new Date()): Date {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + Math.max(1, s.cadenceDays));
  // Snap to the schedule's timeUtc (HHMM)
  const hh = Math.floor(s.timeUtc / 100);
  const mm = s.timeUtc % 100;
  next.setUTCHours(hh, mm, 0, 0);
  return next;
}

// ─────────────────────────────────────────────────────────────────────
// Generation phase
// ─────────────────────────────────────────────────────────────────────

export async function tickScheduleGeneration(): Promise<{
  generated: number;
  skipped: number;
}> {
  const now = new Date();
  const due = await db
    .select()
    .from(dailySchedules)
    .where(
      and(
        eq(dailySchedules.enabled, true),
        or(
          isNull(dailySchedules.nextRunAt),
          lte(dailySchedules.nextRunAt, now),
        ),
      ),
    );

  let generated = 0;
  let skipped = 0;
  let autoApproved = 0;
  for (const s of due) {
    try {
      const item = await generateForSchedule(s);
      if (!item) {
        skipped++;
        continue;
      }
      await db.insert(publishQueue).values({
        scheduleId: s.id,
        clientId: s.clientId,
        kind: s.kind,
        status: s.autoPublish ? "approved" : "pending_review",
        title: item.title,
        body: item.body,
        payloadJson: item.payload ?? null,
        scheduledFor: now,
      });
      await db
        .update(dailySchedules)
        .set({
          lastRunAt: now,
          nextRunAt: computeNextRun(s, now),
          updatedAt: now,
        })
        .where(eq(dailySchedules.id, s.id));
      generated++;
      if (s.autoPublish) autoApproved++;
    } catch (err) {
      // Schedule a retry one cadence later regardless — don't loop on a
      // permanently-broken schedule.
      await db
        .update(dailySchedules)
        .set({
          lastRunAt: now,
          nextRunAt: computeNextRun(s, now),
          updatedAt: now,
        })
        .where(eq(dailySchedules.id, s.id));
      await logActivity({
        kind: "audit.completed",
        clientId: s.clientId,
        level: "warning",
        message: `Auto-${s.kind}: generation failed — ${(err as Error).message?.slice(0, 200) ?? "unknown"}`,
      });
      skipped++;
    }
  }
  // Auto-publish means now, not at the next daily-agent pass — which is
  // up to 24h later, and never at all for an item made with "Run now".
  if (autoApproved > 0) await tickQueuePublish();
  return { generated, skipped };
}

type GeneratedItem = {
  title: string | null;
  body: string;
  payload?: Record<string, unknown>;
};

/**
 * Build a rich context block from everything we know about the client.
 * The same prompt-injection pattern as /seo-chat — but tuned for content
 * generation: niche, tech stack, top GSC queries (when persisted),
 * recent striking-distance keywords, and the knowledge corpus chunk
 * matched against the topic seed.
 *
 * The output is plain text suitable for appending to the AI system
 * prompt. Empty if nothing's known.
 */
async function buildClientContext(opts: {
  client: Client;
  topicSeed: string;
}): Promise<string> {
  const { client, topicSeed } = opts;
  const lines: string[] = [];

  lines.push(`[Client context]`);
  lines.push(`- Name: ${client.name}`);
  lines.push(`- Site: ${client.url}`);
  if (client.niche) lines.push(`- Niche: ${client.niche}`);
  if (client.techStack && client.techStack.length > 0) {
    lines.push(`- Tech stack: ${client.techStack.join(", ")}`);
  }

  // Recent striking-distance keywords from the rank tracker — these are
  // queries the client is close to ranking for. Mentioning them in new
  // content is a high-value internal-linking + topical-authority signal.
  try {
    const recent = await db
      .select({
        query: keywords.query,
        position: keywordRankings.position,
      })
      .from(keywordRankings)
      .innerJoin(keywords, eq(keywords.id, keywordRankings.keywordId))
      .where(
        and(
          eq(keywords.clientId, client.id),
          gte(
            keywordRankings.checkedAt,
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          ),
        ),
      )
      .orderBy(desc(keywordRankings.checkedAt))
      .limit(50);
    const strikingDistance = recent
      .filter((r) => r.position !== null && r.position >= 4 && r.position <= 20)
      .slice(0, 8)
      .map((r) => `${r.query} (#${r.position})`);
    if (strikingDistance.length > 0) {
      lines.push(
        `- Striking-distance queries (use 1-2 in the content if they fit naturally): ${strikingDistance.join("; ")}`,
      );
    }
  } catch {
    // Best-effort — never let context lookup fail the generation
  }

  // Inject knowledge-base chunks matched against the topic. Same
  // pattern as /seo-chat — token-efficient RAG.
  try {
    const matched = retrieveKnowledge(`${client.niche ?? ""} ${topicSeed}`, 2);
    const ctx = renderKnowledgeContext(matched, 2000);
    if (ctx) {
      lines.push(``);
      lines.push(`[Internal knowledge — weave these facts in, don't quote verbatim]`);
      lines.push(ctx);
    }
  } catch {
    // Best-effort
  }

  return lines.join("\n");
}

async function generateForSchedule(
  s: DailySchedule,
): Promise<GeneratedItem | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, s.clientId))
    .limit(1);
  if (!client) return null;

  const cfg = (s.configJson ?? {}) as Record<string, unknown>;
  const topicSeed = String(cfg.topic_seed ?? client.niche ?? "SEO");
  const tone = String(cfg.tone ?? "professional, plain English");
  // "custom" schedules write around the keywords the user typed; the
  // default is the client's best-ranking tracked keywords.
  const customKeywords = Array.isArray(cfg.keywords_custom)
    ? (cfg.keywords_custom as unknown[]).map(String).filter(Boolean)
    : [];
  // "planner" lets Google Keyword Planner find the keywords: ideas for
  // this client's site and market, best volume-to-competition first,
  // walking down the list run by run. Without Ads it quietly falls back
  // to the tracked keywords.
  const plannerKeywords =
    cfg.keywords_mode === "planner"
      ? await pickPlannerKeywords(client.id)
      : [];
  const focusKeywords =
    cfg.keywords_mode === "custom" && customKeywords.length > 0
      ? customKeywords
      : plannerKeywords;
  const kws =
    focusKeywords.length > 0
      ? focusKeywords
      : await topClientKeywords(client.id);
  let context = await buildClientContext({ client, topicSeed });
  if (focusKeywords.length > 0) {
    context += `

[Focus keywords — use 1-3 of them naturally]
${focusKeywords.join("; ")}`;
  }
  const buttonText = typeof cfg.button_text === "string" ? cfg.button_text.trim() : "";
  const buttonText2 =
    typeof cfg.button_text_2 === "string" ? cfg.button_text_2.trim() : "";

  if (s.kind === "blog_draft") {
    if (cfg.blog_source === "woo_product" || cfg.blog_source === "woo_products") {
      const products = await pickWooProducts(
        s,
        client,
        cfg.blog_source === "woo_products" ? 3 : 1,
        kws,
      );
      if (!products) return null;
      return withBlogExportMeta(
        await generateBlogProductPost({
          client,
          tone,
          topicSeed,
          products,
          keywords: kws,
          buttons: [buttonText, buttonText2],
        }),
        kws,
        cfg,
      );
    }
    return withBlogExportMeta(
      await generateBlogDraft({ client, topicSeed, tone, context }),
      kws,
      cfg,
    );
  }
  if (s.kind === "gbp_post") {
    const maxChars = clampGbpMaxChars(cfg.max_chars);
    if (cfg.gbp_source === "woo_product") {
      const products = await pickWooProducts(s, client, 1, kws);
      if (!products) return null;
      return generateGbpProductPost({
        client,
        tone,
        product: products[0],
        keywords: kws,
        maxChars,
        ctaType: gbpCtaType(cfg.cta_type) ?? "SHOP",
        offer: cfg.post_type === "OFFER",
        couponCode: typeof cfg.offer_coupon === "string" ? cfg.offer_coupon : undefined,
      });
    }
    return generateGbpPost({
      client,
      topicSeed,
      tone,
      context,
      postType: String(cfg.post_type ?? "STANDARD"),
      maxChars,
      ctaType: gbpCtaType(cfg.cta_type),
    });
  }
  if (s.kind === "social_post") {
    if (cfg.social_source === "woo_product") {
      const products = await pickWooProducts(s, client, 1, kws);
      if (!products) return null;
      return generateSocialProductPost({
        client,
        tone,
        product: products[0],
        keywords: kws,
        buttonText,
      });
    }
    return generateSocialPost({ client, topicSeed, tone, context });
  }
  if (s.kind === "internal_checklist") {
    return generateChecklist({ client, context });
  }
  return null;
}

/** Keywords + AI brief ride along on the queue item for the "Download .md for AI" export. */
function withBlogExportMeta(
  item: GeneratedItem | null,
  keywords: string[],
  cfg: Record<string, unknown>,
): GeneratedItem | null {
  if (!item) return item;
  const brief = typeof cfg.ai_brief === "string" ? cfg.ai_brief.trim() : "";
  return {
    ...item,
    payload: {
      ...item.payload,
      keywords,
      ...(brief ? { aiBrief: brief } : {}),
    },
  };
}

async function generateBlogDraft(opts: {
  client: Client;
  topicSeed: string;
  tone: string;
  context: string;
}): Promise<GeneratedItem | null> {
  const system = `You are an expert SEO content writer working on a real blog for ${opts.client.name} (${opts.client.url}).

Write ONE complete blog post in HTML. 800-1200 words. Structure:
- Opening tl;dr (1-2 sentences, no header)
- 50-word intro paragraph that frames the problem
- 3-5 H2 subheadings, each followed by 2-4 paragraphs / a list when it helps
- Closing paragraph with a clear next step
- Use <p>, <h2>, <ul>, <ol>, <strong>, <em>, <blockquote>, <code>
- NEVER include <html>, <body>, <h1>, <head>, or <style> tags — the H1 comes from the title field and styling is the WP theme's job
- NEVER hallucinate specific statistics, customer names, or product features. Stay grounded in what's plausible for the niche.
- Tone: ${opts.tone}

The post should be the kind a smart human editor would publish without rewriting it — specific examples, real-world phrasing, no "in today's fast-paced world" filler.`;

  const user = `${opts.context}

[Today's brief]
Topic seed: "${opts.topicSeed}"

Pick a specific, useful angle the audience would actually search for. Don't write a generic listicle — pick a real question and answer it well.

Output strict JSON only — no markdown fences, no preamble:

{
  "title": "55-65 char post title that would earn a click in SERP",
  "metaDescription": "140-160 char SEO description that summarizes the answer",
  "excerpt": "1-sentence WP excerpt (≤180 chars) — the social-share teaser",
  "contentHtml": "the full body as HTML, no <html>/<body>/<h1>"
}`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 3500,
    temperature: 0.7,
    timeoutMs: 120_000,
    ignoreCreditSaver: true,
    feature: "blog_draft",
    clientId: opts.client.id,
  });
  if (!raw) return null;
  const parsed = extractJson(raw) as {
    title?: string;
    metaDescription?: string;
    excerpt?: string;
    contentHtml?: string;
  } | null;
  if (!parsed || !parsed.title || !parsed.contentHtml) return null;
  return {
    title: parsed.title.slice(0, 200),
    body: parsed.contentHtml,
    payload: {
      metaDescription: (parsed.metaDescription ?? "").slice(0, 200),
      excerpt: (parsed.excerpt ?? "").slice(0, 300),
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Product photo + price + buttons, as plain HTML using WordPress's core
 * button classes so the theme styles them like any button block.
 */
function productCardHtml(p: WooProduct, buttons: [string, string]): string {
  const primary = escapeHtml(buttons[0] || "Buy now");
  const secondary = escapeHtml(buttons[1] || "See details");
  const url = escapeHtml(p.permalink);
  const name = escapeHtml(p.name);
  const price = p.price
    ? `<p class="product-price"><strong>${escapeHtml(p.price)}</strong>${
        p.onSale && p.regularPrice ? ` <del>${escapeHtml(p.regularPrice)}</del>` : ""
      }</p>`
    : "";
  const img = p.imageUrl
    ? `<figure class="wp-block-image size-large"><a href="${url}"><img src="${escapeHtml(p.imageUrl)}" alt="${name}" loading="lazy" /></a><figcaption>${name}</figcaption></figure>`
    : "";
  return `<div class="product-card">
${img}
${price}
<div class="wp-block-buttons">
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${url}">${primary}</a></div>
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="${url}">${secondary}</a></div>
</div>
</div>`;
}

/**
 * Blog post about one product (a review-style article) or several (a
 * roundup). The AI marks where each product card goes with
 * <!--PRODUCT:n-->; cards it forgot are appended at the end.
 */
async function generateBlogProductPost(opts: {
  client: Client;
  tone: string;
  topicSeed: string;
  products: WooProduct[];
  keywords: string[];
  /** Button labels; empty strings fall back to "Buy now" / "See details" */
  buttons: [string, string];
}): Promise<GeneratedItem | null> {
  const { products } = opts;
  const single = products.length === 1;
  const system = `You are an expert SEO content writer for the online shop ${opts.client.name} (${opts.client.url}).

Write ONE blog post in HTML that ${single ? "presents ONE product in depth" : `presents these ${products.length} products as a roundup`}. ${single ? "700-1000" : "900-1300"} words. Structure:
- Opening tl;dr (1-2 sentences, no header)
- Short intro that frames the buyer's problem or occasion
- ${single ? "3-4 H2 sections: what it is, who it is for, why it beats the alternatives, how to choose / use it" : "One H2 per product (use its name), then a short H2 comparing who each one suits"}
- Put the marker <!--PRODUCT:n--> on its own line where product n's photo and buy buttons should appear (n is the number given below); ${single ? "place it right after the intro" : "place each one under that product's H2"}
- Closing paragraph inviting the reader to order
- Use <p>, <h2>, <h3>, <ul>, <ol>, <strong>, <em>, <blockquote>
- NEVER include <html>, <body>, <h1>, <img>, <a> buttons, <style> — images and buttons are added from the markers
- Use only facts given below. Never invent specs, stock levels, discounts, reviews or prices
- Work 1-3 of the shop's search phrases into headings or text where they fit naturally
- Write in the same language as the product names
- Tone: ${opts.tone}`;
  const productLines = products
    .map(
      (p, i) => `Product ${i + 1}
Name: ${p.name}
Price: ${p.price ?? "not shown"}${p.onSale && p.regularPrice ? ` (on sale, was ${p.regularPrice})` : ""}
Description: ${p.shortDescription || "(none)"}`,
    )
    .join("\n\n");
  const user = `[Products]
${productLines}

[Search phrases the shop ranks for]
${opts.keywords.join("; ") || "(none)"}

[Angle hint]
${opts.topicSeed}

Output strict JSON only — no markdown fences, no preamble:

{
  "title": "55-65 char post title that would earn a click in SERP",
  "metaDescription": "140-160 char SEO description",
  "excerpt": "1-sentence WP excerpt (≤180 chars)",
  "contentHtml": "the full body as HTML with the <!--PRODUCT:n--> markers",
  "buyLabel": "2-3 word 'buy now' button label in the article's language",
  "detailsLabel": "2-3 word 'see details' button label in the article's language"
}`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 4000,
    temperature: 0.7,
    timeoutMs: 120_000,
    ignoreCreditSaver: true,
    feature: "blog_draft",
    clientId: opts.client.id,
  });
  if (!raw) return null;
  const parsed = extractJson(raw) as {
    title?: string;
    metaDescription?: string;
    excerpt?: string;
    contentHtml?: string;
    buyLabel?: string;
    detailsLabel?: string;
  } | null;
  if (!parsed || !parsed.title || !parsed.contentHtml) return null;

  // Schedule labels win; otherwise the AI's, in the article's language
  const buttons: [string, string] = [
    opts.buttons[0] || (parsed.buyLabel ?? "").slice(0, 40),
    opts.buttons[1] || (parsed.detailsLabel ?? "").slice(0, 40),
  ];
  const placed = new Set<number>();
  let html = parsed.contentHtml.replace(/<!--\s*PRODUCT:(\d+)\s*-->/g, (_m, n) => {
    const i = Number(n) - 1;
    if (!products[i] || placed.has(i)) return "";
    placed.add(i);
    return productCardHtml(products[i], buttons);
  });
  const missing = products.filter((_, i) => !placed.has(i));
  if (missing.length > 0) {
    html += "\n" + missing.map((p) => productCardHtml(p, buttons)).join("\n");
  }
  return {
    title: parsed.title.slice(0, 200),
    body: html,
    payload: {
      metaDescription: (parsed.metaDescription ?? "").slice(0, 200),
      excerpt: (parsed.excerpt ?? "").slice(0, 300),
      productIds: products.map((p) => p.id),
    },
  };
}

const GBP_CTA_TYPES = ["SHOP", "ORDER", "LEARN_MORE", "BOOK", "SIGN_UP", "CALL"] as const;
type GbpCtaType = (typeof GBP_CTA_TYPES)[number];

/** Schedule's `cta_type`; null means "let the AI pick" (topic posts). */
function gbpCtaType(raw: unknown): GbpCtaType | null {
  return GBP_CTA_TYPES.includes(raw as GbpCtaType) ? (raw as GbpCtaType) : null;
}

/** Schedule's `max_chars` → a sane GBP length (default 300 — short posts get read; capped at 1000). */
function clampGbpMaxChars(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.max(150, Math.min(1000, n)) : 300;
}

/** "about 180–300 characters" for a 300 cap */
function gbpLengthRule(maxChars: number): string {
  return `${Math.round(maxChars * 0.6)}–${maxChars} characters total, hard limit ${maxChars}`;
}

/** Lowercase, no diacritics — "Café Crème" and "cafe creme" match. */
function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * The client's tracked keywords, best-ranking first. Product picks favour
 * products these name, and product prompts weave them in.
 */
async function topClientKeywords(clientId: number, limit = 10): Promise<string[]> {
  try {
    const rows = await db
      .select({ query: keywords.query, position: keywordRankings.position })
      .from(keywords)
      .leftJoin(keywordRankings, eq(keywordRankings.keywordId, keywords.id))
      .where(eq(keywords.clientId, clientId))
      .orderBy(desc(keywordRankings.checkedAt))
      .limit(300);
    const best = new Map<string, number>();
    for (const r of rows) {
      const pos = r.position ?? 999;
      if (!best.has(r.query) || pos < best.get(r.query)!) best.set(r.query, pos);
    }
    return [...best.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([q]) => q);
  } catch {
    return [];
  }
}

/** How many keyword words appear in the product's name and description. */
function keywordScore(p: WooProduct, kws: string[]): number {
  const hay = foldText(`${p.name} ${p.shortDescription}`);
  let score = 0;
  for (const kw of kws) {
    const words = foldText(kw)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    const hits = words.filter((w) => hay.includes(w)).length;
    if (words.length > 0 && hits === words.length) score += 3;
    else score += hits;
  }
  return score;
}

/**
 * `count` in-stock products with a photo for this schedule's next item.
 * Picks rotate between three pools so a daily schedule mixes them:
 * products that match the schedule's keywords, the newest arrivals,
 * and a random one. Products used in the schedule's last 20 items are
 * skipped while there are others left.
 */
async function pickWooProducts(
  s: DailySchedule,
  client: Client,
  count: number,
  kws: string[],
): Promise<WooProduct[] | null> {
  if (!client.url) return null;
  const { listWooProducts } = await import("./woo-products");
  const site = /^https?:\/\//i.test(client.url) ? client.url : `https://${client.url}`;
  const [popular, newest] = await Promise.all([
    listWooProducts(site),
    listWooProducts(site, { orderby: "date", perPage: 20 }).catch(() => []),
  ]);
  const byId = new Map<number, WooProduct>();
  for (const p of [...popular, ...newest]) {
    if (p.imageUrl && !byId.has(p.id)) byId.set(p.id, p);
  }
  if (byId.size === 0) return null;

  const recent = await db
    .select({ payloadJson: publishQueue.payloadJson })
    .from(publishQueue)
    .where(eq(publishQueue.scheduleId, s.id))
    .orderBy(desc(publishQueue.createdAt))
    .limit(20);
  const used = new Set<number>();
  for (const r of recent) {
    const pl = (r.payloadJson ?? {}) as { productId?: number; productIds?: number[] };
    if (pl.productId) used.add(pl.productId);
    for (const id of pl.productIds ?? []) used.add(id);
  }
  let pool = [...byId.values()].filter((p) => !used.has(p.id));
  if (pool.length < count) pool = [...byId.values()];

  const picked: WooProduct[] = [];
  const take = (p: WooProduct | undefined) => {
    if (p && !picked.includes(p)) picked.push(p);
  };
  const strategies = ["keyword", "new", "random"] as const;
  for (let i = 0; picked.length < Math.min(count, pool.length) && i < count * 3; i++) {
    const left = pool.filter((p) => !picked.includes(p));
    const strategy = strategies[(recent.length + i) % strategies.length];
    if (strategy === "keyword" && kws.length > 0) {
      const scored = left
        .map((p) => ({ p, score: keywordScore(p, kws) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      take(scored[0]?.p ?? left[0]);
    } else if (strategy === "new") {
      take(newest.map((n) => left.find((p) => p.id === n.id)).find(Boolean) ?? left[0]);
    } else {
      take(left[Math.floor(Math.random() * left.length)]);
    }
  }
  return picked.length > 0 ? picked : null;
}

async function generateGbpProductPost(opts: {
  client: Client;
  tone: string;
  product: WooProduct;
  keywords: string[];
  maxChars: number;
  ctaType: GbpCtaType;
  /** OFFER post: Google shows "View offer" linking to the product */
  offer: boolean;
  couponCode?: string;
}): Promise<GeneratedItem | null> {
  const { product } = opts;
  const system = `You write Google Business Profile posts that showcase ONE product from an online shop. Constraints:
- ${gbpLengthRule(opts.maxChars)}
- 1–3 short paragraphs separated by a blank line
- Plain text: no markdown, no bullet symbols, at most 2 hashtags
- Name the product and the one or two benefits a buyer cares about most
- Mention the price only if it is given below; never invent prices, discounts or stock levels
- No [placeholder] brackets, no "we are excited to" filler
- End by inviting the reader to buy — the post's link opens the product page
- If a search phrase below fits the product, use one naturally; never force it
- Write in the same language as the product name and description
- Tone: ${opts.tone}`;
  const user = `[Shop]
${opts.client.name} — ${opts.client.url ?? ""}

[Product]
Name: ${product.name}
Price: ${product.price ?? "not shown"}${product.onSale && product.regularPrice ? ` (on sale, was ${product.regularPrice})` : ""}
Description: ${product.shortDescription || "(none)"}
${opts.couponCode ? `Coupon code: ${opts.couponCode}\n` : ""}
[Search phrases the shop ranks for]
${opts.keywords.slice(0, 6).join("; ") || "(none)"}

Output strict JSON only — no markdown fences:

{ "summary": "the post text, paragraphs separated by \\n\\n" }`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 600,
    temperature: 0.6,
    timeoutMs: 60_000,
    feature: "general",
    clientId: opts.client.id,
  });
  if (!raw) return null;
  const parsed = extractJson(raw) as { summary?: string } | null;
  if (!parsed?.summary) return null;
  const { trimGbpSummary } = await import("./gbp-api");
  return {
    title: product.name.slice(0, 80),
    body: trimGbpSummary(parsed.summary, opts.maxChars),
    payload: {
      callToAction: opts.ctaType,
      ctaUrl: product.permalink,
      mediaUrl: product.imageUrl,
      productId: product.id,
      postType: opts.offer ? "OFFER" : "STANDARD",
      ...(opts.offer
        ? {
            offerTitle:
              product.onSale && product.regularPrice && product.price
                ? `${product.name} – ${product.price}`
                : product.name,
            couponCode: opts.couponCode,
          }
        : {}),
    },
  };
}

async function generateGbpPost(opts: {
  client: Client;
  topicSeed: string;
  tone: string;
  context: string;
  postType: string;
  maxChars: number;
  /** Button chosen on the schedule; null lets the AI pick */
  ctaType: GbpCtaType | null;
}): Promise<GeneratedItem | null> {
  const system = `You write Google Business Profile posts for local businesses. Constraints:
- ${gbpLengthRule(opts.maxChars)}
- 1–3 short paragraphs separated by a blank line — never one wall of text
- Plain text: no markdown, no bullet symbols, at most 2 hashtags
- No [placeholder] brackets — write real words or leave the idea out
- Lead with the benefit, not a greeting
- Specific over generic — name a service, a season, a price range, an actual menu item
- No emoji spam (1 emoji max, only if it adds clarity)
- No "we are excited to" / "we are thrilled to" filler
- End with a single clear next step
- Tone: ${opts.tone}`;
  const user = `${opts.context}

[Today's brief]
Topic seed: "${opts.topicSeed}"
Post type: ${opts.postType}

Pick the most timely angle for this business. Output strict JSON only — no markdown fences:

{
  "summary": "the post text, at most ${opts.maxChars} chars, paragraphs separated by \\n\\n",
  "callToAction": "BOOK"|"ORDER"|"SHOP"|"LEARN_MORE"|"SIGN_UP"|"CALL"|null
}`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 800,
    temperature: 0.6,
    timeoutMs: 60_000,
    feature: "general",
    clientId: opts.client.id,
  });
  if (!raw) {
    throw new Error(
      "the AI provider returned no answer (check Settings → AI, or try again)",
    );
  }
  const parsed = extractJson(raw) as {
    summary?: string;
    callToAction?: string | null;
  } | null;
  if (!parsed || !parsed.summary) {
    throw new Error(
      `the AI answer was not the expected JSON: ${raw.replace(/\s+/g, " ").slice(0, 120)}`,
    );
  }
  const { trimGbpSummary } = await import("./gbp-api");
  return {
    title: parsed.summary.slice(0, 80),
    body: trimGbpSummary(parsed.summary, opts.maxChars),
    payload: {
      callToAction: opts.ctaType ?? parsed.callToAction ?? null,
      postType: opts.postType,
    },
  };
}

async function generateSocialPost(opts: {
  client: Client;
  topicSeed: string;
  tone: string;
  context: string;
}): Promise<GeneratedItem | null> {
  const system = `You write short-form social posts. Make each platform variant distinct:
- X / Twitter: 1-2 punchy lines, hook → payoff, ≤270 chars
- LinkedIn: 3-5 line micro-essay with a real insight, ≤700 chars
- No emoji spam, no hashtag walls (LinkedIn: max 3 hashtags at the end; X: 0-1)
- Tone: ${opts.tone}`;
  const user = `${opts.context}

[Today's brief]
Topic seed: "${opts.topicSeed}"

Output strict JSON only — no markdown fences:

{ "x": "X post ≤270 chars", "linkedin": "LinkedIn post ≤700 chars" }`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 800,
    temperature: 0.7,
    timeoutMs: 60_000,
    feature: "general",
    clientId: opts.client.id,
  });
  if (!raw) return null;
  const parsed = extractJson(raw) as {
    x?: string;
    linkedin?: string;
  } | null;
  if (!parsed || (!parsed.x && !parsed.linkedin)) return null;
  return {
    title: (parsed.x ?? parsed.linkedin ?? "").slice(0, 80),
    body: [
      parsed.x ? `--- X / Twitter ---\n${parsed.x}` : "",
      parsed.linkedin ? `--- LinkedIn ---\n${parsed.linkedin}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    payload: { x: parsed.x ?? null, linkedin: parsed.linkedin ?? null },
  };
}

/**
 * Copy-paste social posts about one product: each variant ends with the
 * schedule's call-to-action text and the product link. The image URL
 * rides in the payload so it can be attached by hand.
 */
async function generateSocialProductPost(opts: {
  client: Client;
  tone: string;
  product: WooProduct;
  keywords: string[];
  buttonText: string;
}): Promise<GeneratedItem | null> {
  const { product } = opts;
  const system = `You write short social posts that showcase ONE product from an online shop. Make each platform variant distinct:
- Facebook / Instagram: 2-4 short lines, the main benefit first, 1-3 hashtags at the end
- X / Twitter: 1-2 punchy lines, ≤220 chars (a link is added after it)
- LinkedIn: 3-5 line micro-essay, ≤600 chars
- Mention the price only if given; never invent discounts, specs or stock
- Do NOT include any URL or call-to-action line — they are added after your text
- If a search phrase below fits, use one naturally
- Write in the same language as the product name
- Tone: ${opts.tone}`;
  const user = `[Product]
Name: ${product.name}
Price: ${product.price ?? "not shown"}${product.onSale && product.regularPrice ? ` (on sale, was ${product.regularPrice})` : ""}
Description: ${product.shortDescription || "(none)"}

[Search phrases]
${opts.keywords.slice(0, 6).join("; ") || "(none)"}

Output strict JSON only — no markdown fences:

{ "facebook": "…", "x": "…", "linkedin": "…", "ctaLabel": "2-3 word 'shop now' phrase in the posts' language" }`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 900,
    temperature: 0.7,
    timeoutMs: 60_000,
    feature: "general",
    clientId: opts.client.id,
  });
  if (!raw) return null;
  const parsed = extractJson(raw) as {
    facebook?: string;
    x?: string;
    linkedin?: string;
    ctaLabel?: string;
  } | null;
  if (!parsed || (!parsed.facebook && !parsed.x && !parsed.linkedin)) return null;
  const cta = opts.buttonText || parsed.ctaLabel?.slice(0, 40) || "Shop now";
  const withLink = (t?: string) => (t ? `${t.trim()}\n\n👉 ${cta}: ${product.permalink}` : null);
  const variants = {
    facebook: withLink(parsed.facebook),
    x: withLink(parsed.x),
    linkedin: withLink(parsed.linkedin),
  };
  return {
    title: product.name.slice(0, 80),
    body: [
      variants.facebook ? `--- Facebook / Instagram ---\n${variants.facebook}` : "",
      variants.x ? `--- X / Twitter ---\n${variants.x}` : "",
      variants.linkedin ? `--- LinkedIn ---\n${variants.linkedin}` : "",
      product.imageUrl ? `--- Image ---\n${product.imageUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    payload: {
      ...variants,
      productId: product.id,
      ctaUrl: product.permalink,
      mediaUrl: product.imageUrl,
    },
  };
}

async function generateChecklist(opts: {
  client: Client;
  context: string;
}): Promise<GeneratedItem | null> {
  const system = `You are an SEO project manager generating today's actionable checklist for ${opts.client.name}.

Rules:
- Each item should be doable in 15-60 minutes
- Reference the client's actual context (their niche, their stack) — never generic "do SEO" advice
- Tie each item to a measurable outcome where possible
- 3-5 items max, ordered by impact`;
  const user = `${opts.context}

Output strict JSON only — no markdown fences:

{ "items": [{ "title": "≤80 chars action", "why": "1-sentence rationale tied to this client" }, ...] }`;
  const raw = await callAI({
    system,
    user,
    maxTokens: 800,
    temperature: 0.5,
    timeoutMs: 45_000,
    feature: "general",
    clientId: opts.client.id,
  });
  if (!raw) return null;
  const parsed = extractJson(raw) as {
    items?: { title?: string; why?: string }[];
  } | null;
  if (!parsed?.items?.length) return null;
  const items = parsed.items
    .filter((i) => i.title)
    .slice(0, 5)
    .map((i) => ({ title: String(i.title), why: String(i.why ?? "") }));
  return {
    title: `Today's checklist — ${items.length} item${items.length === 1 ? "" : "s"}`,
    body: items.map((i, n) => `${n + 1}. ${i.title}\n   ${i.why}`).join("\n\n"),
    payload: { items },
  };
}

function extractJson(raw: string): unknown {
  // Strip markdown fences if the model wrapped its JSON
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to grabbing the first {...} block
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Publish phase
// ─────────────────────────────────────────────────────────────────────

export async function tickQueuePublish(): Promise<{
  published: number;
  failed: number;
}> {
  const pending = await db
    .select()
    .from(publishQueue)
    .where(eq(publishQueue.status, "approved"))
    .orderBy(asc(publishQueue.scheduledFor))
    .limit(20); // safety cap per tick

  let published = 0;
  let failed = 0;

  for (const item of pending) {
    const result = await publishAndRecord(item);
    if (result.ok) published++;
    else failed++;
  }

  return { published, failed };
}

/**
 * Publish one item and record the outcome on its row. Shared by the
 * batch tick and the per-item "Publish now" / "Retry publish" buttons,
 * which used to run the whole batch and then report whichever item
 * happened to succeed or fail first.
 */
async function publishAndRecord(
  item: PublishQueueItem,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await publishOne(item);
  if (result.ok) {
    await db
      .update(publishQueue)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedRef: result.ref ?? null,
        errorMsg: null,
        updatedAt: new Date(),
      })
      .where(eq(publishQueue.id, item.id));
    await logActivity({
      kind: "audit.completed",
      clientId: item.clientId,
      level: "success",
      message: `Auto-published ${KIND_LABEL[item.kind]}: ${item.title ?? "untitled"}`,
    });
    return { ok: true };
  }
  await db
    .update(publishQueue)
    .set({
      status: "failed",
      errorMsg: result.error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(publishQueue.id, item.id));
  await logActivity({
    kind: "audit.completed",
    clientId: item.clientId,
    level: "warning",
    message: `Auto-publish failed (${KIND_LABEL[item.kind]}): ${result.error.slice(0, 200)}`,
  });
  return { ok: false, error: result.error };
}

/** Publish exactly this queue item, now. */
export async function publishQueueItemNow(
  itemId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [item] = await db
    .select()
    .from(publishQueue)
    .where(eq(publishQueue.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: "Queue item not found." };
  return publishAndRecord(item);
}

async function publishOne(
  item: PublishQueueItem,
): Promise<{ ok: true; ref?: string } | { ok: false; error: string }> {
  // Honor the schedule's destination. "local" means the user explicitly
  // opted out of any external integration — the item is theirs to copy
  // out of the queue. We don't error on it; we mark it as published
  // with a sentinel ref so the queue UI shows it's "ready to copy".
  let destination: string = "auto";
  if (item.scheduleId) {
    const [s] = await db
      .select()
      .from(dailySchedules)
      .where(eq(dailySchedules.id, item.scheduleId))
      .limit(1);
    const cfg = (s?.configJson ?? {}) as Record<string, unknown>;
    if (typeof cfg.destination === "string") destination = cfg.destination;
  }
  if (destination === "local") {
    return { ok: true, ref: "local:draft" };
  }

  if (item.kind === "blog_draft") {
    return publishBlog(item);
  }
  if (item.kind === "gbp_post") {
    return publishGbp(item);
  }
  if (item.kind === "social_post") {
    // No auto-OAuth path in v1. Approved social items stay approved as
    // a manual handoff; the queue page surfaces copy-to-clipboard.
    return {
      ok: false,
      error:
        "Social auto-post not configured. Set destination to 'local' on the schedule to silence this and use copy/paste.",
    };
  }
  if (item.kind === "internal_checklist") {
    return publishChecklist(item);
  }
  return { ok: false, error: `Unknown kind: ${item.kind}` };
}

async function publishBlog(
  item: PublishQueueItem,
): Promise<{ ok: true; ref?: string } | { ok: false; error: string }> {
  const { getClientWpCreds, createWpPost } = await import("./wp-bridge");
  const creds = await getClientWpCreds(item.clientId);
  if (!creds) {
    return {
      ok: false,
      error: "WordPress not connected for this client. Set it up under Settings → WordPress.",
    };
  }
  const payload = (item.payloadJson ?? {}) as {
    metaDescription?: string;
    excerpt?: string;
  };
  // Look up the schedule to decide draft vs publish. If the schedule is
  // gone (orphaned queue item), default to draft — safer.
  let status: "draft" | "publish" = "draft";
  if (item.scheduleId) {
    const [s] = await db
      .select()
      .from(dailySchedules)
      .where(eq(dailySchedules.id, item.scheduleId))
      .limit(1);
    if (s?.autoPublish) status = "publish";
  }
  const r = await createWpPost(creds, {
    title: item.title ?? "Untitled",
    content: item.body ?? "",
    excerpt: payload.excerpt,
    metaDescription: payload.metaDescription,
    status,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, ref: r.url };
}

/** `example.com/` → `https://example.com/`; null when it isn't a usable URL. */
export function toAbsoluteHttpsUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

async function publishGbp(
  item: PublishQueueItem,
): Promise<{ ok: true; ref?: string } | { ok: false; error: string }> {
  // The client's chosen listing (GBP → client → Reviews, "Which listing")
  // is the default. A valid per-schedule value overrides it; anything
  // else typed into that field — a business name, say — is ignored
  // rather than sent to Google as a URL path (issue #43).
  const { createGbpLocalPost, isGbpLocationName } = await import("./gbp-api");
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, item.clientId))
    .limit(1);
  let locationName: string | null = isGbpLocationName(client?.gbpLocationName)
    ? client.gbpLocationName
    : null;
  if (item.scheduleId) {
    const [s] = await db
      .select()
      .from(dailySchedules)
      .where(eq(dailySchedules.id, item.scheduleId))
      .limit(1);
    const cfg = (s?.configJson ?? {}) as Record<string, unknown>;
    const override = cfg.gbp_location_name;
    if (typeof override === "string" && isGbpLocationName(override)) {
      locationName = override;
    }
  }
  if (!locationName) {
    return {
      ok: false,
      error:
        'No Business Profile listing chosen for this client. Open GBP → this client → Reviews and pick it under "Which listing", then press Retry publish.',
    };
  }
  const payload = (item.payloadJson ?? {}) as {
    callToAction?: string | null;
    postType?: string;
    /** Product posts link the button to the product, not the homepage */
    ctaUrl?: string | null;
    mediaUrl?: string | null;
    offerTitle?: string;
    couponCode?: string;
  };
  const actionType =
    payload.callToAction && payload.callToAction !== ""
      ? (payload.callToAction as
          | "BOOK"
          | "ORDER"
          | "SHOP"
          | "LEARN_MORE"
          | "SIGN_UP"
          | "CALL")
      : null;
  // Google rejects every action type except CALL without a url, so the
  // button links to the product (when there is one) or the client's site.
  // No url → no button.
  const ctaUrl =
    toAbsoluteHttpsUrl(payload.ctaUrl) ?? toAbsoluteHttpsUrl(client?.url);
  const cta = !actionType
    ? undefined
    : actionType === "CALL"
      ? { actionType }
      : ctaUrl
        ? { actionType, url: ctaUrl }
        : undefined;
  // OFFER posts carry the link as "View offer" (redeemOnlineUrl) instead
  // of a button; they run for a week from today. EVENT isn't supported
  // (needs real dates), so it goes out as STANDARD.
  const isOffer = payload.postType === "OFFER" && Boolean(ctaUrl);
  const start = new Date();
  const r = await createGbpLocalPost({
    locationName,
    summary: item.body ?? "",
    callToAction: isOffer ? undefined : cta,
    topicType: isOffer ? "OFFER" : "STANDARD",
    offer: isOffer
      ? {
          title: payload.offerTitle || item.title || client?.name || "Offer",
          redeemOnlineUrl: ctaUrl!,
          startDate: start,
          endDate: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000),
          couponCode: payload.couponCode || undefined,
        }
      : undefined,
    mediaUrl: toAbsoluteHttpsUrl(payload.mediaUrl) ?? undefined,
    languageCode: client?.language ?? undefined,
    clientIdScope: item.clientId,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, ref: r.postName };
}

async function publishChecklist(
  item: PublishQueueItem,
): Promise<{ ok: true; ref?: string } | { ok: false; error: string }> {
  const payload = (item.payloadJson ?? {}) as {
    items?: { title: string; why?: string }[];
  };
  const items = payload.items ?? [];
  if (items.length === 0) {
    return { ok: false, error: "No checklist items in payload." };
  }
  const rows = items.map((i) => ({
    clientId: item.clientId,
    title: i.title.slice(0, 200),
    whyItMatters: (i.why ?? "").slice(0, 500),
    priority: "medium" as const,
    status: "todo" as const,
  }));
  await db.insert(tasks).values(rows);
  return { ok: true, ref: `${items.length} tasks` };
}
