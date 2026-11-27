// Dates and times of pickups and deliveries. A window is typed and shown in the time zone of its
// location, never in the browser's zone: a dispatcher in Chicago booking a dock in Denver thinks in
// Denver time. US display format: MM/DD/YYYY with a 12-hour clock.

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsIn(instant: Date, timeZone: string): Parts {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(formatted.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/** How many minutes the zone is ahead of UTC at the given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Turns what a person typed ("2026-12-01T14:30", the value of a datetime-local field) into the exact
 * instant it means in `timeZone`, as an ISO string in UTC. Returns undefined for text that is not a
 * valid date and time. A time that does not exist (the hour skipped when clocks go forward) is read
 * as if the clocks had not changed.
 */
export function localTimeToIso(local: string, timeZone: string): string | undefined {
  const match = LOCAL_INPUT.exec(local);
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(guess);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour
  ) {
    return undefined;
  }
  let instant = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60000);
  const corrected = offsetMinutes(instant, timeZone);
  instant = new Date(guess - corrected * 60000);
  return instant.toISOString();
}

/** The value for a datetime-local field showing `iso` in `timeZone`. */
export function isoToLocalInput(iso: string, timeZone: string): string {
  const p = partsIn(new Date(iso), timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** "12/01/2026 2:00 PM CST": date, time and the zone's abbreviation, in the given zone. */
export function formatInZone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return `${day} ${time}`;
}

/** "12/01/2026" in the given zone. */
export function formatDateInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** A window as one line: "12/01/2026 2:00 PM CST – 4:00 PM CST" (the date repeats when it differs). */
export function formatWindow(startIso: string, endIso: string, timeZone: string): string {
  const start = formatInZone(startIso, timeZone);
  if (startIso === endIso) return start;
  const sameDay = formatDateInZone(startIso, timeZone) === formatDateInZone(endIso, timeZone);
  const end = formatInZone(endIso, timeZone);
  return `${start} – ${sameDay ? end.slice(end.indexOf(" ") + 1) : end}`;
}

const FREE_FORM = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/;
const US_FORM = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/;

/**
 * Reads a date and time as people write them in spreadsheets, without a zone: `2026-12-01 14:30`,
 * `12/01/2026 14:30` or `12/01/2026 2:30 PM`. Returns the value of a datetime-local field
 * (`2026-12-01T14:30`) or undefined when the text is not a real date and time.
 */
export function parseLocalDateTime(text: string): string | undefined {
  const value = text.trim();
  let year: number, month: number, day: number, hour: number, minute: number;
  const free = FREE_FORM.exec(value);
  const us = US_FORM.exec(value);
  if (free) {
    [year, month, day, hour, minute] = free.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
  } else if (us) {
    [month, day, year, hour, minute] = us.slice(1, 6).map(Number) as [
      number,
      number,
      number,
      number,
      number,
    ];
    const meridiem = us[6]?.toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return undefined;
      hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
    }
  } else {
    return undefined;
  }
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    minute > 59
  ) {
    return undefined;
  }
  const two = (n: number) => String(n).padStart(2, "0");
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}`;
}
