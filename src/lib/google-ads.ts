import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { clients, keywords } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import { getAccessToken } from "@/lib/google-oauth";
import { getSetting, setSetting } from "@/lib/settings-store";

/**
 * Google Ads Keyword Planner.
 *
 * The Google Ads API is free. It needs a Google Ads account (a manager
 * account is fine), a developer token and the `adwords` OAuth scope. The
 * token and customer ids are pasted in Settings → Google; the OAuth
 * grant reuses the Google connection already used for Search Console.
 *
 * Accounts that do not spend on ads get volume ranges ("1K-10K") rather
 * than exact numbers, which Google returns as the bucket's lower bound.
 * That is still enough to rank ideas against each other.
 */

/**
 * The Ads API retires versions about a year after release, so this is
 * overridable from Settings instead of being baked in.
 */
export const DEFAULT_ADS_API_VERSION = "v22";

export type AdsConfig = {
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  apiVersion: string;
};

export type KeywordIdea = {
  text: string;
  /** Average monthly searches over the last 12 months. */
  volume: number;
  competition: "LOW" | "MEDIUM" | "HIGH" | null;
  /** 0-100, how many advertisers bid on it. */
  competitionIndex: number | null;
  /** Top of page bid range in the account currency, null when unknown. */
  lowBid: number | null;
  highBid: number | null;
};

/** Google ids for `geoTargetConstants/<id>`, keyed by ISO country code. */
export const GEO_TARGETS: Record<string, number> = {
  US: 2840,
  GB: 2826,
  UK: 2826,
  CA: 2124,
  AU: 2036,
  IE: 2372,
  DE: 2276,
  FR: 2250,
  ES: 2724,
  IT: 2380,
  NL: 2528,
  PL: 2616,
  RO: 2642,
  BR: 2076,
  MX: 2484,
  IN: 2356,
};

/** Google ids for `languageConstants/<id>`, keyed by ISO 639-1 code. */
export const LANGUAGE_IDS: Record<string, number> = {
  en: 1000,
  de: 1001,
  fr: 1002,
  es: 1003,
  it: 1004,
  ja: 1005,
  da: 1009,
  nl: 1010,
  fi: 1011,
  ko: 1012,
  no: 1013,
  pt: 1014,
  sv: 1015,
  zh: 1017,
  pl: 1030,
  ru: 1031,
  tr: 1037,
  ro: 1040,
};

export function geoTargetFor(country: string | null | undefined): string {
  const id = GEO_TARGETS[(country ?? "US").toUpperCase()] ?? GEO_TARGETS.US;
  return `geoTargetConstants/${id}`;
}

export function languageFor(language: string | null | undefined): string {
  const code = (language ?? "en").toLowerCase().split(/[-_]/)[0];
  return `languageConstants/${LANGUAGE_IDS[code] ?? LANGUAGE_IDS.en}`;
}

/** Customer ids are written "123-456-7890" in the Ads UI; the API wants digits. */
export function normalizeCustomerId(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === 10 ? digits : null;
}

function num(v: unknown): number | null {
  // REST returns int64 values as strings.
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse a `generateKeywordIdeas` / `generateKeywordHistoricalMetrics` response. */
export function parseKeywordIdeas(json: unknown): KeywordIdea[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: KeywordIdea[] = [];
  for (const raw of results) {
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;
    const m = (r.keywordIdeaMetrics ?? r.keywordMetrics ?? {}) as Record<
      string,
      unknown
    >;
    const comp = m.competition;
    const low = num(m.lowTopOfPageBidMicros);
    const high = num(m.highTopOfPageBidMicros);
    out.push({
      text,
      volume: num(m.avgMonthlySearches) ?? 0,
      competition:
        comp === "LOW" || comp === "MEDIUM" || comp === "HIGH" ? comp : null,
      competitionIndex: num(m.competitionIndex),
      lowBid: low === null ? null : low / 1_000_000,
      highBid: high === null ? null : high / 1_000_000,
    });
  }
  return out;
}

/**
 * Order ideas by how worth writing about they are: plenty of searches,
 * few advertisers fighting over them. Ideas below `minVolume`, longer
 * than `maxWords` or in `exclude` are dropped.
 */
export function rankIdeas(
  ideas: KeywordIdea[],
  opts: { exclude?: Iterable<string>; minVolume?: number; maxWords?: number } = {},
): KeywordIdea[] {
  const exclude = new Set(
    [...(opts.exclude ?? [])].map((k) => k.trim().toLowerCase()),
  );
  const minVolume = opts.minVolume ?? 50;
  const maxWords = opts.maxWords ?? 6;
  const seen = new Set<string>();
  const score = (i: KeywordIdea) =>
    Math.log10(i.volume + 1) * (1 - 0.6 * ((i.competitionIndex ?? 50) / 100));
  return ideas
    .filter((i) => {
      const key = i.text.toLowerCase();
      if (seen.has(key) || exclude.has(key)) return false;
      seen.add(key);
      return (
        i.volume >= minVolume && i.text.split(/\s+/).length <= maxWords
      );
    })
    .sort((a, b) => score(b) - score(a));
}

export async function getAdsConfig(): Promise<AdsConfig | null> {
  const [tokenRaw, customer, login, version] = await Promise.all([
    getSetting<string>("google_ads.developer_token"),
    getSetting<string>("google_ads.customer_id"),
    getSetting<string>("google_ads.login_customer_id"),
    getSetting<string>("google_ads.api_version"),
  ]);
  const developerToken = tokenRaw ? decrypt(tokenRaw) : null;
  const customerId = normalizeCustomerId(customer);
  if (!developerToken || !customerId) return null;
  return {
    developerToken,
    customerId,
    loginCustomerId: normalizeCustomerId(login),
    apiVersion: version?.trim() || DEFAULT_ADS_API_VERSION,
  };
}

export type AdsStatus = {
  hasToken: boolean;
  customerId: string | null;
  loginCustomerId: string | null;
  apiVersion: string;
  authorized: boolean;
  /** Token, customer id and the adwords consent are all in place. */
  ready: boolean;
};

export async function getAdsStatus(): Promise<AdsStatus> {
  const [token, customer, login, version, authorized] = await Promise.all([
    getSetting<string>("google_ads.developer_token"),
    getSetting<string>("google_ads.customer_id"),
    getSetting<string>("google_ads.login_customer_id"),
    getSetting<string>("google_ads.api_version"),
    getSetting<boolean>("google_ads.authorized"),
  ]);
  const customerId = normalizeCustomerId(customer);
  return {
    hasToken: Boolean(token),
    customerId,
    loginCustomerId: normalizeCustomerId(login),
    apiVersion: version?.trim() || DEFAULT_ADS_API_VERSION,
    authorized: Boolean(authorized),
    ready: Boolean(token && customerId && authorized),
  };
}

async function adsPost(
  cfg: AdsConfig,
  method: string,
  body: Record<string, unknown>,
  clientId?: number,
): Promise<unknown> {
  const accessToken = await getAccessToken(clientId);
  const res = await fetch(
    `https://googleads.googleapis.com/${cfg.apiVersion}/customers/${cfg.customerId}:${method}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "developer-token": cfg.developerToken,
        "content-type": "application/json",
        ...(cfg.loginCustomerId
          ? { "login-customer-id": cfg.loginCustomerId }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      // keep the raw text
    }
    throw new Error(`Google Ads ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as unknown;
}

/** Keyword ideas for some seed keywords and/or a site, in one market. */
export async function generateKeywordIdeas(opts: {
  seeds?: string[];
  url?: string;
  country?: string | null;
  language?: string | null;
  limit?: number;
}): Promise<KeywordIdea[]> {
  const cfg = await getAdsConfig();
  if (!cfg) throw new Error("Google Ads is not configured (Settings → Google).");
  const seeds = (opts.seeds ?? []).filter(Boolean).slice(0, 20);
  if (seeds.length === 0 && !opts.url) {
    throw new Error("Give at least one seed keyword or a URL.");
  }
  const body: Record<string, unknown> = {
    language: languageFor(opts.language),
    geoTargetConstants: [geoTargetFor(opts.country)],
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
    pageSize: Math.min(opts.limit ?? 300, 1000),
  };
  if (seeds.length > 0 && opts.url) {
    body.keywordAndUrlSeed = { url: opts.url, keywords: seeds };
  } else if (seeds.length > 0) {
    body.keywordSeed = { keywords: seeds };
  } else {
    body.urlSeed = { url: opts.url };
  }
  return parseKeywordIdeas(await adsPost(cfg, "generateKeywordIdeas", body));
}

/** Exact volume figures for keywords you already have. */
export async function keywordMetrics(opts: {
  keywords: string[];
  country?: string | null;
  language?: string | null;
}): Promise<KeywordIdea[]> {
  const cfg = await getAdsConfig();
  if (!cfg) throw new Error("Google Ads is not configured (Settings → Google).");
  return parseKeywordIdeas(
    await adsPost(cfg, "generateKeywordHistoricalMetrics", {
      keywords: opts.keywords.slice(0, 1000),
      language: languageFor(opts.language),
      geoTargetConstants: [geoTargetFor(opts.country)],
      keywordPlanNetwork: "GOOGLE_SEARCH",
    }),
  );
}

const CACHE_MS = 24 * 60 * 60 * 1000;

type CachedIdeas = { at: number; ideas: KeywordIdea[] };

/**
 * Ranked planner ideas for one client: seeded by the client's site and
 * tracked keywords, in the client's country and language, minus what is
 * already tracked. Cached for a day so scheduled runs do not each cost
 * an API call.
 */
export async function discoverClientKeywords(
  clientId: number,
  opts: { refresh?: boolean; limit?: number } = {},
): Promise<KeywordIdea[]> {
  const cacheKey = `google_ads.ideas.${clientId}` as const;
  if (!opts.refresh) {
    const cached = await getSetting<CachedIdeas>(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      return cached.ideas.slice(0, opts.limit ?? 50);
    }
  }
  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return [];
  const tracked = await db
    .select({ query: keywords.query })
    .from(keywords)
    .where(eq(keywords.clientId, clientId));
  const trackedTexts = tracked.map((k) => k.query);
  const raw = await generateKeywordIdeas({
    seeds: trackedTexts.slice(0, 5),
    url: client.url,
    country: client.country,
    language: client.language,
  });
  const ranked = rankIdeas(raw, { exclude: trackedTexts }).slice(0, 100);
  await setSetting(cacheKey, { at: Date.now(), ideas: ranked });
  return ranked.slice(0, opts.limit ?? 50);
}

const USED_KEEP = 60;

/**
 * Pick the next keywords to write about: the best-ranked ideas not used
 * in a recent run, so a daily blog schedule walks down the list instead
 * of repeating itself. Returns [] when Ads is not usable, so callers
 * can fall back to the tracked keywords.
 */
export async function pickPlannerKeywords(
  clientId: number,
  count = 2,
): Promise<string[]> {
  try {
    const status = await getAdsStatus();
    if (!status.ready) return [];
    const ideas = await discoverClientKeywords(clientId);
    const usedKey = `google_ads.used.${clientId}` as const;
    const used = (await getSetting<string[]>(usedKey)) ?? [];
    const usedSet = new Set(used.map((u) => u.toLowerCase()));
    let picks = ideas.filter((i) => !usedSet.has(i.text.toLowerCase()));
    // Every idea used once: start over from the best.
    if (picks.length === 0) picks = ideas;
    const chosen = picks.slice(0, count).map((i) => i.text);
    if (chosen.length > 0) {
      await setSetting(usedKey, [...chosen, ...used].slice(0, USED_KEEP));
    }
    return chosen;
  } catch (err) {
    console.warn(
      `[google-ads] planner keywords failed for client ${clientId}: ${(err as Error).message}`,
    );
    return [];
  }
}

/** Start tracking planner ideas. Returns how many were new. */
export async function trackKeywords(
  clientId: number,
  texts: string[],
): Promise<number> {
  const [client] = await db
    .select({ country: clients.country, language: clients.language })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) return 0;
  let added = 0;
  for (const text of texts) {
    const query = text.trim().toLowerCase();
    if (!query) continue;
    const [dupe] = await db
      .select({ id: keywords.id })
      .from(keywords)
      .where(and(eq(keywords.clientId, clientId), eq(keywords.query, query)))
      .limit(1);
    if (dupe) continue;
    await db.insert(keywords).values({
      clientId,
      query,
      country: client.country ?? "US",
      language: client.language ?? "en",
      source: "planner",
    });
    added++;
  }
  return added;
}
