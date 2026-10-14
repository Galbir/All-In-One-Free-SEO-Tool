/**
 * Generate src/lib/countries.ts — every country a search engine will
 * accept, with the name spelled the way English speakers spell it.
 *
 * WHY GENERATED
 *
 * The list was written by hand in three different files, and they had
 * drifted: 48 entries in the onboarding picker, 36 in the rank-where
 * tool, and 8 in keyword research. A user filed an issue asking how to
 * add more countries, because the screen they happened to use offered
 * eight. Worse, two of the three spelled the United Kingdom "GB" and
 * the third spelled it "UK", so the same country produced two different
 * codes depending on which screen you came from.
 *
 * Names come from ICU, through Intl.DisplayNames, rather than being
 * typed out 250 times. Typing them is how you end up with "Korea,
 * Republic of" next to "South Korea" and nobody noticing.
 *
 *   node scripts/gen-countries.mjs
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "countries.ts");

/**
 * ICU knows 280 "regions". These are the ones that are not countries a
 * person targets, and each would be a confusing or duplicate choice:
 *
 *   UK  — an alias of GB. Including both lets two users pick the same
 *         country and get different data. ISO 3166-1 assigns GB; UK is
 *         only exceptionally reserved.
 *   EU, EZ, UN, QO — groupings, not countries.
 *   XA, XB, ZZ — ICU test and placeholder pseudo-regions.
 */
const EXCLUDE = new Set(["UK", "EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

/**
 * Shown first, because these are what people actually pick. Everything
 * else follows alphabetically. Order within this list is deliberate:
 * it roughly follows search volume, not the alphabet.
 */
const POPULAR = [
  "US", "GB", "CA", "AU", "IN", "DE", "FR", "ES", "IT", "NL",
  "BR", "MX", "JP", "SG", "AE", "ZA", "NZ", "IE", "SE", "PL",
];

function build() {
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const all = [];

  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (EXCLUDE.has(code)) continue;
      let name;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      // ICU returns the code itself for anything it does not know.
      if (!name || name === code) continue;
      all.push({ code, name });
    }
  }

  const popular = POPULAR.map((code) => {
    const found = all.find((c) => c.code === code);
    if (!found) throw new Error(`POPULAR lists ${code}, which ICU does not know`);
    return found;
  });
  const rest = all
    .filter((c) => !POPULAR.includes(c.code))
    .sort((x, y) => x.name.localeCompare(y.name));

  const fmt = (list) =>
    list.map((c) => `  { code: ${JSON.stringify(c.code)}, name: ${JSON.stringify(c.name)} },`).join("\n");

  const file = `// GENERATED FILE — do not edit by hand.
// Run \`node scripts/gen-countries.mjs\` to refresh.
//
// ${all.length} countries, named by ICU. See the generator for why this
// is not three hand-written lists any more.

export type Country = { code: string; name: string };

/** What people actually pick, in rough order of search volume. */
export const POPULAR_COUNTRIES: Country[] = [
${fmt(popular)}
];

/** Everything else, alphabetically. */
export const OTHER_COUNTRIES: Country[] = [
${fmt(rest)}
];

/** Every country, popular ones first. */
export const COUNTRIES: Country[] = [...POPULAR_COUNTRIES, ...OTHER_COUNTRIES];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** Is this a country code the search engines will accept? */
export function isCountryCode(code: string | null | undefined): boolean {
  return typeof code === "string" && BY_CODE.has(code.toUpperCase());
}

/**
 * Normalise what a user or an old row gives us.
 *
 * "uk" is the one worth special-casing: it was offered by the keyword
 * research form for a long time, so it is sitting in real databases,
 * and ISO spells the United Kingdom GB.
 */
export function normaliseCountry(code: string | null | undefined): string {
  const upper = String(code ?? "").trim().toUpperCase();
  if (!upper) return "US";
  if (upper === "UK") return "GB";
  return BY_CODE.has(upper) ? upper : "US";
}

/** The display name, or the code back if we do not recognise it. */
export function countryName(code: string): string {
  return BY_CODE.get(normaliseCountry(code))?.name ?? code;
}
`;

  writeFileSync(OUT, file, "utf8");
  process.stdout.write(
    `  Wrote ${all.length} countries (${popular.length} popular) to src/lib/countries.ts\n`,
  );
}

build();
