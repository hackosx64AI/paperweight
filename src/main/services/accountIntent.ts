import type { AccountEntry, StoredCredentials } from "../credentials";
import type { AccountAuthIntent } from "@shared/types";

export type AccountIntentResult =
  | { success: true }
  | { success: false; error: string };

function isSameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function validateAccountIntent(
  intent: AccountAuthIntent,
  resolvedEmail: string,
  providerType: StoredCredentials["providerType"],
  accounts: AccountEntry[],
  activeEmail?: string,
): AccountIntentResult {
  if (
    intent.type === "add"
    && accounts.some((account) => isSameEmail(account.email, resolvedEmail))
  ) {
    return {
      success: false,
      error: "Этот аккаунт уже подключён. Используйте «Переподключить».",
    };
  }
  if (
    intent.type === "reconnect"
    && !isSameEmail(intent.email, resolvedEmail)
  ) {
    return {
      success: false,
      error: "Вход выполнен в другой аккаунт. Повторите вход с переподключаемым аккаунтом.",
    };
  }
  if (
    intent.type === "reconnect"
    && (!activeEmail || !isSameEmail(intent.email, activeEmail))
  ) {
    return {
      success: false,
      error: "Переподключаемый аккаунт больше не активен. Переключитесь на него и повторите.",
    };
  }
  const reconnectAccount = intent.type === "reconnect"
    ? accounts.find((account) => isSameEmail(account.email, intent.email))
    : undefined;
  if (intent.type === "reconnect" && !reconnectAccount) {
    return {
      success: false,
      error: "Этот аккаунт больше не подключён. Добавьте его заново.",
    };
  }
  if (reconnectAccount && reconnectAccount.providerType !== providerType) {
    return {
      success: false,
      error: "Этот аккаунт подключён через другого провайдера.",
    };
  }
  return { success: true };
}
