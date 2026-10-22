import { describe, expect, it } from "vitest";
import { computeNextSendAt, nextAttemptAfterFailure } from "./report-mailer";
import { zonedTime } from "./timezone";

describe("computeNextSendAt with a workspace time zone", () => {
  it("sends at 9 AM in the chosen zone, not the server's", () => {
    // 2026-10-22 is a Thursday. Weekly on Friday at 9 in Kolkata (+5:30).
    const from = new Date("2026-10-22T12:00:00Z");
    const at = computeNextSendAt(
      { frequency: "weekly", dayOfMonth: null, dayOfWeek: 5, hourOfDay: 9 },
      from,
      "Asia/Kolkata",
    );
    expect(at.toISOString()).toBe("2026-10-23T03:30:00.000Z");
  });

  it("rolls to next week when today's slot has passed", () => {
    const from = new Date("2026-10-23T04:00:00Z"); // Fri 09:30 in Kolkata
    const at = computeNextSendAt(
      { frequency: "weekly", dayOfMonth: null, dayOfWeek: 5, hourOfDay: 9 },
      from,
      "Asia/Kolkata",
    );
    expect(at.toISOString()).toBe("2026-10-30T03:30:00.000Z");
  });

  it("treats day 31 as the last day of a shorter month", () => {
    const from = new Date("2026-02-10T00:00:00Z");
    const at = computeNextSendAt(
      { frequency: "monthly", dayOfMonth: 31, dayOfWeek: null, hourOfDay: 9 },
      from,
      "UTC",
    );
    expect(at.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("moves to next month once this month's slot has passed", () => {
    const from = new Date("2026-10-15T00:00:00Z");
    const at = computeNextSendAt(
      { frequency: "monthly", dayOfMonth: 1, dayOfWeek: null, hourOfDay: 9 },
      from,
      "UTC",
    );
    expect(at.toISOString()).toBe("2026-11-01T09:00:00.000Z");
  });

  it("lands on the right hour across a DST change", () => {
    // New York leaves DST on 2026-11-01.
    expect(zonedTime(2026, 10, 2, 9, "America/New_York").toISOString()).toBe(
      "2026-11-02T14:00:00.000Z",
    );
    expect(zonedTime(2026, 9, 30, 9, "America/New_York").toISOString()).toBe(
      "2026-10-30T13:00:00.000Z",
    );
  });
});

describe("retrying a failed scheduled report", () => {
  const regular = new Date("2026-11-01T09:00:00Z");
  const now = new Date("2026-10-22T12:00:00Z");

  it("backs off rather than retrying every tick", () => {
    expect(nextAttemptAfterFailure(1, now, () => regular).at.getTime() - now.getTime()).toBe(
      30 * 60_000,
    );
    expect(nextAttemptAfterFailure(3, now, () => regular).at.getTime() - now.getTime()).toBe(
      120 * 60_000,
    );
  });

  it("gives up on this period after six attempts", () => {
    const plan = nextAttemptAfterFailure(6, now, () => regular);
    expect(plan.gaveUp).toBe(true);
    expect(plan.at).toEqual(regular);
  });
});
