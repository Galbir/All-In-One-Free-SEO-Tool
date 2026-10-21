/**
 * Read a client's WooCommerce catalogue through the public Store API
 * (`/wp-json/wc/store/v1/products`). No keys and no bridge plugin needed —
 * it is the same endpoint the shop's own cart blocks use.
 *
 * Used by GBP product posts: pick a product, show its photo, link the
 * "Shop" button to its page.
 */

import { guardedFetch } from "./url-guard";

export type WooProduct = {
  id: number;
  name: string;
  permalink: string;
  /** Plain text, HTML stripped */
  shortDescription: string;
  /** Formatted, e.g. "149 RON"; null when the shop hides prices */
  price: string | null;
  imageUrl: string | null;
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrice(p?: {
  price?: string;
  currency_code?: string;
  currency_minor_unit?: number;
}): string | null {
  if (!p?.price) return null;
  const minor = p.currency_minor_unit ?? 2;
  const value = Number(p.price) / 10 ** minor;
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value.toLocaleString("ro-RO", { maximumFractionDigits: minor })} ${p.currency_code ?? ""}`.trim();
}

/**
 * In-stock products, most popular first. Throws when the site has no
 * WooCommerce Store API (plain WordPress, or WooCommerce < 7.6).
 */
export async function listWooProducts(
  siteUrl: string,
  opts: { perPage?: number } = {},
): Promise<WooProduct[]> {
  const base = siteUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    per_page: String(opts.perPage ?? 50),
    orderby: "popularity",
    order: "desc",
    stock_status: "instock",
  });
  const res = await guardedFetch(`${base}/wp-json/wc/store/v1/products?${params}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(
      `WooCommerce products not reachable at ${base} (HTTP ${res.status}). Is WooCommerce installed and the site public?`,
    );
  }
  type Raw = {
    id: number;
    name?: string;
    permalink?: string;
    short_description?: string;
    description?: string;
    prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
    images?: { src?: string }[];
  };
  const data = (await res.json()) as Raw[];
  if (!Array.isArray(data)) return [];
  return data
    .filter((p) => p.id && p.name && p.permalink)
    .map((p) => ({
      id: p.id,
      name: stripHtml(p.name ?? ""),
      permalink: p.permalink ?? "",
      shortDescription: stripHtml(p.short_description || p.description || "").slice(0, 600),
      price: formatPrice(p.prices),
      imageUrl: p.images?.[0]?.src ?? null,
    }));
}
