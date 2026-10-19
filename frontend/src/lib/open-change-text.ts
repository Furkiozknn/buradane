/**
 * The sentence for an upcoming open/close switch: "45 dk içinde kapanıyor",
 * "Açılış yarın 09:00". Kept beside the components (not inside
 * opening-hours.ts) because every sentence here is a literal argument to
 * `t`, which is what tests/i18n.test.ts scans for an English entry.
 *
 * The clock time is written after a noun ("Kapanış 18:00") rather than with a
 * case suffix: "18:00'de" but "09:00'da" and "03:00'te" depend on how the
 * number is read aloud, and a wrong suffix on every card is worse than none.
 */

import type { Locale, Vars } from "./i18n";
import { SOON_MINUTES, type OpenChange } from "./opening-hours";

type T = (key: string, vars?: Vars) => string;

const DAY_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const DAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function openChangeText(change: OpenChange | null, t: T, locale: Locale): string | null {
  if (!change) return null;
  const { to, inMinutes: n, at: time, dayOffset, weekday } = change;
  if (to === "closed") {
    if (n <= SOON_MINUTES) return t("{n} dk içinde kapanıyor", { n });
    if (dayOffset === 0) return t("Kapanış {time}", { time });
    if (dayOffset === 1) return t("Kapanış yarın {time}", { time });
    return t("Kapanış {day} {time}", { day: (locale === "en" ? DAY_EN : DAY_TR)[weekday], time });
  }
  if (n <= SOON_MINUTES) return t("{n} dk içinde açılıyor", { n });
  if (dayOffset === 0) return t("Açılış {time}", { time });
  if (dayOffset === 1) return t("Açılış yarın {time}", { time });
  return t("Açılış {day} {time}", { day: (locale === "en" ? DAY_EN : DAY_TR)[weekday], time });
}
