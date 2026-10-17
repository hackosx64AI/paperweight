export interface ProviderPreset {
  id: string;
  name: string;
  imap: { host: string; port: number; tls: boolean };
  smtp: { host: string; port: number; tls: boolean };
  allowSelfSigned?: boolean;
  supportUrl?: string;
  appSpecificPasswordUrl?: string;
  notes?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "apple",
    name: "iCloud Mail",
    imap: { host: "imap.mail.me.com", port: 993, tls: true },
    smtp: { host: "smtp.mail.me.com", port: 587, tls: false },
    supportUrl: "https://support.apple.com/en-us/102525",
    appSpecificPasswordUrl: "https://account.apple.com/sign-in",
  },
  {
    id: "proton",
    name: "Proton Mail",
    imap: { host: "127.0.0.1", port: 1143, tls: false },
    smtp: { host: "127.0.0.1", port: 1025, tls: false },
    allowSelfSigned: true,
    supportUrl: "https://proton.me/support/bridge",
    notes: "Proton Bridge должен быть установлен и запущен. Сверьте порты в приложении Bridge — они могут отличаться.",
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    imap: { host: "imap.mail.yahoo.com", port: 993, tls: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, tls: true },
    supportUrl: "https://help.yahoo.com/kb/SLN4075.html",
    appSpecificPasswordUrl: "https://login.yahoo.com/account/security",
  },
  {
    id: "fastmail",
    name: "Fastmail",
    imap: { host: "imap.fastmail.com", port: 993, tls: true },
    smtp: { host: "smtp.fastmail.com", port: 465, tls: true },
    supportUrl: "https://www.fastmail.help/hc/en-us/articles/1500000278342",
    appSpecificPasswordUrl: "https://app.fastmail.com/settings/security/devicekeys",
  },
  {
    id: "yandex",
    name: "Yandex Mail",
    imap: { host: "imap.yandex.com", port: 993, tls: true },
    smtp: { host: "smtp.yandex.com", port: 465, tls: true },
    supportUrl: "https://yandex.com/support/mail/mail-clients/others.html",
    appSpecificPasswordUrl: "https://id.yandex.com/security/app-passwords",
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    imap: { host: "imap.zoho.com", port: 993, tls: true },
    smtp: { host: "smtp.zoho.com", port: 465, tls: true },
    supportUrl: "https://www.zoho.com/mail/help/imap-access.html",
    notes: "Возможно, перед подключением нужно включить доступ по IMAP в настройках Zoho Mail. Также может понадобиться пароль приложения (если включена 2FA).",
  },
  {
    id: "mailbox",
    name: "Mailbox.org",
    imap: { host: "imap.mailbox.org", port: 993, tls: true },
    smtp: { host: "smtp.mailbox.org", port: 465, tls: true },
    supportUrl: "https://kb.mailbox.org/en/private/e-mail/e-mail-configuration/",
  },
  {
    id: "posteo",
    name: "Posteo",
    imap: { host: "posteo.de", port: 993, tls: true },
    smtp: { host: "posteo.de", port: 465, tls: true },
    supportUrl: "https://posteo.de/en/help/how-do-i-set-up-posteo-in-an-email-client-pop3-imap-and-smtp",
  },
  {
    id: "gmx",
    name: "GMX",
    imap: { host: "imap.gmx.com", port: 993, tls: true },
    smtp: { host: "mail.gmx.com", port: 587, tls: false },
    supportUrl: "https://support.gmx.com/pop-imap/imap/server.html",
    notes: "Возможно, перед подключением нужно включить доступ по IMAP в веб-настройках GMX.",
  },
];

export function findPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

export function findPresetByHost(host: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.imap.host === host);
}
