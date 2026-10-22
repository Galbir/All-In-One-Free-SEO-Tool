import { describe, expect, it } from "vitest";
import { pickRotating } from "./rotation";

describe("pickRotating", () => {
  it("returns everything when it fits", () => {
    expect(pickRotating([3, 1, 2], 0, 5)).toEqual([1, 2, 3]);
  });

  it("resumes after the cursor and wraps around", () => {
    const ids = [1, 2, 3, 4, 5];
    expect(pickRotating(ids, 0, 2)).toEqual([1, 2]);
    expect(pickRotating(ids, 2, 2)).toEqual([3, 4]);
    expect(pickRotating(ids, 4, 2)).toEqual([5, 1]);
    expect(pickRotating(ids, 99, 2)).toEqual([1, 2]);
  });

  it("reaches every id within ceil(total / n) runs", () => {
    const ids = Array.from({ length: 31 }, (_, i) => i + 1);
    const seen = new Set<number>();
    let cursor = 0;
    for (let run = 0; run < Math.ceil(31 / 30); run++) {
      const picked = pickRotating(ids, cursor, 30);
      picked.forEach((id) => seen.add(id));
      cursor = picked[picked.length - 1];
    }
    expect(seen.size).toBe(31);
  });

  it("handles a deleted cursor row", () => {
    expect(pickRotating([10, 20, 30], 15, 1)).toEqual([20]);
  });
});
