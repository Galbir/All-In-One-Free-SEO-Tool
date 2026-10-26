import { describe, expect, it } from "vitest";
import {
  geoTargetFor,
  languageFor,
  normalizeCustomerId,
  parseKeywordIdeas,
  rankIdeas,
  type KeywordIdea,
} from "./google-ads";

const idea = (
  text: string,
  volume: number,
  competitionIndex: number | null = 30,
): KeywordIdea => ({
  text,
  volume,
  competition: null,
  competitionIndex,
  lowBid: null,
  highBid: null,
});

describe("normalizeCustomerId", () => {
  it("strips dashes from the Ads UI format", () => {
    expect(normalizeCustomerId("123-456-7890")).toBe("1234567890");
  });
  it("rejects anything that is not ten digits", () => {
    expect(normalizeCustomerId("12345")).toBeNull();
    expect(normalizeCustomerId(null)).toBeNull();
  });
});

describe("market ids", () => {
  it("maps countries and languages, defaulting to US English", () => {
    expect(geoTargetFor("ro")).toBe("geoTargetConstants/2642");
    expect(geoTargetFor("ZZ")).toBe("geoTargetConstants/2840");
    expect(languageFor("ro-RO")).toBe("languageConstants/1040");
    expect(languageFor(null)).toBe("languageConstants/1000");
  });
});

describe("parseKeywordIdeas", () => {
  it("reads string int64s and micros", () => {
    const out = parseKeywordIdeas({
      results: [
        {
          text: "espresso machine",
          keywordIdeaMetrics: {
            avgMonthlySearches: "12100",
            competition: "HIGH",
            competitionIndex: "81",
            lowTopOfPageBidMicros: "500000",
            highTopOfPageBidMicros: "2500000",
          },
        },
        { text: "" },
        { keywordMetrics: {} },
      ],
    });
    expect(out).toEqual([
      {
        text: "espresso machine",
        volume: 12100,
        competition: "HIGH",
        competitionIndex: 81,
        lowBid: 0.5,
        highBid: 2.5,
      },
    ]);
  });
  it("returns [] for an empty or malformed response", () => {
    expect(parseKeywordIdeas({})).toEqual([]);
    expect(parseKeywordIdeas(null)).toEqual([]);
  });
});

describe("rankIdeas", () => {
  it("prefers volume, then low competition", () => {
    const out = rankIdeas([
      idea("cheap", 1000, 50),
      idea("best", 1000, 10),
      idea("small", 100, 5),
    ]);
    expect(out.map((i) => i.text)).toEqual(["best", "cheap", "small"]);
  });
  it("drops excluded, duplicate, tiny and wordy ideas", () => {
    const out = rankIdeas(
      [
        idea("Tracked", 5000),
        idea("fresh", 5000),
        idea("FRESH", 5000),
        idea("tiny", 10),
        idea("one two three four five six seven", 5000),
      ],
      { exclude: ["tracked"] },
    );
    expect(out.map((i) => i.text)).toEqual(["fresh"]);
  });
});
