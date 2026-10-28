/**
 * Google Business Profile API — official, free. Requires the user to
 * connect Google with the `business.manage` scope (asked at OAuth time
 * if they want to manage GBP). Returns canonical, write-back-capable data
 * the public scraper can never match.
 *
 * Docs: https://developers.google.com/my-business
 *
 * Endpoints used:
 *   - mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   - mybusinessbusinessinformation.googleapis.com/v1/{name}/locations
 *   - mybusiness.googleapis.com/v4/{name}/reviews          (legacy v4 still required for reviews)
 *
 * The scope `https://www.googleapis.com/auth/business.manage` MUST be
 * granted — if it isn't, calls will return 403. We fall back to the
 * existing scraper in that case, so users without GBP access still see
 * data on the page.
 */

import { getAccessToken } from "./google-oauth";

export type GbpAccount = {
  /** "accounts/12345" */
  name: string;
  accountName: string;
  type: string;
};

export type GbpLocation = {
  /** "accounts/12345/locations/67890" */
  name: string;
  title: string;
  storefrontAddress: {
    addressLines: string[];
    locality: string;
    administrativeArea: string;
    postalCode: string;
    regionCode: string;
  } | null;
  websiteUri: string | null;
  primaryPhone: string | null;
  primaryCategory: string | null;
  rating: number | null;
  reviewCount: number | null;
};

export type GbpReview = {
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl?: string };
  starRating: 1 | 2 | 3 | 4 | 5 | null;
  comment: string | null;
  createTime: string;
  updateTime: string;
  reply: { comment: string; updateTime: string } | null;
};

/**
 * Business Information v1 names a location `locations/{id}`; the v4
 * endpoints (localPosts, reviews) need `accounts/{a}/locations/{id}`.
 * The full v4 form is what gets stored and passed around everywhere —
 * a business name typed into a free-text field (issue #43) produced
 * `POST /v4/Mono Web/localPosts` and Google's HTML 404 page.
 */
export const GBP_LOCATION_NAME_RE = /^accounts\/[^/\s]+\/locations\/[^/\s]+$/;

export function isGbpLocationName(
  name: string | null | undefined,
): name is string {
  return typeof name === "string" && GBP_LOCATION_NAME_RE.test(name);
}

/** `accounts/A/locations/L` → `locations/L`, for the v1 endpoints. */
export function toV1LocationName(name: string): string {
  return name.replace(/^accounts\/[^/]+\//, "");
}

/** v1 `locations/L` under account `accounts/A` → `accounts/A/locations/L`. */
export function toV4LocationName(name: string, accountName: string): string {
  if (!name) return "";
  return name.startsWith("accounts/") ? name : `${accountName}/${name}`;
}

/**
 * Fit a post into Google's 1500-character summary limit without cutting
 * a word in half: end at the last sentence break, else the last space.
 */
export function trimGbpSummary(text: string, max = 1500): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const sentenceEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf("\n"),
  );
  // A break in the first half would throw away too much — use a space.
  if (sentenceEnd > max / 2) return head.slice(0, sentenceEnd + 1).trim();
  const space = head.lastIndexOf(" ");
  return (space > 0 ? head.slice(0, space) : head).trim();
}

/**
 * Turn a failed Google API response body into one readable sentence.
 *
 * Google's front end answers a bad path with a full HTML page, which used
 * to be stored verbatim as the queue item's error.
 */
export function describeGbpApiError(
  status: number,
  statusText: string,
  body: string,
  locationName: string,
): string {
  if (body.trimStart().startsWith("<")) {
    return status === 404
      ? `Google API 404 for ${locationName}: the location doesn't exist, or this Google account can't manage it. Re-pick the listing on the client's GBP → Reviews page.`
      : `Google API ${status} ${statusText}`.trim();
  }
  let message = body.slice(0, 300) || statusText;
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    if (j.error?.message) message = j.error.message;
  } catch {
    // not JSON — keep the raw (truncated) text
  }
  return `Google API ${status}: ${message}`;
}

/**
 * An expired or revoked refresh token surfaces as `invalid_grant`. On a
 * Google Cloud consent screen left in "Testing", refresh tokens expire
 * after 7 days, which is the usual cause.
 */
export function describeGbpAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid_grant|expired or revoked/i.test(msg)) {
    return "Google sign-in has expired or was revoked. Reconnect Google in Settings → Google. If this keeps happening every 7 days, your Google Cloud consent screen is in \"Testing\" mode; publish it to \"In production\" to get long-lived tokens.";
  }
  return msg;
}

export class GbpScopeMissingError extends Error {
  constructor() {
    super(
      "Google Business Profile scope not granted. Reconnect Google with the business.manage scope.",
    );
    this.name = "GbpScopeMissingError";
  }
}

/**
 * List the GBP accounts the connected Google identity manages. An "account"
 * is a top-level container — businesses with multiple locations all live
 * under one account.
 */
export async function listGbpAccounts(opts?: {
  clientIdScope?: number;
}): Promise<GbpAccount[]> {
  const token = await getAccessToken(opts?.clientIdScope);
  const res = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=50",
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 403) throw new GbpScopeMissingError();
  if (!res.ok) {
    throw new Error(`GBP accounts list failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    accounts?: Array<{ name: string; accountName: string; type: string }>;
  };
  return data.accounts ?? [];
}

/**
 * Locations under an account. Includes basic info, no reviews. Reviews
 * require a second call per location.
 */
export async function listGbpLocations(opts: {
  accountName: string;
  clientIdScope?: number;
}): Promise<GbpLocation[]> {
  const token = await getAccessToken(opts.clientIdScope);
  // readMask drives which fields come back — we ask for everything we render
  const params = new URLSearchParams({
    pageSize: "100",
    readMask:
      "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,metadata",
  });
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${opts.accountName}/locations?${params}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 403) throw new GbpScopeMissingError();
  if (!res.ok) {
    throw new Error(`GBP locations list failed: ${res.status}`);
  }
  type RawLoc = {
    name?: string;
    title?: string;
    storefrontAddress?: GbpLocation["storefrontAddress"];
    websiteUri?: string;
    phoneNumbers?: { primaryPhone?: string };
    categories?: { primaryCategory?: { displayName?: string } };
  };
  const data = (await res.json()) as { locations?: RawLoc[] };
  return (data.locations ?? []).map((l) => ({
    // v1 answers `locations/L`; prefix the account so the v4 endpoints
    // (posts, reviews) accept it.
    name: toV4LocationName(l.name ?? "", opts.accountName),
    title: l.title ?? "",
    storefrontAddress: l.storefrontAddress ?? null,
    websiteUri: l.websiteUri ?? null,
    primaryPhone: l.phoneNumbers?.primaryPhone ?? null,
    primaryCategory: l.categories?.primaryCategory?.displayName ?? null,
    rating: null, // not in the readMask we requested; fetch separately if needed
    reviewCount: null,
  }));
}

const STAR_RATING_MAP: Record<string, 1 | 2 | 3 | 4 | 5> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

/**
 * Reviews for a location. The legacy v4 endpoint is still the only one
 * exposing reviews — Google has been "migrating" this for years.
 */
export async function listGbpReviews(opts: {
  /** Format: accounts/{id}/locations/{id} */
  locationName: string;
  pageSize?: number;
  clientIdScope?: number;
  /** Continue a previous page. Returned as `nextPageToken`. */
  pageToken?: string;
}): Promise<GbpReview[]> {
  return (await listGbpReviewPage(opts)).reviews;
}

/**
 * One page of reviews, plus the token for the next.
 *
 * Split out because "did we see every review" is a question with real
 * consequences: a sync that marks unseen reviews as deleted must know
 * whether it reached the end, or it will mark everything past the first
 * fifty as gone.
 */
export async function listGbpReviewPage(opts: {
  locationName: string;
  pageSize?: number;
  clientIdScope?: number;
  pageToken?: string;
}): Promise<{
  reviews: GbpReview[];
  nextPageToken: string | null;
  averageRating: number | null;
  totalReviewCount: number | null;
}> {
  const token = await getAccessToken(opts.clientIdScope);
  const params = new URLSearchParams({ pageSize: String(opts.pageSize ?? 50) });
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const url = `https://mybusiness.googleapis.com/v4/${opts.locationName}/reviews?${params}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 403) throw new GbpScopeMissingError();
  if (!res.ok) {
    throw new Error(`GBP reviews fetch failed: ${res.status}`);
  }
  type RawReview = {
    reviewId?: string;
    reviewer?: { displayName?: string; profilePhotoUrl?: string };
    starRating?: string;
    comment?: string;
    createTime?: string;
    updateTime?: string;
    reviewReply?: { comment?: string; updateTime?: string };
  };
  const data = (await res.json()) as {
    reviews?: RawReview[];
    nextPageToken?: string;
    averageRating?: number;
    totalReviewCount?: number;
  };
  const reviews = (data.reviews ?? []).map((r) => ({
    reviewId: r.reviewId ?? "",
    reviewer: {
      displayName: r.reviewer?.displayName ?? "Anonymous",
      profilePhotoUrl: r.reviewer?.profilePhotoUrl,
    },
    starRating: r.starRating ? STAR_RATING_MAP[r.starRating] ?? null : null,
    comment: r.comment ?? null,
    createTime: r.createTime ?? "",
    updateTime: r.updateTime ?? "",
    reply: r.reviewReply
      ? {
          comment: r.reviewReply.comment ?? "",
          updateTime: r.reviewReply.updateTime ?? "",
        }
      : null,
  }));
  return {
    reviews,
    nextPageToken: data.nextPageToken ?? null,
    averageRating: data.averageRating ?? null,
    totalReviewCount: data.totalReviewCount ?? null,
  };
}

/**
 * Every review on a location, paged to the end.
 *
 * `complete` says whether it really got to the end. It is false when the
 * page cap was hit, and the sync uses it to decide whether it is allowed
 * to mark anything as deleted — the difference between "this review is
 * gone" and "I stopped reading" is the whole queue.
 */
export async function fetchAllGbpReviews(opts: {
  locationName: string;
  clientIdScope?: number;
  /** Safety stop. 20 pages of 50 is a thousand reviews. */
  maxPages?: number;
}): Promise<{
  reviews: GbpReview[];
  complete: boolean;
  averageRating: number | null;
  totalReviewCount: number | null;
}> {
  const maxPages = opts.maxPages ?? 20;
  const all: GbpReview[] = [];
  let pageToken: string | undefined;
  let averageRating: number | null = null;
  let totalReviewCount: number | null = null;

  for (let page = 0; page < maxPages; page++) {
    const res = await listGbpReviewPage({ ...opts, pageSize: 50, pageToken });
    all.push(...res.reviews);
    averageRating ??= res.averageRating;
    totalReviewCount ??= res.totalReviewCount;
    if (!res.nextPageToken) {
      return { reviews: all, complete: true, averageRating, totalReviewCount };
    }
    pageToken = res.nextPageToken;
  }
  return { reviews: all, complete: false, averageRating, totalReviewCount };
}

/**
 * Reply to a review (write-back). The reply replaces any prior reply.
 */
export async function replyToGbpReview(opts: {
  reviewName: string; // accounts/{id}/locations/{id}/reviews/{id}
  comment: string;
  clientIdScope?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken(opts.clientIdScope);
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${opts.reviewName}/reply`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ comment: opts.comment }),
    },
  );
  if (res.status === 403) {
    return {
      ok: false,
      error: "GBP scope not granted. Reconnect Google with business.manage.",
    };
  }
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `${res.status}: ${body.slice(0, 200)}` };
  }
  return { ok: true };
}

/**
 * Convenience: pull the canonical location summary (locations.list returns
 * one row that matches our scraper's shape, so callers can swap one for
 * the other without reshaping data).
 */
export async function fetchGbpLocationSummary(opts: {
  locationName: string;
  clientIdScope?: number;
}): Promise<GbpLocation | null> {
  const token = await getAccessToken(opts.clientIdScope);
  const params = new URLSearchParams({
    readMask:
      "name,title,storefrontAddress,websiteUri,phoneNumbers,categories",
  });
  const res = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${toV1LocationName(opts.locationName)}?${params}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (res.status === 403) throw new GbpScopeMissingError();
  if (!res.ok) return null;
  type Raw = {
    name?: string;
    title?: string;
    storefrontAddress?: GbpLocation["storefrontAddress"];
    websiteUri?: string;
    phoneNumbers?: { primaryPhone?: string };
    categories?: { primaryCategory?: { displayName?: string } };
  };
  const l = (await res.json()) as Raw;
  return {
    name: opts.locationName,
    title: l.title ?? "",
    storefrontAddress: l.storefrontAddress ?? null,
    websiteUri: l.websiteUri ?? null,
    primaryPhone: l.phoneNumbers?.primaryPhone ?? null,
    primaryCategory: l.categories?.primaryCategory?.displayName ?? null,
    rating: null,
    reviewCount: null,
  };
}



/**
 * Create a Google Business Profile local post. Used by the daily-
 * automation publish step when a gbp_post queue item is approved.
 *
 * Endpoint: mybusiness.googleapis.com/v4/{locationName}/localPosts
 * (the v4 API is still the only public surface for posts in 2026)
 *
 * `summary` is the post body, capped at 1500 chars by Google. The
 * helper truncates rather than rejects.
 */
export async function createGbpLocalPost(opts: {
  locationName: string;
  summary: string;
  callToAction?: {
    actionType:
      | "BOOK"
      | "ORDER"
      | "SHOP"
      | "LEARN_MORE"
      | "SIGN_UP"
      | "CALL";
    url?: string;
  };
  mediaUrl?: string;
  /** EVENT needs fields we don't collect, so only STANDARD and OFFER */
  topicType?: "STANDARD" | "OFFER";
  /** Required with topicType OFFER: Google shows it as "View offer" */
  offer?: {
    title: string;
    redeemOnlineUrl: string;
    startDate: Date;
    endDate: Date;
    couponCode?: string;
    termsConditions?: string;
  };
  /** BCP-47 language of the post; defaults to English. */
  languageCode?: string;
  clientIdScope?: number;
}): Promise<
  | { ok: true; postName: string; searchUrl: string | null }
  | { ok: false; error: string }
> {
  if (!isGbpLocationName(opts.locationName)) {
    return {
      ok: false,
      error: `Invalid GBP location "${opts.locationName}". Expected accounts/…/locations/… — pick the listing on the client's GBP → Reviews page.`,
    };
  }
  let token: string;
  try {
    token = await getAccessToken(opts.clientIdScope);
  } catch (err) {
    return { ok: false, error: describeGbpAuthError(err) };
  }
  const summary = trimGbpSummary(opts.summary);

  const body: Record<string, unknown> = {
    languageCode: opts.languageCode?.trim() || "en",
    summary,
    // EVENT needs fields (dates) the schedule editor doesn't collect, so
    // only STANDARD and OFFER (product posts) are sent.
    topicType: opts.topicType === "OFFER" && opts.offer ? "OFFER" : "STANDARD",
  };
  if (opts.topicType === "OFFER" && opts.offer) {
    const ymd = (d: Date) => ({
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    });
    // Offer title is capped at 58 chars by Google
    body.event = {
      title: opts.offer.title.slice(0, 58),
      schedule: {
        startDate: ymd(opts.offer.startDate),
        endDate: ymd(opts.offer.endDate),
      },
    };
    body.offer = {
      redeemOnlineUrl: opts.offer.redeemOnlineUrl,
      ...(opts.offer.couponCode ? { couponCode: opts.offer.couponCode } : {}),
      ...(opts.offer.termsConditions
        ? { termsConditions: opts.offer.termsConditions }
        : {}),
    };
  }
  // Every actionType but CALL needs a url, or Google 400s the whole post.
  // Offers carry their link in offer.redeemOnlineUrl instead of a button.
  if (
    body.topicType !== "OFFER" &&
    opts.callToAction &&
    (opts.callToAction.actionType === "CALL" || opts.callToAction.url)
  ) {
    body.callToAction = opts.callToAction;
  }
  if (opts.mediaUrl) {
    body.media = [{ mediaFormat: "PHOTO", sourceUrl: opts.mediaUrl }];
  }

  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${opts.locationName}/localPosts`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 403) {
    return {
      ok: false,
      error:
        "GBP scope missing — reconnect Google with business.manage scope.",
    };
  }
  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      error: describeGbpApiError(
        res.status,
        res.statusText,
        text,
        opts.locationName,
      ),
    };
  }
  type Resp = { name?: string; searchUrl?: string };
  const data = (await res.json()) as Resp;
  return {
    ok: true,
    postName: data.name ?? "",
    searchUrl: data.searchUrl ?? null,
  };
}
