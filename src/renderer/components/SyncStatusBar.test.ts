import {
  formatRunningSyncStatus,
  isOAuthTokenError,
} from "./syncStatus";

describe("SyncStatusBar progress", () => {
  const startedAt = Date.UTC(2026, 0, 1, 12);
  const now = startedAt + 18 * 60 * 1000;

  it.each(["incremental", "historical"] as const)(
    "uses the same message for %s sync",
    (phase) => {
      expect(
        formatRunningSyncStatus(
          {
            running: true,
            progress: 2614,
            total: 65000,
            message: "Fetching messages...",
            phase,
            startedAt,
            periodStart: Date.UTC(2025, 0, 1),
            periodEnd: Date.UTC(2025, 2, 31),
          },
          now,
        ),
      ).toBe(
        "Синхронизация... обработано 2,614 писем · янв.–март 2025 · прошло 18 мин",
      );
    },
  );

  it("shows zero before the first message is processed", () => {
    expect(
      formatRunningSyncStatus(
        {
          running: true,
          progress: 0,
          total: 0,
          message: "Connecting...",
          startedAt,
        },
        startedAt,
      ),
    ).toBe("Синхронизация... обработано 0 писем · прошло 0 мин");
  });

  it("omits the period when none is available", () => {
    expect(
      formatRunningSyncStatus(
        {
          running: true,
          progress: 2614,
          total: 0,
          message: "Fetching messages...",
          startedAt,
        },
        now,
      ),
    ).toBe("Синхронизация... обработано 2,614 писем · прошло 18 мин");
  });
});

describe("SyncStatusBar OAuth recovery", () => {
  it("recognizes normalized authorization-expired errors", () => {
    expect(
      isOAuthTokenError(
        "Авторизация истекла. Переподключите аккаунт, чтобы продолжить синхронизацию.",
      ),
    ).toBe(true);
  });

  it("does not offer OAuth reconnect for unrelated sync errors", () => {
    expect(isOAuthTokenError("Could not reach the mail server.")).toBe(false);
  });
});
