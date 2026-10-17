export function getActivitySignal(lastSeen?: number): string {
  if (!lastSeen) return "unknown";
  const days = (Date.now() - lastSeen) / 86_400_000;
  if (days < 90)   return "recent";
  if (days < 365)  return "active";
  if (days < 730)  return "inactive";
  if (days < 1825) return "stale";
  return "dead";
}

export const ACTIVITY_BADGE: Record<string, { label: string; color: string } | null> = {
  recent:  null,
  active:  null,
  inactive:{ label: "1–2 года назад", color: "badge-secondary" },
  stale:   { label: "2+ года назад", color: "badge-secondary" },
  dead:    { label: "5+ лет назад",  color: "badge-secondary" },
  unknown: null,
};
