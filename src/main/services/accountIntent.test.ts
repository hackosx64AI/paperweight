import { validateAccountIntent } from "./accountIntent";

describe("account connection intent", () => {
  it("rejects an add flow that resolves to an existing account", () => {
    expect(validateAccountIntent(
      { type: "add" },
      "Existing@Example.com",
      "gmail",
      [{
        email: "existing@example.com",
        providerType: "microsoft",
        registeredAt: 123,
      }],
      "other@example.com",
    )).toEqual({
      success: false,
      error: "Этот аккаунт уже подключён. Используйте «Переподключить».",
    });
  });

  it("rejects a reconnect flow that resolves to a different account", () => {
    expect(validateAccountIntent(
      { type: "reconnect", email: "existing@example.com" },
      "other@example.com",
      "gmail",
      [{
        email: "existing@example.com",
        providerType: "gmail",
        registeredAt: 123,
      }],
      "existing@example.com",
    )).toEqual({
      success: false,
      error: "Вход выполнен в другой аккаунт. Повторите вход с переподключаемым аккаунтом.",
    });
  });

  it("rejects reconnecting an account that is not active", () => {
    expect(validateAccountIntent(
      { type: "reconnect", email: "other@example.com" },
      "other@example.com",
      "gmail",
      [{
        email: "other@example.com",
        providerType: "gmail",
        registeredAt: 123,
      }],
      "active@example.com",
    )).toEqual({
      success: false,
      error: "Переподключаемый аккаунт больше не активен. Переключитесь на него и повторите.",
    });
  });

  it("rejects reconnecting through a different provider", () => {
    expect(validateAccountIntent(
      { type: "reconnect", email: "existing@example.com" },
      "existing@example.com",
      "gmail",
      [{
        email: "existing@example.com",
        providerType: "microsoft",
        registeredAt: 123,
      }],
      "existing@example.com",
    )).toEqual({
      success: false,
      error: "Этот аккаунт подключён через другого провайдера.",
    });
  });

  it("rejects reconnecting an account that is no longer registered", () => {
    expect(validateAccountIntent(
      { type: "reconnect", email: "missing@example.com" },
      "missing@example.com",
      "gmail",
      [],
      "missing@example.com",
    )).toEqual({
      success: false,
      error: "Этот аккаунт больше не подключён. Добавьте его заново.",
    });
  });

  it("allows adding a new account", () => {
    expect(validateAccountIntent(
      { type: "add" },
      "new@example.com",
      "gmail",
      [{
        email: "existing@example.com",
        providerType: "gmail",
        registeredAt: 123,
      }],
      "existing@example.com",
    )).toEqual({ success: true });
  });

  it("allows reconnecting the active account through its existing provider", () => {
    expect(validateAccountIntent(
      { type: "reconnect", email: "Existing@example.com" },
      "existing@EXAMPLE.COM",
      "gmail",
      [{
        email: "existing@example.com",
        providerType: "gmail",
        registeredAt: 123,
      }],
      "EXISTING@example.com",
    )).toEqual({ success: true });
  });
});