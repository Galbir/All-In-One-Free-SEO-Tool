import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./scheduler";

const MIN = 60_000;

describe("scheduler retry backoff", () => {
  it("does not delay a healthy runner", () => {
    expect(retryDelayMs(0, 24 * 60 * MIN)).toBe(0);
  });

  it("doubles from five minutes", () => {
    expect(retryDelayMs(1, 24 * 60 * MIN)).toBe(5 * MIN);
    expect(retryDelayMs(2, 24 * 60 * MIN)).toBe(10 * MIN);
    expect(retryDelayMs(4, 24 * 60 * MIN)).toBe(40 * MIN);
  });

  it("never waits longer than the runner's own interval", () => {
    expect(retryDelayMs(30, 15 * MIN)).toBe(15 * MIN);
  });
});
