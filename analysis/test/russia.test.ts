import { describe, expect, it } from "vitest";
import { textTypeSignals } from "../src/classify/text-signals";
import { UNSUBSCRIBE_LINK_TEXT, FOOTER_CUE } from "../src/data/lexicons";
import { detectAddressBlocks } from "../src/detect/address";
import { detectNationalIds } from "../src/detect/national-id";
import { detectPhones } from "../src/detect/phone";
import { detectPostalCodes } from "../src/detect/postal-code";
import { extractKnownAddressComponents } from "../src/detect/address";
import { normalizeValue, validateValue } from "../src/profile-values";
import { LEXICONS } from "../src/data/lexicons";
import { detectKnownValues } from "../src/detect/known-values";

const ids = (signals: { id: string }[]): string[] => signals.map((s) => s.id);

describe("Russian lexicon", () => {
  it("classifies an order confirmation with a reference code and a rouble amount", () => {
    const signals = textTypeSignals(
      "Здравствуйте! Ваш заказ оформлен.\nЗаказ № 7781234 на сумму 1 290 ₽ передан в доставку.",
    );
    expect(ids(signals)).toContain("text.purchase-confirmation");
    expect(signals.find((s) => s.id === "text.reference-code")?.detail).toBe("7781234");
    expect(ids(signals)).toContain("text.amount");
  });

  it("recognizes account lifecycle mail", () => {
    expect(ids(textTypeSignals("Подтвердите ваш email, чтобы завершить регистрацию"))).toContain(
      "text.update-vocab",
    );
    expect(ids(textTypeSignals("Код подтверждения: 4821"))).toContain("text.update-vocab");
  });

  it("does not fire on a lone word inside other words", () => {
    // "заказчик" contains "заказ" but is not an order confirmation
    expect(ids(textTypeSignals("Наш заказчик доволен результатом работы"))).not.toContain(
      "text.purchase-confirmation",
    );
  });

  it("finds unsubscribe link texts and footer cues", () => {
    for (const text of ["Отписаться", "Отписаться от рассылки", "Отказаться от рассылки", "Управление подписками"]) {
      expect(UNSUBSCRIBE_LINK_TEXT.some((p) => p.test(text)), text).toBe(true);
    }
    expect(UNSUBSCRIBE_LINK_TEXT.some((p) => p.test("Подписаться на новости"))).toBe(false);
    expect(FOOTER_CUE.some((p) => p.test("Вы получили это письмо, потому что подписались"))).toBe(true);
  });
});

describe("Russian national IDs", () => {
  it("finds СНИЛС with a valid checksum and context", () => {
    const [finding] = detectNationalIds("СНИЛС: 112-233-445 95");
    expect(finding?.country).toBe("RU");
    expect(finding?.valueNormalized).toBe("11223344595");
  });

  it("rejects СНИЛС with a broken checksum or without context", () => {
    expect(detectNationalIds("СНИЛС: 112-233-445 96")).toEqual([]);
    expect(detectNationalIds("Номер договора 112-233-445 95")).toEqual([]);
  });

  it("finds a personal ИНН only next to the keyword", () => {
    expect(detectNationalIds("ИНН 500100732259")[0]?.country).toBe("RU");
    expect(detectNationalIds("Трек-номер 500100732259")).toEqual([]);
    expect(detectNationalIds("ИНН 500100732258")).toEqual([]);
  });

  it("finds a passport series and number as a contextual finding", () => {
    const [finding] = detectNationalIds("Паспорт 45 06 123456 выдан");
    expect(finding?.confidence).toBe("contextual");
    expect(finding?.valueNormalized).toBe("4506123456");
  });

  it("accepts dashed IDs in the profile", () => {
    expect(normalizeValue("national_id", "112-233-445 95")).toBe("11223344595");
    expect(validateValue("national_id", "112-233-445 95")).toBe(true);
  });
});

describe("Russian addresses", () => {
  const text = "ООО «Пример»\n101000, г. Москва, ул. Мясницкая, д. 15\nТел. 8 (495) 123-45-67";

  it("anchors a six-digit index on the following city", () => {
    const { candidates, findings } = detectPostalCodes(text);
    expect(findings).toEqual([]); // anchor-only: bare digits never surface alone
    const [address] = detectAddressBlocks(text, candidates);
    expect(address?.country).toBe("RU");
    expect(address?.valueRaw).toBe("ул. Мясницкая, д. 15");
  });

  it("ignores a bare six-digit number without a city", () => {
    const plain = "Код 101000 действует до конца месяца, ул. Мясницкая, д. 15";
    const { candidates } = detectPostalCodes(plain);
    expect(detectAddressBlocks(plain, candidates)).toEqual([]);
  });

  it("reads profile address components", () => {
    expect(extractKnownAddressComponents("Мясницкая 15, 101000 Москва")).toEqual({
      street: "мясницкая",
      houseNumber: "15",
      postalCode: "101000",
    });
  });
});

describe("Russian phones", () => {
  it("accepts trunk prefix 8 for Russian senders", () => {
    const [phone] = detectPhones("Горячая линия 8 (495) 123-45-67", "RU");
    expect(phone?.valueNormalized).toBe("+74951234567");
  });

  it("accepts a +7 number anywhere", () => {
    expect(detectPhones("+7 916 123-45-67")[0]?.valueNormalized).toBe("+79161234567");
  });
});

describe("Russian profile matching", () => {
  it("matches a profile address against the usual Russian spelling", () => {
    const raw = "ул. Мясницкая 15, 101000 Москва";
    const findings = detectKnownValues(
      "Доставка по адресу: 101000, г. Москва, ул. Мясницкая, д. 15, кв. 3",
      [{
        type: "address",
        valueNormalized: normalizeValue("address", raw),
        addressComponents: extractKnownAddressComponents(raw),
      }],
    );
    expect(findings).toHaveLength(1);
  });

  it("leaves casual Russian prose alone", () => {
    const prose =
      "привет как дела давно не виделись давай встретимся на выходных и обсудим поездку " +
      "к родителям я тебе потом напишу во сколько удобно";
    for (const lexicon of LEXICONS) {
      for (const category of ["purchaseConfirmation", "purchaseVocab", "updateVocab"] as const) {
        for (const pattern of lexicon[category]) {
          expect(pattern.test(prose), String(pattern)).toBe(false);
        }
      }
    }
  });
});
