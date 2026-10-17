import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ru";

dayjs.extend(utc);
dayjs.extend(relativeTime);
dayjs.locale("ru");

// Русское склонение по числу: plural(5, "письмо", "письма", "писем") → "писем".
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function toUtcDayString(ts: number): string {
  return dayjs.utc(ts).format("YYYY-MM-DD");
}

export function utcMidnightMs(ts: number): number {
  return dayjs.utc(ts).startOf("day").valueOf();
}

export function formatUtcStrictDate(day: string, format: string): string {
  const parsed = dayjs.utc(day, "YYYY-MM-DD", true).startOf("day");
  if (!parsed.isValid()) return day;

  return parsed.format(format);
}

export function formatRelativeDate(ts: number): string {
  // dayjs says "a few seconds ago" for anything under 45s, which is both noisy
  // and wide enough to wrap tight columns. Floor the last minute to "только что".
  if (Math.abs(Date.now() - ts) < 60_000) return "только что";
  return dayjs(ts).fromNow();
}

export function formatAbsoluteDate(ts: number): string {
  return dayjs(ts).format("D MMM YYYY");
}

export function formatShortDate(ts: number): string {
  return dayjs(ts).format("D MMM");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}
