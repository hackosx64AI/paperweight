import type { SyncStatus } from "@shared/types";
import { plural } from "@shared/formatting";

function formatSyncPeriod(start: number, end: number): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startMonth = startDate.toLocaleDateString("ru-RU", { month: "short" });
  const endMonth = endDate.toLocaleDateString("ru-RU", { month: "short" });
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  if (startYear === endYear && startDate.getMonth() === endDate.getMonth()) {
    return `${startMonth} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth}–${endMonth} ${startYear}`;
  }
  return `${startMonth} ${startYear}–${endMonth} ${endYear}`;
}

export function formatRunningSyncStatus(
  status: SyncStatus,
  now = Date.now(),
): string {
  const details = [
    `обработано ${status.progress.toLocaleString()} ${plural(status.progress, "письмо", "письма", "писем")}`,
  ];
  if (status.periodStart !== undefined && status.periodEnd !== undefined) {
    details.push(formatSyncPeriod(status.periodStart, status.periodEnd));
  }
  if (status.startedAt !== undefined) {
    const elapsedMinutes = Math.max(
      0,
      Math.floor((now - status.startedAt) / 60_000),
    );
    details.push(`прошло ${elapsedMinutes} мин`);
  }
  return `Синхронизация... ${details.join(" · ")}`;
}

export function isOAuthTokenError(error?: string): boolean {
  return !!(
    error &&
    (error.includes("Gmail authorization expired") ||
      error.includes("Failed to refresh access token") ||
      error.includes("Авторизация истекла. Переподключите аккаунт"))
  );
}
