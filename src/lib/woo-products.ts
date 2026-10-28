/**
 * Read a client's WooCommerce catalogue through the public Store API
 * (`/wp-json/wc/store/v1/products`). No keys and no bridge plugin needed —
 * it is the same endpoint the shop's own cart blocks use.
 *
 * Used by GBP product posts and product blog drafts: pick products, show
 * their photos, link the buttons to their pages.
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
  /** Formatted pre-sale price when the product is on sale */
  regularPrice: string | null;
  onSale: boolean;
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

function formatPrice(
  p?: {
    currency_code?: string;
    currency_minor_unit?: number;
  },
  amount?: string,
): string | null {
  if (!p || !amount) return null;
  const minor = p.currency_minor_unit ?? 2;
  const value = Number(amount) / 10 ** minor;
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: minor })} ${p.currency_code ?? ""}`.trim();
}

/**
 * In-stock products, most popular first (or newest first with
 * `orderby: "date"`). Throws when the site has no WooCommerce Store API
 * (plain WordPress, or WooCommerce < 7.6).
 */
export async function listWooProducts(
  siteUrl: string,
  opts: { perPage?: number; orderby?: "popularity" | "date" } = {},
): Promise<WooProduct[]> {
  const base = siteUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    per_page: String(opts.perPage ?? 50),
    orderby: opts.orderby ?? "popularity",
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
    on_sale?: boolean;
    prices?: {
      price?: string;
      regular_price?: string;
      currency_code?: string;
      currency_minor_unit?: number;
    };
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
      price: formatPrice(p.prices, p.prices?.price),
      regularPrice: p.on_sale
        ? formatPrice(p.prices, p.prices?.regular_price)
        : null,
      onSale: Boolean(p.on_sale),
      imageUrl: p.images?.[0]?.src ?? null,
    }));
}
