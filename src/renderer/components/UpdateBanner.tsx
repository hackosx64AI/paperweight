import type { UpdateInfo } from "@shared/ipc";

interface UpdateBannerProps {
  info: UpdateInfo | null;
  onDismiss: () => void;
}

export default function UpdateBanner({ info, onDismiss }: UpdateBannerProps): JSX.Element | null {
  if (!info) return null;

  return (
    <div className="flex items-start gap-3 p-4 bg-base-200 rounded-2xl">
      <span className={`mt-0.5 ${info.isMajor ? "text-warning" : "text-info"}`}>
        {info.isMajor ? "⚠" : "↑"}
      </span>
      <div className="flex-1">
        <p className="font-medium">
          {info.isMajor
            ? `Доступно крупное обновление — v${info.latest}`
            : `Доступна новая версия — v${info.latest}`}
        </p>
        <p className="text-sm text-base-content/60 mt-0.5">
          {info.isMajor
            ? "В этом выпуске значительные новые функции и изменения. "
            : `У вас v${info.current}. `}
          <button
            className="underline hover:no-underline"
            onClick={() => window.api.openExternal("https://github.com/hackosx64AI/paperweight/releases")}
          >
            Открыть выпуск
          </button>
        </p>
        <button
          className="btn btn-primary btn-sm mt-2"
          onClick={() => window.api.installUpdate()}
        >
          Перезапустить и обновить
        </button>
      </div>
      <button
        className="btn btn-ghost btn-xs"
        onClick={onDismiss}
        aria-label="Скрыть уведомление об обновлении"
      >
        ✕
      </button>
    </div>
  );
}
