// Phone detection, only libphonenumber-js import.
// The library finds and validates numbers with offsets; our only additions
// are the region hint and the bare-digit-run guard: a national number
// written without any separators (0881234567) must have phone vocabulary
// nearby, else it is an invoice/customer number (the main FP — 16-digit
// reference numbers parse as valid German phones, for example).
import { findPhoneNumbersInText, type CountryCode } from "libphonenumber-js";
import type { Finding } from "../types";

const PHONE_VOCAB =
  /\b(?:tel|telefoon(?:nummer)?|phone|telephone|mobile|mobiel|mob|handy|kontakt|contact|call|bel|whatsapp)\b[^]{0,40}$/i;
// Cyrillic vocabulary needs Unicode lookarounds (\b is ASCII-only).
const PHONE_VOCAB_RU =
  /(?<![\p{L}])(?:тел|телефон|моб|мобильный|звоните|позвоните|контакт(?:ы|ный)?|горячая линия|whatsapp|telegram)(?![\p{L}])[^]{0,40}$/iu;
// Russia/Kazakhstan write national numbers with trunk prefix 8: 8 (999) 123-45-67.
const TRUNK_8_REGIONS = new Set(["RU", "KZ"]);

export function detectPhones(text: string, region?: string): Finding[] {
  const defaultCountry =
    region && /^[A-Z]{2}$/.test(region) ? (region as CountryCode) : undefined;
  const findings: Finding[] = [];
  for (const m of findPhoneNumbersInText(text, defaultCountry)) {
    if (!m.number.isValid()) continue;
    const raw = text.slice(m.startsAt, m.endsAt);
    const international = raw.includes("+");
    // National-format numbers must look like one: trunk-prefix 0 (all our
    // wave-1 regions) or phone vocabulary nearby. Kills short service codes
    // (legacy service codes like "118 xxx" still validate) and digit runs in amounts/references.
    if (!international) {
      const before = text.slice(Math.max(0, m.startsAt - 45), m.startsAt);
      const vocab = PHONE_VOCAB.test(before) || PHONE_VOCAB_RU.test(before);
      const digits = raw.replace(/\D/g, "");
      const trunk =
        digits.startsWith("0")
        || (!!defaultCountry && TRUNK_8_REGIONS.has(defaultCountry) && digits.startsWith("8"));
      if (!trunk && !vocab) continue;
      if (!/[\s\-().\/]/.test(raw) && !vocab) continue;
    }
    const finding: Finding = {
      type: "phone",
      valueRaw: raw,
      valueNormalized: m.number.number,
      start: m.startsAt,
      end: m.endsAt,
      confidence: international ? "verified" : "contextual",
      signals: [international ? { id: "phone.country-code" } : { id: "phone.national", detail: defaultCountry }],
    };
    if (m.number.country) finding.country = m.number.country;
    findings.push(finding);
  }
  return findings;
}

// ccTLD of the sender domain as a region hint (uk is the one ccTLD that
// differs from its ISO country code). Used by analyzeMessage when the caller
// passes no locale.
export function regionFromDomain(domain?: string): string | undefined {
  const tld = domain?.split(".").pop()?.toLowerCase();
  // .рф (punycode xn--p1ai) and the legacy .su zone are Russian.
  if (tld === "xn--p1ai" || tld === "рф" || tld === "su") return "RU";
  if (!tld || tld.length !== 2) return undefined;
  const region = tld.toUpperCase();
  return region === "UK" ? "GB" : region;
}
