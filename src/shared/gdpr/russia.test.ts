import { detectLanguageFromDomain, findDpaByDomain } from "./resolution";
import { buildDeletionEmail, buildFollowupEmail } from "./templates";

describe("Russian requests (152-ФЗ)", () => {
  it("picks Russian for .ru, .рф and .su companies", () => {
    expect(detectLanguageFromDomain("ozon.ru")).toBe("ru");
    expect(detectLanguageFromDomain("xn--80aswg.xn--p1ai")).toBe("ru");
    expect(detectLanguageFromDomain("example.su")).toBe("ru");
    expect(detectLanguageFromDomain("example.com")).toBe("en");
  });

  it("routes complaints to Roskomnadzor", () => {
    expect(findDpaByDomain("ozon.ru")?.dpaName).toContain("Роскомнадзор");
  });

  it("builds the deletion request under 152-ФЗ", () => {
    const email = buildDeletionEmail("me@example.ru", "client-42", "ru", "Иван Петров");
    expect(email.subject).toContain("уничтожении персональных данных");
    expect(email.body).toContain("ч. 2 ст. 9");
    expect(email.body).toContain("- Идентификатор аккаунта: client-42");
    expect(email.body.endsWith("Иван Петров")).toBe(true);
  });

  it("threads the follow-up onto the original request", () => {
    const email = buildFollowupEmail(undefined, "access", Date.UTC(2026, 0, 15), "me@example.ru", "ru");
    expect(email.subject).toBe("Re: Запрос сведений об обработке персональных данных");
    expect(email.body).toContain("15.01.2026");
    expect(email.body).toContain("Роскомнадзор");
  });
});
