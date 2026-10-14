import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COUNTRIES,
  POPULAR_COUNTRIES,
  countryName,
  isCountryCode,
  normaliseCountry,
} from "./countries";

/**
 * A user asked how to add more countries, because the keyword research
 * form offered eight. It was one of three hand-written lists — 48 in
 * onboarding, 36 in the rank-where tool, 8 in keyword research — and
 * they disagreed about the United Kingdom: two said GB, one said UK.
 *
 * Since the code goes straight into Google's `gl` parameter and into
 * the keyword rows, the same country recorded under two codes splits a
 * client's rank history in half with nothing to show it happened.
 *
 * One generated list now, and these hold the properties that matter.
 */

const ROOT = process.cwd();

describe("countries", () => {
  it("covers the world, not a shortlist", () => {
    // The complaint was "only 8". Anything in this range is the full
    // ISO set rather than somebody's favourites.
    expect(COUNTRIES.length).toBeGreaterThan(200);
  });

  it("puts the common ones first", () => {
    expect(POPULAR_COUNTRIES[0].code).toBe("US");
    expect(COUNTRIES.slice(0, POPULAR_COUNTRIES.length)).toEqual(POPULAR_COUNTRIES);
  });

  it("has no duplicate codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("spells the United Kingdom GB, and only GB", () => {
    expect(isCountryCode("GB")).toBe(true);
    // Offering both would let two people pick the same country and get
    // two different codes, which is the bug this replaced.
    expect(isCountryCode("UK")).toBe(false);
    expect(countryName("GB")).toBe("United Kingdom");
  });

  it("maps the UK rows already sitting in databases onto GB", () => {
    // The old keyword form wrote "UK", so real installs have it.
    expect(normaliseCountry("UK")).toBe("GB");
    expect(normaliseCountry("uk")).toBe("GB");
  });

  it("falls back to US rather than passing junk to a search engine", () => {
    expect(normaliseCountry("")).toBe("US");
    expect(normaliseCountry(null)).toBe("US");
    expect(normaliseCountry("not-a-country")).toBe("US");
  });

  it("accepts the countries people actually asked about", () => {
    for (const code of ["VN", "NG", "PK", "BD", "PH", "TR", "SA", "EG", "KE", "ID"]) {
      expect(isCountryCode(code), `${code} should be selectable`).toBe(true);
    }
  });

  it("is the only country list left", () => {
    // The whole point. If a screen grows its own list again, the next
    // person to add a country fixes one of them and not the others.
    const files = [
      "src/app/keywords/research-form.tsx",
      "src/app/tools/rank-where/page.tsx",
      "src/app/clients/[id]/onboarding/countries.ts",
    ];
    for (const rel of files) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, rel), "utf8");
      } catch {
        continue; // deleted is fine — that is one fewer list
      }
      const entries = text.match(/\{\s*(?:code|value):\s*"[A-Z]{2}"\s*,\s*(?:label|name):/g) ?? [];
      expect(
        entries.length,
        `${rel} defines its own country list again (${entries.length} entries). ` +
          `Import from "@/lib/countries" instead.`,
      ).toBe(0);
    }
  });
});

describe("search language", () => {
  it("asks for the local language, not English", async () => {
    const { languageForCountry } = await import("./countries");
    expect(languageForCountry("DE")).toBe("de");
    expect(languageForCountry("FR")).toBe("fr");
    expect(languageForCountry("BR")).toBe("pt");
    expect(languageForCountry("JP")).toBe("ja");
    expect(languageForCountry("SA")).toBe("ar");
  });

  it("uses English where business search is English", async () => {
    const { languageForCountry } = await import("./countries");
    // CLDR says hi and ur, which is true of the street and not of the
    // search bar. Getting this wrong would change what these users see.
    expect(languageForCountry("IN")).toBe("en");
    expect(languageForCountry("PK")).toBe("en");
    expect(languageForCountry("ZA")).toBe("en");
  });

  it("falls back to English rather than nothing", async () => {
    const { languageForCountry } = await import("./countries");
    expect(languageForCountry("not-real")).toBe("en");
    expect(languageForCountry(null)).toBe("en");
    expect(languageForCountry("UK")).toBe("en"); // via GB
  });
});
