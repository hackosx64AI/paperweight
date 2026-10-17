// Paperweight's vendor category metadata and product risk presentation.
// Message-level vocabulary belongs to @paperweight/analysis.

export const RISK_CATEGORIES = {
  financial: {
    risk: "high",
    label: "Финансы",
    icon: "💳",
    dataAtRisk: [
      "Способы оплаты и карты",
      "История операций",
      "Остатки на счетах",
      "Налоговые сведения",
      "Кредитная история",
    ],
    sourceCategories: [
      "financial",
      "finance",
      "insurance",
      "credit agency",
      "collection agency",
    ],
  },

  healthcare: {
    risk: "high",
    label: "Медицина",
    icon: "🏥",
    dataAtRisk: [
      "Медицинские записи",
      "Сведения о медстраховке",
      "Рецепты и лекарства",
      "История приёмов",
      "Платёжные сведения",
    ],
    sourceCategories: ["healthcare", "health"],
  },

  government: {
    risk: "high",
    label: "Госорганы и образование",
    icon: "🏛️",
    dataAtRisk: [
      "Номера документов",
      "Налоговые сведения",
      "Сведения об образовании",
      "Сертификаты и удостоверения",
      "Идентификационные данные",
    ],
    sourceCategories: ["government", "public body", "school"],
  },

  marketing: {
    risk: "medium",
    label: "Маркетинг и брокеры данных",
    icon: "📊",
    dataAtRisk: [
      "Поведение в интернете",
      "Покупательские интересы",
      "Демографические данные",
      "Отслеживание местоположения",
      "Рекламные профили",
    ],
    sourceCategories: ["ads", "addresses"],
  },

  social: {
    risk: "medium",
    label: "Соцсети",
    icon: "💬",
    dataAtRisk: [
      "Сообщения и публикации",
      "Фото и видео",
      "Контакты и друзья",
      "История местоположений",
      "Данные личного профиля",
    ],
    sourceCategories: ["social media"],
  },

  communication: {
    risk: "medium",
    label: "Связь",
    icon: "📱",
    dataAtRisk: [
      "История звонков и сообщений",
      "Списки контактов",
      "Данные о местоположении",
      "Особенности использования",
    ],
    sourceCategories: ["telecommunication"],
  },

  shopping: {
    risk: "medium",
    label: "Покупки и путешествия",
    icon: "🛒",
    dataAtRisk: [
      "История покупок",
      "Адреса доставки",
      "Способы оплаты",
      "История просмотров",
      "Бронирования и паспортные данные",
    ],
    sourceCategories: ["commerce", "travel"],
  },

  entertainment: {
    risk: "low",
    label: "Развлечения",
    icon: "🎮",
    dataAtRisk: [
      "История просмотров и прослушиваний",
      "Предпочтения и рекомендации",
      "Игровые профили",
      "Подписки",
    ],
    sourceCategories: ["entertainment"],
  },

  services: {
    risk: "medium",
    label: "Сервисы и ЖКХ",
    icon: "⚡",
    dataAtRisk: [
      "Данные аккаунта",
      "Данные об использовании",
      "Платёжные сведения",
      "Домашний адрес",
    ],
    sourceCategories: ["utility", "church", "nonprofit", "political party"],
  },
};

export const RISK_LEVELS = {
  high: {
    color: "error",
    badge: "🔴",
    label: "Высокий риск",
    description: "Может содержать чувствительные финансовые, медицинские или идентификационные данные",
  },
  medium: {
    color: "warning",
    badge: "🟡",
    label: "Средний риск",
    description: "Может содержать личные или коммерческие данные",
  },
  low: {
    color: "success",
    badge: "🟢",
    label: "Низкий риск",
    description: "Вероятно, содержит лишь ограниченные личные данные",
  },
};
