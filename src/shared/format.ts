const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
const absoluteFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** "3 hr. ago", "yesterday", or "just now". */
export const relativeTime = (iso: string, now: Date = new Date()): string => {
  const seconds = (Date.parse(iso) - now.getTime()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
};

export const absoluteTime = (iso: string): string => absoluteFormat.format(new Date(iso));
