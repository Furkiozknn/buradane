/**
 * A deliberately small subset of the OSM `opening_hours` syntax - enough to
 * answer "şu an açık mı?" honestly for the tags that actually appear in the
 * Türkiye dataset, and honest enough to return "unknown" ("bilinmiyor") for
 * anything it can't parse rather than guessing.
 *
 * Not using a full opening_hours library on purpose: the complete grammar
 * (sunset offsets, week-of-month rules, month ranges) is a large dependency
 * for a field that is empty on most of our POIs. If the dataset later gets
 * rich enough to need it, `opening_hours.js` is the drop-in - see BACKLOG.
 *
 * What the subset does follow from the OSM specification, because getting it
 * wrong turns a real answer into a wrong one rather than an unknown one:
 *
 *  - A later `;` rule REPLACES earlier ones for the days it names:
 *    "Mo-Su 08:00-22:00; Su off" is closed on Sunday, and
 *    "Mo-Fr 09:00-18:00; Fr 09:00-12:00" closes at noon on Friday.
 *    A rule after `, ` (an additional rule) adds to them instead.
 *  - `<days> off` / `<days> closed` is a rule, not an unparseable token.
 *  - An overnight span belongs to the day it starts on: "Fr 22:00-02:00" is
 *    open at 01:00 on Saturday, not at 01:00 on Friday.
 *  - `PH` (public holiday) is a selector. Whether today is a public holiday
 *    is only known for Türkiye's fixed-date national holidays; the religious
 *    holidays move every year, so on any other day the value is evaluated as
 *    a holiday AND as a normal day, and only an answer both agree on is given.
 *  - Two-letter day names are accepted in lower case ("mo-fr"), which is how
 *    a large share of hand-typed Turkish values are written.
 */

export type OpenState = "open" | "closed" | "unknown";

const DAY_TOKENS = ["su", "mo", "tu", "we", "th", "fr", "sa"];

interface Span {
  start: number;
  end: number;
}

interface Rule {
  /** Weekdays the rule names; null = every day (no weekday selector). */
  days: Set<number> | null;
  /** The selector names PH; with `days` null and `ph` true it applies on holidays only. */
  ph: boolean;
  spans: Span[];
  /** `, ` additional rule: adds to the day instead of replacing it. */
  additional: boolean;
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

function dayIndex(token: string): number {
  return DAY_TOKENS.indexOf(token.trim().toLowerCase());
}

/** "Mo-Fr,PH" -> {days, ph}; null when any part is not a weekday or PH. */
function parseSelector(token: string): { days: Set<number> | null; ph: boolean } | null {
  const days = new Set<number>();
  let ph = false;
  for (const part of token.split(",")) {
    const range = part.trim();
    if (!range) continue;
    if (/^ph$/i.test(range)) {
      ph = true;
      continue;
    }
    const [fromRaw, toRaw, extra] = range.split("-");
    if (extra !== undefined) return null;
    const from = dayIndex(fromRaw ?? "");
    if (from === -1) return null;
    if (toRaw === undefined) {
      days.add(from);
      continue;
    }
    const to = dayIndex(toRaw);
    if (to === -1) return null;
    // Ranges can wrap (e.g. Sa-Su, Fr-Mo): walk forward from `from` until `to`.
    for (let i = from; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === to) break;
    }
  }
  if (days.size === 0 && !ph) return null;
  return { days: days.size > 0 ? days : null, ph };
}

function parseRule(rule: string, additional: boolean): Rule | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;

  const match = /^([A-Za-z,\-\s]*?)\s*((?:\d[\d:,\-\s]*)|off|closed)$/i.exec(trimmed);
  if (!match) return null;
  const [, selectorRaw, body] = match;

  let days: Set<number> | null = null;
  let ph = false;
  if (selectorRaw.trim()) {
    const selector = parseSelector(selectorRaw);
    if (!selector) return null;
    ({ days, ph } = selector);
  }

  if (/^(off|closed)$/i.test(body)) return { days, ph, spans: [], additional };

  const spans: Span[] = [];
  for (const span of body.split(",")) {
    const [startRaw, endRaw, extra] = span.split("-");
    if (!startRaw || !endRaw || extra !== undefined) return null;
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);
    if (start == null || end == null) return null;
    spans.push({ start, end });
  }
  return { days, ph, spans, additional };
}

/**
 * Splits a value into rules. `;` separates normal rules; a comma straight
 * after a time and before a letter ("..18:00, Sa 10:00-14:00") starts an
 * additional rule. A comma between times ("09:00-12:00,14:00-18:00") or
 * between days ("Mo,We") stays inside its rule.
 */
function selectorKey(rule: Rule): string {
  return `${rule.days ? [...rule.days].sort().join("") : "*"}|${rule.ph ? "PH" : ""}`;
}

function parseRules(value: string): Rule[] | null {
  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const group of value.split(";")) {
    if (!group.trim()) continue;
    const parts = group.split(/(?<=\d),\s*(?=[A-Za-z])/);
    for (let i = 0; i < parts.length; i += 1) {
      const parsed = parseRule(parts[i], i > 0);
      if (!parsed) return null; // one unparseable rule ⇒ don't pretend to know
      // "Mo-Fr 07:00-13:30; Mo-Fr 17:00-20:00" read to the letter keeps only
      // the evening, but a mapper who repeats the SAME selector means a split
      // day (opening_hours.js warns about exactly this). An identical selector
      // with hours therefore adds; a different selector, or `off`, replaces.
      const key = selectorKey(parsed);
      if (seen.has(key) && parsed.spans.length > 0) parsed.additional = true;
      seen.add(key);
      rules.push(parsed);
    }
  }
  return rules.length > 0 ? rules : null;
}

function ruleApplies(rule: Rule, day: number, holiday: boolean): boolean {
  if (rule.days === null && !rule.ph) return true;
  return (rule.days !== null && rule.days.has(day)) || (rule.ph && holiday);
}

/** The spans a day ends up with after every rule has had its say. */
function daySpans(rules: Rule[], day: number, holiday: boolean): Span[] {
  let spans: Span[] = [];
  for (const rule of rules) {
    if (!ruleApplies(rule, day, holiday)) continue;
    spans = rule.additional ? [...spans, ...rule.spans] : rule.spans;
  }
  return spans;
}

function openAt(rules: Rule[], day: number, minutes: number, holidayToday: boolean, holidayYesterday: boolean): boolean {
  for (const s of daySpans(rules, day, holidayToday)) {
    const overnight = s.end <= s.start;
    if (minutes >= s.start && (overnight || minutes < s.end)) return true;
  }
  // The tail of yesterday's overnight span ("Fr 22:00-02:00" at Sat 01:00).
  const yesterday = (day + 6) % 7;
  for (const s of daySpans(rules, yesterday, holidayYesterday)) {
    if (s.end <= s.start && minutes < s.end) return true;
  }
  return false;
}

// OSM opening_hours values describe the wall clock at the place, and every
// place here is in Türkiye - so "now" must be read in Europe/Istanbul, not
// in whatever timezone the runtime happens to be in. Using getDay()/getHours()
// directly was wrong by 3 hours on any UTC server render and for any
// traveller whose phone is set to another zone.
const ISTANBUL_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Istanbul",
  weekday: "short",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Türkiye's fixed-date national holidays (2429 sayılı Kanun), as MM-DD. The
 * religious holidays (Ramazan and Kurban Bayramı) move with the lunar
 * calendar and are deliberately not listed: a stale table would answer
 * wrongly, while leaving them out only makes a PH-dependent answer unknown.
 * 28 October is a half day, so it is not a known holiday either.
 */
const FIXED_HOLIDAYS = new Set(["01-01", "04-23", "05-01", "05-19", "07-15", "08-30", "10-29"]);

interface WallClock {
  day: number;
  minutes: number;
  monthDay: string | null;
}

function istanbulClock(now: Date): WallClock {
  const parts = ISTANBUL_CLOCK.formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = WEEKDAY_INDEX[part("weekday")];
  const minutes = Number(part("hour")) * 60 + Number(part("minute"));
  if (day === undefined || Number.isNaN(minutes)) {
    // An Intl surprise should degrade to the runtime clock, not crash the map.
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes(), monthDay: null };
  }
  return { day, minutes, monthDay: `${part("month")}-${part("day")}` };
}

/** true on a fixed national holiday; otherwise unknown, never "certainly not". */
function holidayOptions(monthDay: string | null): boolean[] {
  return monthDay && FIXED_HOLIDAYS.has(monthDay) ? [true] : [true, false];
}

/**
 * @param raw the OSM `opening_hours` value
 * @param now injectable for tests - never read the clock implicitly. The
 *   instant is interpreted in Europe/Istanbul regardless of runtime zone.
 */
export function isOpenNow(raw: string | null | undefined, now: Date = new Date()): OpenState {
  if (!raw) return "unknown";
  const value = raw.trim();

  if (value === "24/7") return "open";
  if (/^(closed|off)$/i.test(value)) return "closed";

  const rules = parseRules(value);
  if (!rules) return "unknown";

  const today = istanbulClock(now);
  const usesPh = rules.some((r) => r.ph);
  if (!usesPh) return openAt(rules, today.day, today.minutes, false, false) ? "open" : "closed";

  // Evaluate in every holiday world we cannot rule out; answer only if they agree.
  const yesterday = istanbulClock(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const answers = new Set<boolean>();
  for (const h of holidayOptions(today.monthDay)) {
    for (const hy of holidayOptions(yesterday.monthDay)) {
      answers.add(openAt(rules, today.day, today.minutes, h, hy));
    }
  }
  if (answers.size !== 1) return "unknown";
  return answers.has(true) ? "open" : "closed";
}

export function openStateLabel(state: OpenState): string {
  if (state === "open") return "Şu an açık";
  if (state === "closed") return "Şu an kapalı";
  return "Saat bilgisi yok";
}

/** Turns "Mo-Fr 09:00-18:00; Sa 10:00-14:00" into readable lines. English
 * keeps OSM's own day abbreviations (Mo, Tu ...), which are already English. */
export function humanizeOpeningHours(
  raw: string | null | undefined,
  locale: "tr" | "en" = "tr",
): string[] {
  if (!raw) return [];
  if (raw.trim() === "24/7") return [locale === "en" ? "Open 24 hours, every day" : "Her gün 24 saat açık"];
  if (locale === "en") return raw.split(";").map((rule) => rule.trim());

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
