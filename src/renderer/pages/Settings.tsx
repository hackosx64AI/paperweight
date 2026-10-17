import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import makeBlockie from "ethereum-blockies-base64";
import { HelpCircle, Lock, Moon, Sun } from "lucide-react";
import {
  type AccountInfo,
  type AgentAccess,
  type EmailConnection,
  type LicenseStatus,
  type McpSetup,
  type WhitelistEntry,
} from "@shared/types";
import { APP_CONFIG } from "@shared/config";
import { formatBytes } from "@shared/formatting";
import {
  useLicense,
  useRefreshLicense,
  useActionAccess,
  PRO_UPGRADE_BODY,
} from "../context/LicenseContext";
import {
  ProviderSelect,
  GmailConnect,
  MicrosoftConnect,
  AppleConnect,
  ProtonConnect,
  ImapConnect,
} from "../components/ProviderConnect";
import ServerSettingsModal from "../components/ServerSettingsModal";
import { useAccounts } from "../hooks/useAccounts";
import {
  readColorTheme,
  setColorTheme as applyAndSaveColorTheme,
  type ColorTheme,
} from "../utils/colorTheme";
import { reconnectError } from "./settingsReconnect";

type AddAccountView = "provider" | "gmail" | "microsoft" | "apple" | "proton" | "imap";

export default function Settings(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [account, setAccount] = useState<AccountInfo>();
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [connection, setConnection] = useState<EmailConnection | null>(null);
  const [autoLaunch, setAutoLaunch] = useState(() => !!window.api.getSettings().autoLaunch);
  const [launchMinimized, setLaunchMinimized] = useState(() => !!window.api.getSettings().launchMinimized);
  const [colorTheme, setColorTheme] = useState<ColorTheme>(readColorTheme);
  const [agentAccess, setAgentAccess] = useState<AgentAccess>(
    () => window.api.getSettings().agentAccess ?? "off",
  );
  const [agentMaskPersonalData, setAgentMaskPersonalData] = useState(
    () => window.api.getSettings().agentMaskPersonalData !== false,
  );
  const [showAgentActionsModal, setShowAgentActionsModal] = useState(false);
  const [showAgentUnmaskModal, setShowAgentUnmaskModal] = useState(false);
  const [mcpSetup, setMcpSetup] = useState<McpSetup>();
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false);
  const [showResyncModal, setShowResyncModal] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const license = useLicense();
  const allowAction = useActionAccess();
  const refreshLicense = useRefreshLicense();
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [licenseError, setLicenseError] = useState("");
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeInProgress, setWipeInProgress] = useState(false);
  const [deletionError, setDeletionError] = useState("");
  const [whitelistEntries, setWhitelistEntries] = useState<WhitelistEntry[]>(
    [],
  );
  const [newEntry, setNewEntry] = useState("");
  const [reconnectLoading, setReconnectLoading] = useState(false);
  const [reconnectFailure, setReconnectFailure] = useState("");
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const [removeAccountEmail, setRemoveAccountEmail] = useState<string | null>(
    null,
  );
  const [removeInProgress, setRemoveInProgress] = useState(false);
  const [switchingEmail, setSwitchingEmail] = useState<string | null>(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [addAccountView, setAddAccountView] =
    useState<AddAccountView>("provider");
  const [addAccountCopyFirst, setAddAccountCopyFirst] = useState(false);
  const licenseSectionRef = useRef<HTMLDivElement>(null);
  const accountsSectionRef = useRef<HTMLDivElement>(null);

  const mcpConfig = mcpSetup?.server
    ? JSON.stringify({ mcpServers: { paperweight: mcpSetup.server } }, null, 2)
    : undefined;

  const fetchWhitelist = async (): Promise<void> => {
    const entries = await window.api.getWhitelistEntries();
    setWhitelistEntries(entries);
  };

  useEffect(() => {
    window.api.getAccountInfo().then(setAccount);
    window.api.getEmailConnection().then(setConnection);
    window.api.getMcpSetup().then(setMcpSetup);
    fetchWhitelist();
  }, []);

  useEffect(() => {
    setColorTheme(readColorTheme());
  }, [location.pathname]);

  useEffect(() => {
    const state = location.state as {
      openServerSettings?: boolean;
      scrollToLicense?: boolean;
      scrollToAccounts?: boolean;
    } | null;
    if (!state?.openServerSettings && !state?.scrollToLicense && !state?.scrollToAccounts) return;
    if (state.openServerSettings) {
      setShowServerSettings(true);
    }
    if (state.scrollToLicense) {
      licenseSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    }
    if (state.scrollToAccounts) {
      accountsSectionRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const handleAddEntry = async (): Promise<void> => {
    if (!allowAction("curate")) return;
    const value = newEntry.trim().toLowerCase();
    if (!value) return;
    if (!value.includes(".")) return;
    await window.api.addWhitelistEntry(value);
    setNewEntry("");
    fetchWhitelist();
  };

  const handleRemoveWhitelistEntry = async (value: string): Promise<void> => {
    if (!allowAction("curate")) return;
    await window.api.removeWhitelistEntry(value);
    fetchWhitelist();
  };

  const handleActivateLicense = async (): Promise<void> => {
    const key = licenseKey.trim();
    if (!key) return;
    setLicenseLoading(true);
    setLicenseError("");
    try {
      const status = await window.api.activateLicense(key);
      await refreshLicense();
      if (!status.active) {
        setLicenseError("Неверный или просроченный лицензионный ключ.");
      } else {
        setLicenseKey("");
      }
    } catch (err) {
      setLicenseError(err instanceof Error ? err.message : "Не удалось активировать");
    } finally {
      setLicenseLoading(false);
    }
  };

  const handleDeactivateLicense = async (): Promise<void> => {
    await window.api.deactivateLicense();
    await refreshLicense();
    refreshAccounts();
  };

  const handleResync = async (): Promise<void> => {
    if (!allowAction("curate")) return;
    await window.api.resyncData();
    setShowResyncModal(false);
    window.api.startSync();
    window.api.getAccountInfo().then(setAccount);
  };

  const handleWipe = async (): Promise<void> => {
    setWipeInProgress(true);
    setDeletionError("");
    try {
      await window.api.wipeData();
      setShowWipeModal(false);
    } catch {
      setDeletionError(
        "Paperweight не удалось удалить все локальные данные. Закройте программы, использующие эти файлы, и попробуйте снова.",
      );
    } finally {
      setWipeInProgress(false);
    }
  };

  const handleSwitchAccount = async (email: string): Promise<void> => {
    setSwitchingEmail(email);
    try {
      await window.api.switchAccount(email);
      // accountSwitched event triggers App remount
    } catch {
      setSwitchingEmail(null);
    }
  };

  const handleAddAccount = async (): Promise<void> => {
    const result = await window.api.addAccount();
    if (result?.blocked && result.reason === "license_required") {
      licenseSectionRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    setAddAccountView("provider");
    setShowAddAccountModal(true);
  };

  const handleAddAccountSuccess = (): void => {
    setShowAddAccountModal(false);
    refreshAccounts();
  };

  const formatProvider = (type: string): string => {
    if (type === "gmail") return "Google";
    if (type === "microsoft") return "Microsoft";
    if (type === "imap") return "IMAP";
    return "Не подключено";
  };

  const formatDate = (ts?: number): string => {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDateTime = (ts?: number): string => {
    if (!ts) return "Никогда";
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const tierLabel = (status: LicenseStatus): string => {
    if (!status.active) return "Бесплатная";
    if (status.tier === "pro") return "Paperweight Pro";
    if (status.tier === "cleanup") return "Cleanup Pass";
    if (status.tier === "lifetime") return "Lifetime Pro";
    return "Лицензирована";
  };

  const connectionHealthy = !!connection;

  const handleReconnect = async (): Promise<void> => {
    if (!account) return;
    setReconnectFailure("");
    if (account.providerType === "imap") {
      setShowServerSettings(true);
      return;
    }
    setReconnectLoading(true);
    try {
      let result: { success: boolean; error?: string };
      if (account.providerType === "microsoft") {
        result = await window.api.startMicrosoftAuth({
          type: "reconnect",
          email: account.email,
        });
      } else if (account.providerType === "gmail") {
        result = await window.api.startGmailAuth({
          type: "reconnect",
          email: account.email,
        });
      } else {
        result = { success: false, error: "Переподключение для этого аккаунта недоступно" };
      }
      const error = reconnectError(result);
      if (error) {
        setReconnectFailure(error);
        return;
      }
      const conn = await window.api.getEmailConnection();
      setConnection(conn);
      setAccount(await window.api.getAccountInfo());
      window.api.startSync();
    } catch (err) {
      setReconnectFailure(err instanceof Error ? err.message : "Не удалось переподключиться");
    } finally {
      setReconnectLoading(false);
    }
  };

  const actionBusy = switchingEmail !== null || removeInProgress;
  const needsLicense = !license.active && accounts.length >= 1;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Настройки</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            title={
              colorTheme === "dim"
                ? "Светлая тема"
                : "Тёмная тема"
            }
            onClick={() => {
              const theme: ColorTheme = colorTheme === "dim" ? "silk" : "dim";
              setColorTheme(theme);
              applyAndSaveColorTheme(theme);
            }}
          >
            {colorTheme === "dim" ? (
              <Moon className="w-4 h-4" />
            ) : (
              <Sun className="w-4 h-4" />
            )}
          </button>
          <button
            className="btn btn-ghost btn-sm btn-square"
            onClick={() => navigate("/support")}
            title="Поддержка"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Section 1: Accounts */}
      <div id="accounts" ref={accountsSectionRef} className="card bg-base-200">
        <div className="card-body space-y-3">
          <h3 className="font-semibold">Аккаунты</h3>
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div
                key={acc.email}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={makeBlockie(acc.email)}
                    alt=""
                    className="w-9 h-9 rounded-lg shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {acc.email}
                      </span>
                      {acc.isActive && (
                        <span className="badge badge-xs badge-soft badge-success shrink-0">
                          Активен
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-base-content/50">
                      {formatProvider(acc.providerType)}
                      {acc.registeredAt
                        ? ` · Добавлен ${formatDate(acc.registeredAt)}`
                        : ""}
                      {` · ${formatBytes(acc.sizeBytes)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!acc.isActive && (
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={actionBusy}
                      onClick={() => handleSwitchAccount(acc.email)}
                    >
                      {switchingEmail === acc.email ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        "Переключить"
                      )}
                    </button>
                  )}
                  {acc.isActive && acc.providerType === "imap" && account?.server && (
                    <button
                      className="btn btn-ghost btn-xs"
                      disabled={actionBusy}
                      onClick={() => setShowServerSettings(true)}
                    >
                      Настроить
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-xs text-error"
                    disabled={actionBusy}
                    onClick={() => {
                      setDeletionError("");
                      setRemoveAccountEmail(acc.email);
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              className={`btn btn-sm w-fit ${needsLicense ? "btn-ghost" : "btn-primary"}`}
              onClick={handleAddAccount}
            >
              {needsLicense && <Lock className="w-3.5 h-3.5" />}
              Добавить аккаунт
            </button>
            {needsLicense && (
              <span className="text-xs text-base-content/50">
                Требуется Pro
              </span>
            )}
            <button
              type="button"
              className="btn btn-link btn-sm px-0"
              onClick={() => navigate("/profile")}
            >
              Управление профилем
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: License */}
      <div id="license" ref={licenseSectionRef} className="card bg-base-200">
        <div className="card-body space-y-4">
          <h3 className="font-semibold">
            {license.active ? "Лицензия" : "Перейти на Pro"}
          </h3>

          {account && (
            <>
              {license.active ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                    <span className="text-base-content/50">Тип</span>
                    <span>{tierLabel(license)}</span>

                    <span className="text-base-content/50">Ключ</span>
                    <span className="font-mono">
                      {license.key
                        ? `XXXX-XXXX-${license.key.slice(-4)}`
                        : ""}
                    </span>

                    {license.expiresAt && (
                      <>
                        <span className="text-base-content/50">Действует до</span>
                        <span>
                          {new Date(license.expiresAt).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() =>
                        window.api.openExternal(
                          license.portalUrl || "https://paperweight.email",
                        )
                      }
                    >
                      Управление
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={handleDeactivateLicense}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-base-content/60">
                    {PRO_UPGRADE_BODY}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="input input-bordered input-sm flex-1"
                      placeholder="Лицензионный ключ"
                      value={licenseKey}
                      onChange={(e) => setLicenseKey(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && handleActivateLicense()
                      }
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={licenseLoading || !licenseKey.trim()}
                      onClick={handleActivateLicense}
                    >
                      {licenseLoading ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        "Активировать"
                      )}
                    </button>
                  </div>
                  {licenseError && (
                    <p className="text-xs text-error">{licenseError}</p>
                  )}
                  <button
                    className="btn btn-primary btn-sm w-fit"
                    onClick={() =>
                      window.api.openExternal(`${APP_CONFIG.WEBSITE}/pricing`)
                    }
                  >
                    Тарифы Pro
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Section 3: Sync */}
      <div className="card bg-base-200">
        <div className="card-body space-y-3">
          <h3 className="font-semibold">Синхронизация</h3>

          {account && (
            <>
              <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <span className="text-base-content/50">Подключение</span>
                <span className="flex items-center gap-2">
                  {formatProvider(account.providerType)}
                  <span
                    className={`w-2 h-2 rounded-full ${connectionHealthy ? "bg-success" : "bg-error"}`}
                  />
                </span>

                <span className="text-base-content/50">Последняя синхронизация</span>
                <span>{formatDateTime(account.lastSyncAt)}</span>

                <span className="text-base-content/50">Синхронизировано писем</span>
                <span>{account.totalMessages.toLocaleString()}</span>

                <span className="text-base-content/50">Период</span>
                <span>Вся история</span>
              </div>

              {(account.providerType === "gmail" ||
                account.providerType === "microsoft" ||
                account.providerType === "imap") && (
                  <button
                    className="btn btn-sm btn-primary w-fit"
                    onClick={handleReconnect}
                    disabled={reconnectLoading}
                  >
                    {reconnectLoading ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      "Переподключить"
                    )}
                  </button>
                )}
              {reconnectFailure && (
                <p className="text-sm text-error">{reconnectFailure}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Section 4: App Settings */}
      <div className="card bg-base-200">
        <div className="card-body space-y-3">
          <h3 className="font-semibold">Приложение</h3>
          <div className="form-control">
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle toggle-primary toggle-sm"
                checked={autoLaunch}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setAutoLaunch(enabled);
                  if (!enabled) setLaunchMinimized(false);
                  window.api.saveSettings({
                    autoLaunch: enabled,
                    launchMinimized: enabled ? launchMinimized : false,
                  });
                }}
              />
              <span className="text-sm font-medium">Запускать при входе в систему</span>
            </label>
          </div>
          {autoLaunch && (
            <div className="form-control">
              <label className="label cursor-pointer justify-start gap-3">
                <input
                  type="checkbox"
                  className="toggle toggle-primary toggle-sm"
                  checked={launchMinimized}
                  onChange={(e) => {
                    const minimized = e.target.checked;
                    setLaunchMinimized(minimized);
                    window.api.saveSettings({ launchMinimized: minimized });
                  }}
                />
                <span className="text-sm font-medium">Открывать в фоне</span>
              </label>
              <p className="text-xs text-base-content/50 ml-12">
                Запускаться свёрнутым при автозапуске
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Section 5: AI Agent Access */}
      <div className="card bg-base-200">
        <div className="card-body space-y-3">
          <h3 className="font-semibold">Доступ ИИ-агентов (экспериментально)</h3>
          <p className="text-sm text-base-content/60">
            Доступ по MCP требует Pro. Выберите, что подключённые агенты могут делать в Paperweight.
          </p>

          <div
            role="alert"
            className="flex items-start gap-3 p-4 bg-warning/10 border border-warning/20 rounded-box"
          >
            <Lock
              className="w-5 h-5 mt-0.5 text-warning shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-semibold">Используйте только с моделями, которым доверяете</p>
              <p className="text-sm text-base-content/60">
                Данные могут передаваться провайдеру модели. Используйте локальную модель
                (например, Ollama), чтобы все данные оставались на устройстве.
              </p>
            </div>
          </div>

          <label className="form-control w-full max-w-sm flex flex-col gap-2">
            <span className="label-text text-sm font-medium">Доступ</span>
            <select
              className="select select-bordered select-sm"
              value={agentAccess}
              onChange={(event) => {
                const access = event.target.value;
                if (access !== "off" && access !== "read" && access !== "actions") return;
                if (access === "actions" && agentAccess !== "actions") {
                  setShowAgentActionsModal(true);
                  return;
                }
                if (agentAccess === "off" && access !== "off") {
                  setAgentMaskPersonalData(true);
                }
                setAgentAccess(access);
                void window.api.saveSettings({ agentAccess: access });
              }}
            >
              <option value="off">Выключен</option>
              <option value="read" disabled={!license.active}>Только чтение</option>
              <option value="actions" disabled={!license.active}>Чтение и запись</option>
            </select>
          </label>
          {agentAccess === "actions" ? (
            <div className="space-y-1 max-w-2xl">
              <p className="text-sm text-base-content/60">
                Агенты могут отписываться, удалять, помечать спам и изменять
                данные Paperweight для выбранного ящика.
              </p>
              <p className="text-xs text-base-content/50">
                Отправка запроса о данных или повторного письма требует подтверждения
                в агенте. Рекомендуем включить подтверждение вызовов инструментов
                в агенте. Используйте на свой риск.
              </p>
            </div>
          ) : (
            <p className="text-xs text-base-content/50">
              {agentAccess === "off"
                ? "У агентов нет доступа к Paperweight."
                : "Агенты могут читать данные, но ничего не менять."}
            </p>
          )}

          {agentAccess !== "off" && (
            <>
              <div className="divider my-1" />

              <div className="space-y-2">
                <div className="form-control">
                  <label className="label cursor-pointer justify-start gap-3">
                    <input
                      type="checkbox"
                      className="toggle toggle-primary toggle-sm"
                      checked={agentMaskPersonalData}
                      onChange={(event) => {
                        if (!event.target.checked) {
                          setShowAgentUnmaskModal(true);
                          return;
                        }
                        setAgentMaskPersonalData(true);
                        void window.api.saveSettings({ agentMaskPersonalData: true });
                      }}
                    />
                    <span className="text-sm font-medium">Маскировать личные данные</span>
                  </label>
                </div>
                {agentMaskPersonalData ? (
                  <>
                    <p className="text-sm text-base-content/60 max-w-2xl">
                      Paperweight маскирует известные личные данные: профиль,
                      найденные ПДн, адреса и совпадения в тексте писем. Это
                      делается по мере возможности — нераспознанные данные из писем
                      всё равно могут попасть к агенту.
                    </p>
                    <p className="text-xs text-base-content/50 max-w-2xl">
                      Рекомендуется при работе с агентами.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-warning max-w-2xl">
                    Агенту видны все личные данные, которые может показать приложение,
                    включая профиль и текст писем. Включите маскирование, если
                    не используете доверенную локальную модель.
                  </p>
                )}
              </div>

              <div className="divider my-1" />

              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Конфигурация MCP</h4>
                <p className="text-sm text-base-content/60">
                  Добавьте этот сервер в MCP-конфигурацию агента и перезапустите агента.
                </p>
                {mcpSetup?.available && mcpConfig ? (
                  <div className="space-y-2">
                    <pre className="rounded-box bg-base-300 p-3 overflow-x-auto text-xs">
                      <code>{mcpConfig}</code>
                    </pre>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={async () => {
                        await navigator.clipboard.writeText(mcpConfig);
                        setMcpConfigCopied(true);
                        window.setTimeout(() => setMcpConfigCopied(false), 2_000);
                      }}
                    >
                      {mcpConfigCopied ? "Скопировано" : "Копировать конфигурацию"}
                    </button>
                  </div>
                ) : mcpSetup ? (
                  <p className="text-sm text-error">
                    В этой сборке нет MCP-сервера Paperweight.
                  </p>
                ) : (
                  <span className="loading loading-spinner loading-xs" />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Section 6: Whitelist */}
      <div className="card bg-base-200">
        <div className="card-body space-y-3">
          <h3 className="font-semibold">Белый список</h3>
          <p className="text-sm text-base-content/60">
            Домены и адреса из белого списка скрыты из «Рассылок». Добавьте домен
            (например, example.com), чтобы разрешить всех его отправителей, или адрес
            (например, user@example.com), чтобы разрешить одного отправителя.
          </p>
          {whitelistEntries.length > 0 && (
            <div className="space-y-1">
              {whitelistEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <span>{entry.value}</span>
                  <button
                    className="btn btn-ghost btn-xs"
                    onClick={() => handleRemoveWhitelistEntry(entry.value)}
                  >
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="example.com или user@example.com"
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddEntry()}
            />
            <button className="btn btn-primary btn-sm" onClick={handleAddEntry}>
              Добавить
            </button>
          </div>
        </div>
      </div>

      {/* Section 7: Danger Zone */}
      <div className="card bg-base-200 border border-error/30">
        <div className="card-body space-y-4">
          <h3 className="font-semibold text-error">Опасная зона</h3>
          <div>
            <p className="text-sm text-base-content/60">
              Заново синхронизировать почту для {account?.email ?? "этого аккаунта"}.
              Подключения, настройки и белые списки сохранятся.
            </p>
            <button
              className="btn btn-error btn-outline btn-sm w-fit mt-2"
              onClick={() => setShowResyncModal(true)}
            >
              Пересинхронизировать
            </button>
          </div>
          <div>
            <p className="text-sm text-base-content/60">
              Удалить всё: аккаунты, письма, настройки, сохранённые
              учётные данные и лицензию.
            </p>
            <button
              className="btn btn-error btn-sm w-fit mt-2"
              onClick={() => {
                setDeletionError("");
                setShowWipeModal(true);
              }}
            >
              Стереть все данные
            </button>
          </div>
        </div>
      </div>

      {showAgentActionsModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Включить чтение и запись?</h3>
            <div className="py-4 space-y-3">
              <p>
                Агенты смогут действовать от вашего имени: отписываться, удалять
                письма и помечать их как спам. Отправка запроса о данных или
                повторного письма по-прежнему потребует явного подтверждения.
                Рекомендуем включить подтверждение вызовов инструментов в агенте.
              </p>
              <p>Используйте на свой риск.</p>
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setShowAgentActionsModal(false)}
              >
                Отмена
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await window.api.saveSettings({
                    agentAccess: "actions",
                    confirmAgentActions: true,
                  });
                  if (agentAccess === "off") setAgentMaskPersonalData(true);
                  setAgentAccess("actions");
                  setShowAgentActionsModal(false);
                }}
              >
                Включить чтение и запись
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowAgentActionsModal(false)}>закрыть</button>
          </form>
        </dialog>
      )}

      {showAgentUnmaskModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Отключить маскирование личных данных?</h3>
            <p className="py-4">
              Агент будет получать все обсуждаемые личные данные, включая
              профиль и текст писем. Используйте только с доверенной (локальной)
              моделью или оставьте маскирование включённым.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setShowAgentUnmaskModal(false)}
              >
                Оставить маскирование
              </button>
              <button
                className="btn btn-error"
                onClick={async () => {
                  await window.api.saveSettings({
                    agentMaskPersonalData: false,
                    confirmAgentUnmask: true,
                  });
                  setAgentMaskPersonalData(false);
                  setShowAgentUnmaskModal(false);
                }}
              >
                Отключить маскирование
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowAgentUnmaskModal(false)}>закрыть</button>
          </form>
        </dialog>
      )}

      {/* Add account modal */}
      {showAddAccountModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">Добавить аккаунт</h3>

            {addAccountView === "provider" && (
              <>
                <ProviderSelect
                  onGmail={(copy) => {
                    setAddAccountCopyFirst(copy);
                    setAddAccountView("gmail");
                  }}
                  onMicrosoft={(copy) => {
                    setAddAccountCopyFirst(copy);
                    setAddAccountView("microsoft");
                  }}
                  onApple={() => setAddAccountView("apple")}
                  onProton={() => setAddAccountView("proton")}
                  onImap={() => setAddAccountView("imap")}
                />
                <div className="modal-action mt-4">
                  <button
                    className="btn btn-ghost"
                    onClick={() => setShowAddAccountModal(false)}
                  >
                    Отмена
                  </button>
                </div>
              </>
            )}

            {addAccountView === "gmail" && (
              <GmailConnect
                intent={{ type: "add" }}
                copyFirst={addAccountCopyFirst}
                onSuccess={handleAddAccountSuccess}
                onBack={() => setAddAccountView("provider")}
              />
            )}

            {addAccountView === "microsoft" && (
              <MicrosoftConnect
                intent={{ type: "add" }}
                copyFirst={addAccountCopyFirst}
                onSuccess={handleAddAccountSuccess}
                onBack={() => setAddAccountView("provider")}
              />
            )}

            {addAccountView === "apple" && (
              <AppleConnect
                onSuccess={handleAddAccountSuccess}
                onBack={() => setAddAccountView("provider")}
              />
            )}

            {addAccountView === "proton" && (
              <ProtonConnect
                onSuccess={handleAddAccountSuccess}
                onBack={() => setAddAccountView("provider")}
              />
            )}

            {addAccountView === "imap" && (
              <ImapConnect
                onSuccess={handleAddAccountSuccess}
                onBack={() => setAddAccountView("provider")}
              />
            )}
          </div>
          {addAccountView === "provider" && (
            <form method="dialog" className="modal-backdrop">
              <button onClick={() => setShowAddAccountModal(false)}>
                закрыть
              </button>
            </form>
          )}
        </dialog>
      )}

      {/* Re-sync confirmation modal */}
      {showResyncModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Пересинхронизировать данные?</h3>
            <p className="py-4">
              Все синхронизированные письма и данные об отправителях для{" "}
              <span className="font-medium">{account?.email}</span> будут
              удалены, и Paperweight синхронизирует всё заново. Подключения,
              настройки и белые списки сохранятся.
            </p>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={() => setShowResyncModal(false)}
              >
                Отмена
              </button>
              <button className="btn btn-warning" onClick={handleResync}>
                Пересинхронизировать
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowResyncModal(false)}>закрыть</button>
          </form>
        </dialog>
      )}

      {/* Server settings modal (IMAP accounts only) */}
      {showServerSettings && account?.server && (
        <ServerSettingsModal
          email={account.email}
          initial={account.server}
          onClose={() => setShowServerSettings(false)}
          onSaved={() => {
            setShowServerSettings(false);
            setReconnectFailure("");
            window.api.getAccountInfo().then(setAccount);
            window.api.getEmailConnection().then(setConnection);
            window.api.startSync();
          }}
        />
      )}

      {/* Remove account confirmation modal */}
      {removeAccountEmail && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Удалить аккаунт?</h3>
            <p className="py-4">
              Данные аккаунта{" "}
              <span className="font-medium">{removeAccountEmail}</span> будут удалены
              безвозвратно, включая синхронизированные письма и настройки.
            </p>
            <p className="py-4">Лицензия при этом не затрагивается.</p>
            {deletionError && (
              <p className="text-sm text-error">{deletionError}</p>
            )}
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                disabled={removeInProgress}
                onClick={() => {
                  setDeletionError("");
                  setRemoveAccountEmail(null);
                }}
              >
                Отмена
              </button>
              <button
                className="btn btn-error"
                disabled={removeInProgress}
                onClick={async () => {
                  const email = removeAccountEmail;
                  setRemoveInProgress(true);
                  setDeletionError("");
                  try {
                    await window.api.removeAccount(email);
                    refreshAccounts();
                    setRemoveAccountEmail(null);
                  } catch {
                    setDeletionError(
                      "Paperweight не удалось удалить локальные данные аккаунта. Закройте программы, использующие эти файлы, и попробуйте снова.",
                    );
                  } finally {
                    setRemoveInProgress(false);
                  }
                }}
              >
                {removeInProgress ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Удалить"
                )}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button
              disabled={removeInProgress}
              onClick={() => {
                setDeletionError("");
                setRemoveAccountEmail(null);
              }}
            >
              закрыть
            </button>
          </form>
        </dialog>
      )}

      {/* Wipe confirmation modal */}
      {showWipeModal && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Стереть все данные?</h3>
            <p className="py-4">
              Будут безвозвратно удалены <strong>все аккаунты</strong>,
              синхронизированные письма, учётные данные, настройки и лицензия.
              Это действие нельзя отменить.
            </p>
            {deletionError && (
              <p className="text-sm text-error">{deletionError}</p>
            )}
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                disabled={wipeInProgress}
                onClick={() => {
                  setDeletionError("");
                  setShowWipeModal(false);
                }}
              >
                Отмена
              </button>
              <button
                className="btn btn-error"
                disabled={wipeInProgress}
                onClick={handleWipe}
              >
                {wipeInProgress ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Стереть всё"
                )}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button
              disabled={wipeInProgress}
              onClick={() => {
                setDeletionError("");
                setShowWipeModal(false);
              }}
            >
              закрыть
            </button>
          </form>
        </dialog>
      )}
    </div>
  );
}
