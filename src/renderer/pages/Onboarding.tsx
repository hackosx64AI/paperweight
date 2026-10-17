import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { HelpCircle, Search, Trash2, Globe } from "lucide-react";
import type { SupportInfo } from "@shared/types";
import DeviceInfoCard from "../components/DeviceInfoCard";
import HelpSection from "../components/HelpSection";
import {
  ProviderSelect,
  GmailConnect,
  MicrosoftConnect,
  AppleConnect,
  ProtonConnect,
  ImapConnect,
} from "../components/ProviderConnect";

// ── Carousel ─────────────────────────────────────────────────────────────────

const slides = [
  {
    icon: <Search className="w-10 h-10" />,
    title: "Анализ почты",
    description:
      "Paperweight сканирует ваши письма и раскладывает их на два раздела: «Рассылки» (новостные письма и подписки) и «Аккаунты» (все компании, у которых есть ваши данные). Начните с рассылок — там обычно больше всего мусора.",
  },
  {
    icon: <Trash2 className="w-10 h-10" />,
    title: "Уберите лишнее",
    description:
      "Просматривайте рассылки по объёму. В Pro можно отписываться, удалять письма и отмечать спам. Если отправитель поддерживает отписку в один клик, Paperweight сделает это автоматически; для остальных откроется страница отписки отправителя.",
  },
  {
    icon: <Globe className="w-10 h-10" />,
    title: "Управляйте цифровым следом",
    description:
      "Раздел «Аккаунты» показывает все компании, у которых хранятся ваши данные. Тем, чьими услугами вы больше не пользуетесь, в Pro можно отправить запрос на удаление по GDPR прямо из Paperweight. Бесплатно можно скопировать запрос и отправить его самостоятельно — данные аккаунта мы подставим.",
  },
];

function OnboardingCarousel(): JSX.Element {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setActive((i) => (i + 1) % slides.length),
      5000,
    );
    return () => clearInterval(id);
  }, []);

  const slide = slides[active];

  return (
    <div className="flex flex-col items-center text-center max-w-sm">
      <div className="mb-6 opacity-80 text-4xl">{slide.icon}</div>
      <h3 className="text-2xl font-bold mb-3">{slide.title}</h3>
      <p className="text-sm opacity-70 leading-relaxed">{slide.description}</p>
      <div className="flex gap-1 mt-8">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setActive(i)}
            className="p-2 flex items-center"
          >
            <span
              className={`block h-2.5 rounded-full transition-all duration-300 ${i === active
                  ? "w-8 bg-primary-content"
                  : "w-2.5 bg-primary-content/40"
                }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function Onboarding(): JSX.Element {
  const navigate = useNavigate();
  const [view, setView] = useState<
    "select" | "gmail" | "microsoft" | "apple" | "proton" | "imap"
  >("select");
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [supportInfo, setSupportInfo] = useState<SupportInfo>();
  const [copyFirst, setCopyFirst] = useState(false);

  // If the page reloads while on /onboarding (e.g. after accountSwitched fires)
  // and credentials are already present, redirect straight to dashboard.
  useEffect(() => {
    window.api.getConnectionStatus().then((connected) => {
      if (connected) navigate("/dashboard", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    if (showHelpModal) {
      window.api.getSupportInfo().then(setSupportInfo);
    }
  }, [showHelpModal]);

  const handleSuccess = (): void => {
    navigate("/dashboard");
  };

  return (
    <div className="flex h-screen bg-base-100">
      {/* Left panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 overflow-y-auto">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold">Начало работы</h2>
              <p className="text-base-content/60 text-sm mt-1">
                Подключите почтовый аккаунт
              </p>
            </div>
            <button
              className="btn btn-ghost btn-sm btn-square shrink-0"
              onClick={() => setShowHelpModal(true)}
              title="Помощь и сведения об устройстве"
              aria-label="Помощь и сведения об устройстве"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>

          {view === "select" && (
            <ProviderSelect
              onGmail={(copy) => {
                setCopyFirst(copy);
                setView("gmail");
              }}
              onMicrosoft={(copy) => {
                setCopyFirst(copy);
                setView("microsoft");
              }}
              onApple={() => setView("apple")}
              onProton={() => setView("proton")}
              onImap={() => setView("imap")}
            />
          )}
          {view === "gmail" && (
            <GmailConnect
              intent={{ type: "add" }}
              copyFirst={copyFirst}
              onSuccess={handleSuccess}
              onBack={() => setView("select")}
            />
          )}
          {view === "microsoft" && (
            <MicrosoftConnect
              intent={{ type: "add" }}
              copyFirst={copyFirst}
              onSuccess={handleSuccess}
              onBack={() => setView("select")}
            />
          )}
          {view === "apple" && (
            <AppleConnect
              onSuccess={handleSuccess}
              onBack={() => setView("select")}
            />
          )}
          {view === "proton" && (
            <ProtonConnect
              onSuccess={handleSuccess}
              onBack={() => setView("select")}
            />
          )}
          {view === "imap" && (
            <ImapConnect
              onSuccess={handleSuccess}
              onBack={() => setView("select")}
            />
          )}
        </div>
      </div>

      {/* Help modal */}
      {showHelpModal && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-bold text-lg">Помощь</h3>
            <div className="space-y-6 py-4">
              <DeviceInfoCard info={supportInfo} variant="plain" />
              <HelpSection variant="plain" />
            </div>
            <div className="modal-action">
              <button
                className="btn btn-primary"
                onClick={() => setShowHelpModal(false)}
              >
                Закрыть
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowHelpModal(false)}>закрыть</button>
          </form>
        </dialog>
      )}

      {/* Right panel */}
      <div className="flex-1 bg-primary text-primary-content flex items-center justify-center p-12">
        <OnboardingCarousel />
      </div>
    </div>
  );
}
