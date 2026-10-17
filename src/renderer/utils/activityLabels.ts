import type { ActivityEntry, GdprCaseAction, GdprCaseOutcome, GdprRequestType } from "@shared/types";

export const ACTION_LABELS: Record<ActivityEntry["actionType"], string> = {
  unsubscribed: "Отписка",
  trashed: "Перемещено в корзину",
  spam_reported: "Отмечено как спам",
  gdpr_request_sent: "GDPR-запрос отправлен",
  reminder_sent: "Напоминание отправлено",
  followup_sent: "Повторный запрос отправлен",
  reply_received: "Получен ответ",
  case_message_linked: "Добавлено в обращение",
  escalated: "Передано в надзорный орган",
  case_closed: "Обращение закрыто",
};

export const ACTION_COLORS: Record<ActivityEntry["actionType"], string> = {
  unsubscribed: "text-success",
  trashed: "text-base-content/50",
  spam_reported: "text-warning",
  gdpr_request_sent: "text-primary",
  reminder_sent: "text-primary",
  followup_sent: "text-primary",
  reply_received: "text-success",
  case_message_linked: "text-success",
  escalated: "text-warning",
  case_closed: "text-success",
};

export const CASE_ACTION_LABELS: Record<GdprCaseAction, string> = {
  reminder: "Напоминание",
  followup: "Повторный запрос",
  escalate: "Жалоба",
};

export const CASE_ACTION_BADGES: Record<GdprCaseAction, string> = {
  reminder: "badge-info",
  followup: "badge-warning",
  escalate: "badge-error",
};

export const REQUEST_TYPE_LABELS: Record<GdprRequestType, string> = {
  access: "Доступ к данным",
  deletion: "Удаление данных",
};

/** Semantic classes — see global.css for contrast-safe colors. */
export const REQUEST_TYPE_BADGES: Record<GdprRequestType, string> = {
  access: "badge-request-access",
  deletion: "badge-request-deletion",
};

export const CASE_CLOSED_BADGE = "badge-soft";

export const CASE_OUTCOME_LABELS: Record<GdprCaseOutcome, string> = {
  resolved: "Решено",
  escalated: "Передано регулятору",
};

export function gdprRequestLabel(requestType: GdprRequestType): string {
  return requestType === "access" ? "Запрос на доступ к данным" : "Запрос на удаление данных";
}

function gdprRequestSentLabel(requestType: GdprRequestType): string {
  return requestType === "access" ? "Запрос на доступ к данным отправлен" : "Запрос на удаление данных отправлен";
}

function caseClosedLabel(outcome?: GdprCaseOutcome): string {
  if (!outcome) return "Обращение закрыто";
  return `Обращение закрыто — ${CASE_OUTCOME_LABELS[outcome]}`;
}

/** Single source of truth for how an activity/case event is labelled. */
export function activityEntryLabel(entry: ActivityEntry): string {
  if (entry.actionType === "gdpr_request_sent" && entry.caseRequestType) {
    return gdprRequestSentLabel(entry.caseRequestType);
  }
  if (entry.actionType === "case_closed") {
    return caseClosedLabel(entry.caseOutcome);
  }
  return ACTION_LABELS[entry.actionType];
}
