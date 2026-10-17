import { useEffect, useState } from "react";
import type { SyncStatus } from "@shared/types";
import { formatRunningSyncStatus, isOAuthTokenError } from "./syncStatus";

function formatMonthYear(ts: number): string {
  return new Date(ts).toLocaleDateString("ru-RU", { month: "short", year: "numeric" });
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

export default function SyncStatusBar(): JSX.Element {
  const [status, setStatus] = useState<SyncStatus>({
    running: false,
    progress: 0,
    total: 0,
    message: "",
  });
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const unsub = window.api.onSyncProgress(setStatus);
    window.api.getSyncStatus().then(setStatus);
    return unsub;
  }, []);

  // Tick every 30s to keep relative and elapsed times fresh
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleSync = () => {
    window.api.startSync();
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const account = await window.api.getAccountInfo();
      const intent = {
        type: "reconnect",
        email: account.email,
      } as const;
      let result: { success: boolean; error?: string };
      if (account.providerType === "microsoft") {
        result = await window.api.startMicrosoftAuth(intent);
      } else if (account.providerType === "gmail") {
        result = await window.api.startGmailAuth(intent);
      } else {
        result = {
          success: false,
          error: "Переподключение доступно только для аккаунтов Gmail и Microsoft",
        };
      }
      if (result.success) {
        window.api.startSync();
      } else {
        setStatus((s) => ({ ...s, error: result.error ?? "Не удалось переподключиться" }));
      }
    } finally {
      setReconnecting(false);
    }
  };

  const showReconnect = isOAuthTokenError(status.error);
  const analyzingMessages =
    status.running && status.message === "Analyzing messages";

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300">
      <div className="flex items-center gap-2 text-sm">
        {status.running ? (
          <>
            <span className="loading loading-spinner loading-xs"></span>
            <span className="text-warning">
              {analyzingMessages
                ? "Анализ писем…"
                : formatRunningSyncStatus(status, now)}
            </span>
          </>
        ) : status.error ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-error"></span>
            <span className="text-error">Ошибка синхронизации</span>
            <span
              className="text-base-content/50 truncate max-w-lg"
              title={status.error}
            >
              {status.error}
            </span>
          </>
        ) : status.analysisPending ? (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-warning"></span>
            <span className="text-base-content/70">
              Обновите, чтобы проанализировать письма
            </span>
          </>
        ) : (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-success"></span>
            <span className="text-base-content/70">Синхронизировано</span>
            {status.lastSyncAt && (
              <span className="text-base-content/50">
                {formatRelativeTime(status.lastSyncAt)}
              </span>
            )}
            {!status.historicalDone && status.historicalCursor && (
              <span className="text-base-content/40">
                · история с {formatMonthYear(status.historicalCursor)}
              </span>
            )}
          </>
        )}
      </div>
      <button
        className={`btn btn-xs ${
          status.analysisPending && !status.running
            ? "btn-primary"
            : "btn-ghost"
        }`}
        onClick={showReconnect ? handleReconnect : handleSync}
        disabled={status.running || reconnecting}
      >
        {status.running
          ? analyzingMessages
            ? "Анализ..."
            : "Синхронизация..."
          : reconnecting
            ? "Переподключение..."
            : showReconnect
              ? "Переподключить"
              : "Обновить"}
      </button>
    </div>
  );
}
