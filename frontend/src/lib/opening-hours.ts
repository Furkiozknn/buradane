/**
 * A deliberately small subset of the OSM `opening_hours` syntax - enough to
 * answer "şu an açık mı?" honestly for the tags that actually appear in the
 * Istanbul dataset, and honest enough to return `null` ("bilinmiyor") for
 * anything it can't parse rather than guessing.
 *
 * Not using a full opening_hours library on purpose: the complete grammar
 * (holidays, sunset offsets, week-of-month rules) is a large dependency for
 * a field that is empty on most of our POIs. If the dataset later gets rich
 * enough to need it, `opening_hours.js` is the drop-in - see BACKLOG.
 */

export type OpenState = "open" | "closed" | "unknown";

const DAY_TOKENS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface Interval {
  days: Set<number>;
  startMinutes: number;
  endMinutes: number;
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseDayRange(token: string): Set<number> | null {
  const days = new Set<number>();
  for (const part of token.split(",")) {
    const range = part.trim();
    if (!range) continue;
    const [fromRaw, toRaw] = range.split("-");
    const from = DAY_TOKENS.indexOf(fromRaw?.trim() ?? "");
    if (from === -1) return null;
    if (!toRaw) {
      days.add(from);
      continue;
    }
    const to = DAY_TOKENS.indexOf(toRaw.trim());
    if (to === -1) return null;
    // Ranges can wrap (e.g. Sa-Su): walk forward from `from` until `to`.
    for (let i = from; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === to) break;
    }
  }
  return days.size > 0 ? days : null;
}

function parseRule(rule: string): Interval[] | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;

  const match = /^([A-Za-z,\-\s]+)?\s*([\d:,\-\s]+)$/.exec(trimmed);
  if (!match) return null;

  const [, dayToken, timeToken] = match;
  const days = dayToken ? parseDayRange(dayToken) : new Set([0, 1, 2, 3, 4, 5, 6]);
  if (!days) return null;

  const intervals: Interval[] = [];
  for (const span of timeToken.split(",")) {
    const [startRaw, endRaw] = span.split("-");
    if (!startRaw || !endRaw) return null;
    const startMinutes = parseTime(startRaw);
    const endMinutes = parseTime(endRaw);
    if (startMinutes == null || endMinutes == null) return null;
    intervals.push({ days, startMinutes, endMinutes });
  }
  return intervals;
}

/**
 * @param raw the OSM `opening_hours` value
 * @param now injectable for tests - never read the clock implicitly
 */
export function isOpenNow(raw: string | null | undefined, now: Date = new Date()): OpenState {
  if (!raw) return "unknown";
  const value = raw.trim();

  if (value === "24/7") return "open";
  if (/^(closed|off)$/i.test(value)) return "closed";

  const intervals: Interval[] = [];
  for (const rule of value.split(";")) {
    const parsed = parseRule(rule);
    if (!parsed) return "unknown"; // one unparseable rule ⇒ don't pretend to know
    intervals.push(...parsed);
  }
  if (intervals.length === 0) return "unknown";

  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const interval of intervals) {
    if (!interval.days.has(day)) continue;
    if (interval.endMinutes <= interval.startMinutes) {
      // Overnight span (e.g. 22:00-06:00)
      if (minutes >= interval.startMinutes || minutes < interval.endMinutes) return "open";
    } else if (minutes >= interval.startMinutes && minutes < interval.endMinutes) {
      return "open";
    }
  }
  return "closed";
}

export function openStateLabel(state: OpenState): string {
  if (state === "open") return "Şu an açık";
  if (state === "closed") return "Şu an kapalı";
  return "Saat bilgisi yok";
}

/** Turns "Mo-Fr 09:00-18:00; Sa 10:00-14:00" into readable Turkish lines. */
export function humanizeOpeningHours(raw: string | null | undefined): string[] {
  if (!raw) return [];
  if (raw.trim() === "24/7") return ["Her gün 24 saat açık"];

  const TR_DAYS: Record<string, string> = {
    Mo: "Pzt",
    Tu: "Sal",
    We: "Çar",
    Th: "Per",
    Fr: "Cum",
    Sa: "Cmt",
    Su: "Paz",
  };

  return raw.split(";").map((rule) => {
    let line = rule.trim();
    for (const [en, tr] of Object.entries(TR_DAYS)) {
      line = line.replace(new RegExp(en, "g"), tr);
    }
    return line;
  });
}
