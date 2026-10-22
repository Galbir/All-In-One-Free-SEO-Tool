/**
 * Wall-clock time in a named time zone, without a date library.
 *
 * Report schedules said "9 AM" and meant the server's clock — which in
 * Docker is UTC, so an agency in India got its 9 AM report at 2:30 PM.
 * The workspace time zone (Settings → General) now decides; unset, the
 * server's own zone is used, which is what every existing install did.
 */

export type WallClock = {
  year: number;
  month: number; // 0-11
  day: number; // 1-31
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
};

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `date` in `tz` (or the server zone). */
export function wallClock(date: Date, tz?: string | null): WallClock {
  if (!isValidTimeZone(tz)) {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")) - 1,
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

/**
 * The instant at which the clock in `tz` reads year-month-day hour:00.
 * Computed by guessing UTC, measuring the zone's offset at the guess,
 * and correcting — twice, so a DST change between guess and answer
 * still lands on the right hour.
 */
export function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  tz?: string | null,
): Date {
  if (!isValidTimeZone(tz)) return new Date(year, month, day, hour, 0, 0, 0);
  const target = Date.UTC(year, month, day, hour, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const w = wallClock(new Date(guess), tz);
    const seen = Date.UTC(w.year, w.month, w.day, w.hour, w.minute, 0, 0);
    guess += target - seen;
  }
  return new Date(guess);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The workspace time zone setting, if it is a real zone. */
export async function workspaceTimeZone(): Promise<string | null> {
  try {
    const { getSetting } = await import("./settings-store");
    const tz = await getSetting<string>("workspace.timezone");
    return isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}
