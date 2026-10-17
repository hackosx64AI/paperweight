import { useActionAccess } from "../context/LicenseContext";
import { useEffect, useCallback, useState, type ReactNode } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import type {
  VendorDetail,
  VendorQuery,
  Message,
  UnsubscribeEntry,
  WhitelistEntry,
  GdprCaseSummary,
} from "@shared/types";
import { MARKETING_ACTION_TYPES } from "@shared/types";
import {
  formatRelativeDate,
  formatAbsoluteDate,
  formatBytes,
  plural,
} from "@shared/formatting";
import {
  LANGUAGES,
  detectLanguageFromDomain,
} from "@shared/gdpr/resolution";
import {
  buildDeletionEmail,
  buildAccessEmail,
} from "@shared/gdpr/templates";
import {
  isNoReplyEmail,
  pickGdprContactEmail,
} from "@shared/gdpr/contact";
import { RISK_CATEGORIES, RISK_LEVELS } from "@shared/vendor-risk";
import { getRootDomain, parseMailto, PAPERWEIGHT_UNSUB_BODY } from "@shared/utils";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Info,
} from "lucide-react";
import ActionModal from "../components/ActionModal";
import { CaseListRow } from "../components/CaseListRow";
import FoundInEmails from "../components/FoundInEmails";
import { canAccountSend } from "../utils/account";
import { errText } from "../utils/errText";
import { isGdprSendRecovery, type GdprSendRecovery } from "../utils/gdprSendRecovery";
import { requireSameMailbox, viewedMailboxEmail } from "../hooks/useAccounts";
import { APP_CONFIG } from "@shared/config";
import {
  ACTION_COLORS,
  activityEntryLabel,
  gdprRequestLabel,
} from "../utils/activityLabels";

// Названия языков письма-запроса для интерфейса; сам LANGUAGES общий с сайтом.
const LANGUAGE_LABELS_RU: Record<string, string> = {
  en: "Английский",
  nl: "Нидерландский",
  de: "Немецкий",
  fr: "Французский",
  es: "Испанский",
  it: "Итальянский",
  pt: "Португальский",
};

const RISK_BADGE_CLASS: Record<string, string> = {
  high: "badge-error",
  medium: "badge-warning",
  low: "badge-success",
  unknown: "badge-ghost",
};

const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;
const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;
const CLEANUP_GUIDE_URL = `${APP_CONFIG.WEBSITE}/guides/email-cleanup-tools-compared#the-tools`;

function tabClass(active: boolean): string {
  return `tab rounded-lg transition-colors ${
    active
      ? "tab-active bg-base-100 shadow-sm"
      : "text-base-content/50 hover:bg-base-100/50 hover:text-base-content/80"
  }`;
}

function EmailsBySender({
  messages,
  senderCount,
}: {
  messages: Message[];
  senderCount: number;
}) {
  const grouped = new Map<string, typeof messages>();
  for (const msg of messages) {
    const key = msg.sender_email ?? "unknown";
    const arr = grouped.get(key) ?? [];
    arr.push(msg);
    grouped.set(key, arr);
  }

  const perSenderLimit = grouped.size > 1 ? 5 : 10;

  return (
    <div>
      {[...grouped.entries()].map(([sender, msgs]) => (
        <div key={sender}>
          {senderCount > 1 && (
            <p className="text-xs text-base-content/50 font-medium px-4 pt-3 pb-1">
              {sender}
            </p>
          )}
          {msgs.slice(0, perSenderLimit).map((msg) => (
            <div key={msg.id} className="px-4 py-2 flex gap-4 text-sm">
              <span className="text-base-content/50 shrink-0 w-24 whitespace-nowrap">
                {formatRelativeDate(msg.date)}
              </span>
              <div className="min-w-0">
                <p className="truncate">{msg.subject ?? "(без темы)"}</p>
                {msg.body_preview && (
                  <p className="truncate text-base-content/40 text-xs">
                    {msg.body_preview}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function methodDescription(method: string, url: string): string {
  if (method === "rfc8058") {
    return "Автоматически отправить запрос на отписку.";
  }
  if (url.startsWith("mailto:")) {
    return "Отправит письмо об отписке с вашего аккаунта.";
  }
  return "Откроет страницу отписки в браузере.";
}

function unsubDescription(
  entry: UnsubscribeEntry,
  vendorName: string,
): JSX.Element {
  if (entry.method === "rfc8058") {
    return (
      <>
        Запрос на отписку будет автоматически отправлен{" "}
        <strong>{vendorName}</strong>.
      </>
    );
  }
  if (entry.url.startsWith("mailto:")) {
    return (
      <>
        Paperweight отправит письмо об отписке с вашего аккаунта{" "}
        <strong>{vendorName}</strong>.
      </>
    );
  }
  return (
    <>
      Страница отписки <strong>{vendorName}</strong> откроется в браузере.
      Завершите отписку там.
    </>
  );
}

const UNSUB_METHOD_PRIORITY = ["rfc8058", "list-unsubscribe", "footer"] as const;

function unsubSenderKey(entry: UnsubscribeEntry): string {
  return entry.senderEmail?.toLowerCase() || unsubTarget(entry);
}

function unsubTarget(entry: UnsubscribeEntry): string {
  if (entry.senderEmail) return entry.senderEmail;
  const url = entry.url.replace(/^<|>$/g, "").trim();
  if (url.startsWith("mailto:")) return parseMailto(url).to;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Several actions of one kind (e.g. one unsubscribe per mailing list) collapse
// under a single numbered row so the list stays scannable.
function ActionGroup({ index, label, description, doneCount, total, children }: {
  index: number;
  label: string;
  description: string;
  doneCount: number;
  total: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const done = doneCount === total;
  return (
    <div className="border-b border-base-200 last:border-0">
      <div
        className={`flex items-start gap-3 py-2.5 cursor-pointer transition-opacity ${done ? "opacity-40" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className={`text-sm font-medium tabular-nums shrink-0 mt-0.5 w-5 text-right ${done ? "text-base-content/30" : "text-base-content/40"}`}>
          {done ? "✓" : `${index}.`}
        </span>
        <div className={`flex-1 min-w-0 ${done ? "line-through" : ""}`}>
          <p className="text-sm">
            {label}{" "}
            <span className="text-base-content/50">
              ({doneCount > 0 ? `выполнено ${doneCount}/${total}` : total})
            </span>
          </p>
          <p className="text-xs text-base-content/50 mt-0.5">{description}</p>
        </div>
        <ChevronRight
          className={`w-4 h-4 mt-1 text-base-content/50 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
      </div>
      {open && <div className="pl-8 pb-1">{children}</div>}
    </div>
  );
}

function ActionTaskRow({ index, label, description, done, spinning, anyLoading, onAction, actionLabel, onMarkDone, variant }: {
  index?: number;
  label: string;
  description?: string;
  done: boolean;
  spinning: boolean;
  anyLoading: boolean;
  onAction: () => void;
  actionLabel: string;
  onMarkDone?: () => void;
  variant?: "warning";
}) {
  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-base-200 last:border-0 transition-opacity ${done ? "opacity-40" : ""}`}>
      <span className={`text-sm font-medium tabular-nums shrink-0 mt-0.5 w-5 text-right ${done ? "text-base-content/30" : "text-base-content/40"}`}>
        {done ? "✓" : index === undefined ? "•" : `${index}.`}
      </span>
      <div className={`flex-1 min-w-0 ${done ? "line-through" : ""}`}>
        <p className={`text-sm break-words ${variant === "warning" ? "text-warning font-semibold" : ""}`}>{label}</p>
        {description && <p className="text-xs text-base-content/50 mt-0.5">{description}</p>}
      </div>
      <div className="flex gap-1 shrink-0">
        <button
          className="btn btn-sm btn-neutral"
          disabled={done || anyLoading}
          onClick={onAction}
        >
          {spinning ? <span className="loading loading-spinner loading-xs" /> : actionLabel}
        </button>
        {onMarkDone && (
          <button
            className="btn btn-sm btn-ghost"
            disabled={done || anyLoading}
            onClick={onMarkDone}
          >
            Отметить выполненным
          </button>
        )}
      </div>
    </div>
  );
}

function WhitelistSection({
  title,
  entries,
  isLoading,
  onRemove,
}: {
  title: string;
  entries: WhitelistEntry[];
  isLoading: boolean;
  onRemove: (value: string) => void;
}): JSX.Element | null {
  if (entries.length === 0) return null;

  return (
    <div className="pl-3">
      <h4 className="text-xs font-medium text-base-content/60 mb-2 uppercase tracking-wide">
        {title}
      </h4>
      <div className="font-mono text-sm divide-y divide-base-300">
        {entries.map((entry) => (
          <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-4 py-2">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-base-content/40 shrink-0">
                {formatAbsoluteDate(Date.parse(entry.created_at))}
              </span>
              <span className="shrink-0 text-base-content/80">{entry.value}</span>
            </div>
            <button
              className="btn btn-ghost btn-xs"
              disabled={isLoading}
              onClick={() => onRemove(entry.value)}
            >
              Удалить
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AccountDetail(): JSX.Element {
  const allowAction = useActionAccess();
  const { groupKey } = useParams<{ groupKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as {
    accountNav?: {
      groupKeys: string[];
      currentIndex: number;
      vendorQuery: VendorQuery;
      total: number;
      restoreState: Record<string, unknown>;
    };
    openDataTab?: boolean;
  } | null;

  const accountNav = locState?.accountNav ?? null;
  const [detail, setDetail] = useState<VendorDetail>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [riskOpen, setRiskOpen] = useState(false);
  const [breachOpen, setBreachOpen] = useState(false);
  const [copiedField, setCopiedField] = useState<"to" | "subject" | "body" | null>(null);
  const [dataRequestType, setDataRequestType] = useState<"access" | "deletion">("deletion");
  const [accountIdentifier, setAccountIdentifier] = useState("");
  const [emailLanguage, setEmailLanguage] = useState("en");
  const [userName, setUserName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [pendingUnsub, setPendingUnsub] = useState<UnsubscribeEntry | null>(null);
  const [unsubCheck, setUnsubCheck] = useState<{
    entry: UnsubscribeEntry;
    trashAlso: boolean;
    errorMessage?: string;
  } | null>(null);
  const [unsubResult, setUnsubResult] = useState<{
    entry: UnsubscribeEntry;
    kind: "success" | "failure";
    fallbackMethods: UnsubscribeEntry[];
    trashAlso: boolean;
    errorMessage?: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"actions" | "data" | "emails" | "cases" | "activity">(
    locState?.openDataTab ? "data" : "actions",
  );
  const [pendingDelete, setPendingDelete] = useState<"marketing" | "all" | null>(null);
  const [deleteError, setDeleteError] = useState<string>();
  const [whitelistModalOpen, setWhitelistModalOpen] = useState(false);
  const [selectedWhitelistValues, setSelectedWhitelistValues] = useState<Set<string>>(new Set());
  const [whitelistLoading, setWhitelistLoading] = useState(false);
  const [whitelistEntries, setWhitelistEntries] = useState<WhitelistEntry[]>([]);
  const [gdprSendOpen, setGdprSendOpen] = useState<"send" | "record">();
  const [gdprSendError, setGdprSendError] = useState<string>();
  const [pendingGdprRecord, setPendingGdprRecord] = useState<GdprSendRecovery>();
  const [vendorCases, setVendorCases] = useState<GdprCaseSummary[]>([]);
  const [canSend, setCanSend] = useState(true);

  useEffect(() => {
    if (!groupKey) return;
    setLoading(true);
    setAccountIdentifier("");
    setRequestEmail("");
    setCopiedField(null);
    setDoneIds(new Set());
    setActiveItemId(null);
    setPendingUnsub(null);
    setUnsubCheck(null);
    setUnsubResult(null);
    setPendingDelete(null);
    setDeleteError(undefined);
    setWhitelistModalOpen(false);
    setSelectedWhitelistValues(new Set());
    setGdprSendOpen(undefined);
    setGdprSendError(undefined);
    setPendingGdprRecord(undefined);
    setVendorCases([]);
    Promise.all([
      window.api.getVendorDetail(decodeURIComponent(groupKey)),
      window.api.getWhitelistEntries(),
      window.api.getSettings(),
      window.api.getAccountInfo(),
    ])
      .then(async ([d, entries, settings, accountInfo]) => {
        setDetail(d);
        setWhitelistEntries(entries);
        setCanSend(canAccountSend(accountInfo));
        setEmailLanguage(detectLanguageFromDomain(d.vendor.root_domain));
        setBreachOpen(
          d.vendor.breachInfo?.some((b) => b.likelyAffected) ?? false,
        );
        if (settings.userName) setUserName(settings.userName);
        // Prefer what the headers show this vendor actually writes to, most
        // recent first. An address the user set by hand still wins.
        setRequestEmail(
          d.vendor.account_email
            ?? d.receivedAddresses[0]?.address
            ?? d.user_email
            ?? "",
        );
        const candidate = pickGdprContactEmail(d.company, d.senders);
        setRecipientEmail(
          candidate && !isNoReplyEmail(candidate) ? candidate : "",
        );
        const cases = await window.api.queryGdprCases({ vendorId: d.vendor.id });
        setVendorCases(cases);
      })
      .catch((err) => setError(err.message ?? "Не удалось загрузить"))
      .finally(() => setLoading(false));
  }, [groupKey]);

  const refreshDetail = useCallback(async () => {
    if (!groupKey) return;
    const d = await window.api.getVendorDetail(decodeURIComponent(groupKey));
    setDetail(d);
    const cases = await window.api.queryGdprCases({ vendorId: d.vendor.id });
    setVendorCases(cases);
  }, [groupKey]);

  // Mirrors the Cases list: pick up replies materialized by a sync that
  // finishes while the user is already sitting on this page.
  useEffect(() => {
    const unsub = window.api.onSyncProgress((status) => {
      if (!status.running) refreshDetail();
    });
    return unsub;
  }, [refreshDetail]);

  const refreshWhitelist = useCallback(async () => {
    const entries = await window.api.getWhitelistEntries();
    setWhitelistEntries(entries);
  }, []);

  const navigateToNeighbor = useCallback(async (direction: "prev" | "next") => {
    if (!accountNav) return;
    const { groupKeys, currentIndex, vendorQuery, total } = accountNav;
    const totalPages = Math.max(1, Math.ceil(total / vendorQuery.limit));
    const page = vendorQuery.page;

    if (direction === "prev") {
      if (currentIndex > 0) {
        const targetKey = groupKeys[currentIndex - 1];
        navigate(`/accounts/${encodeURIComponent(targetKey)}`, {
          state: { accountNav: { ...accountNav, currentIndex: currentIndex - 1 } },
        });
      } else if (page > 1) {
        const prevQuery = { ...vendorQuery, page: page - 1 };
        const data = await window.api.queryVendors(prevQuery);
        if (data.vendors.length > 0) {
          const newGroupKeys = data.vendors.map(v => v.root_domain ?? v.company_slug ?? String(v.id));
          navigate(`/accounts/${encodeURIComponent(newGroupKeys[newGroupKeys.length - 1])}`, {
            state: { accountNav: { groupKeys: newGroupKeys, currentIndex: newGroupKeys.length - 1, vendorQuery: prevQuery, total, restoreState: accountNav.restoreState } },
          });
        }
      }
    } else {
      if (currentIndex < groupKeys.length - 1) {
        const targetKey = groupKeys[currentIndex + 1];
        navigate(`/accounts/${encodeURIComponent(targetKey)}`, {
          state: { accountNav: { ...accountNav, currentIndex: currentIndex + 1 } },
        });
      } else if (page < totalPages) {
        const nextQuery = { ...vendorQuery, page: page + 1 };
        const data = await window.api.queryVendors(nextQuery);
        if (data.vendors.length > 0) {
          const newGroupKeys = data.vendors.map(v => v.root_domain ?? v.company_slug ?? String(v.id));
          navigate(`/accounts/${encodeURIComponent(newGroupKeys[0])}`, {
            state: { accountNav: { groupKeys: newGroupKeys, currentIndex: 0, vendorQuery: nextQuery, total, restoreState: accountNav.restoreState } },
          });
        }
      }
    }
  }, [accountNav, navigate]);

  const isFirstInList = !accountNav || (accountNav.currentIndex === 0 && accountNav.vendorQuery.page === 1);
  const isLastInList = !accountNav || (accountNav.currentIndex === accountNav.groupKeys.length - 1 && accountNav.vendorQuery.page >= Math.ceil(accountNav.total / accountNav.vendorQuery.limit));

  const handleToggleReviewed = async () => {
    if (!allowAction("curate")) return;
    if (!detail) return;
    const newValue = detail.vendor.status !== "reviewed";
    await window.api.markVendorReviewed(detail.vendor.id, newValue);
    setDetail({
      ...detail,
      vendor: { ...detail.vendor, status: newValue ? "reviewed" : undefined },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button
          className="btn btn-ghost btn-sm gap-1"
          onClick={() => navigate("/accounts", { state: accountNav ? { restore: accountNav.restoreState } : undefined })}
        >
          <ArrowLeft className="w-4 h-4" /> Назад к списку
        </button>
        <div className="card bg-base-200">
          <div className="card-body text-center">
            <p className="text-error">{error ?? "Компания не найдена"}</p>
          </div>
        </div>
      </div>
    );
  }

  const {
    vendor,
    company,
    senders,
    allMessages,
    first_activity,
    user_email,
    activityLog,
  } = detail;
  const breaches = vendor.breachInfo ?? [];
  const anyLikelyAffected = breaches.some((b) => b.likelyAffected);
  const displayName = vendor.name || vendor.root_domain || "Неизвестно";
  const risk = vendor.risk_level ?? "unknown";
  const riskInfo = RISK_LEVELS[risk as keyof typeof RISK_LEVELS];
  const cat = vendor.category_id ?? "unknown";
  const effectiveCat =
    cat !== "unknown"
      ? cat
      : vendor.has_orders
        ? "shopping"
        : vendor.has_account
          ? "services"
          : cat;
  const catInfo = RISK_CATEGORIES[effectiveCat as keyof typeof RISK_CATEGORIES];
  const badgeClass = RISK_BADGE_CLASS[risk] ?? "badge-ghost";

  const riskBadge = riskInfo?.badge ?? "⚪";
  const riskDescription =
    riskInfo?.description ?? "Недостаточно данных для оценки риска";
  const hasRiskDetails =
    !!catInfo || !!(company?.runs && company.runs.length > 0);

  const contactEmail = pickGdprContactEmail(company, senders);
  const requesterEmail = requestEmail.trim();
  const canBuildRequest = requesterEmail.includes("@");
  const deletionEmail = canBuildRequest
    ? buildDeletionEmail(requesterEmail, accountIdentifier || undefined, emailLanguage, userName || undefined)
    : undefined;
  const accessEmail = canBuildRequest
    ? buildAccessEmail(requesterEmail, accountIdentifier || undefined, emailLanguage, userName || undefined)
    : undefined;

  const domainUrl = company?.web
    ? company.web
    : `https://${vendor.root_domain ?? ""}`;

  const senderEmailOptions = [...new Set(
    senders
      .map((sender) => sender.sender_email?.toLowerCase())
      .filter((email): email is string => !!email),
  )];

  const senderDomains = [...new Set(
    senderEmailOptions
      .map((email) => email.split("@")[1]?.trim().toLowerCase())
      .filter((domain): domain is string => !!domain),
  )];

  const companyDomain = company?.web
    ? (() => {
      const candidate = company.web.trim().toLowerCase();
      if (!candidate) return undefined;
      try {
        return new URL(
          candidate.includes("://") ? candidate : `https://${candidate}`,
        ).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        return candidate.replace(/^www\./, "");
      }
    })()
    : undefined;

  const rootDomainOption = (() => {
    const domainCandidate =
      companyDomain ??
      vendor.root_domain?.trim().toLowerCase() ??
      senderDomains[0];
    return domainCandidate ? getRootDomain(domainCandidate) : undefined;
  })();

  const senderEmailSet = new Set(senderEmailOptions);
  const senderDomainSet = new Set(senderDomains);

  const whitelistOptions = [
    ...(rootDomainOption ? [rootDomainOption] : []),
    ...senderEmailOptions,
  ];

  const whitelistedValues = new Set(
    whitelistEntries.map((entry) => entry.value.trim().toLowerCase()),
  );

  const addableWhitelistOptions = whitelistOptions.filter(
    (option) => !whitelistedValues.has(option.trim().toLowerCase()),
  );

  const canOpenWhitelistModal = addableWhitelistOptions.length > 0;

  const knownWhitelistEntries = whitelistEntries.filter((entry) => {
    const value = entry.value.trim().toLowerCase();
    if (value.includes("@")) {
      return senderEmailSet.has(value);
    }
    return (
      senderDomainSet.has(value) ||
      (rootDomainOption !== undefined &&
        getRootDomain(value) === rootDomainOption)
    );
  });

  const sortedActivityLog = [...activityLog].sort(
    (a, b) => b.actionedAt - a.actionedAt,
  );

  const sortedWhitelistEntries = [...knownWhitelistEntries].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  const domainWhitelistEntries = sortedWhitelistEntries.filter(
    (entry) => !entry.value.includes("@"),
  );

  const emailWhitelistEntries = sortedWhitelistEntries.filter((entry) =>
    entry.value.includes("@"),
  );

  const addableDomainWhitelistOptions = addableWhitelistOptions.filter(
    (option) => !option.includes("@"),
  );

  const addableEmailWhitelistOptions = addableWhitelistOptions.filter((option) =>
    option.includes("@"),
  );

  const hasAnyActivity =
    sortedActivityLog.length > 0 || sortedWhitelistEntries.length > 0;

  const handleCopyField = async (text: string, field: "to" | "subject" | "body") => {
    await navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Many senders put a per-message token in the unsubscribe URL, so the URL
  // can't identify a list. Group by sender address instead: one unsubscribe
  // target per sender, keeping one alternative per method (newest first).
  const unsubBySender = new Map<string, UnsubscribeEntry[]>();
  for (const msg of detail?.bulkMessages ?? []) {
    const method = msg.unsubscribe_method;
    const url = msg.unsubscribe_url;
    if (!method || method === "none" || !url) continue;
    const entry: UnsubscribeEntry = { url, method, senderEmail: msg.sender_email };
    const key = unsubSenderKey(entry);
    const alternatives = unsubBySender.get(key) ?? [];
    if (alternatives.some((m) => m.method === method)) continue;
    alternatives.push(entry);
    unsubBySender.set(key, alternatives);
  }
  const unsubMethods: UnsubscribeEntry[] = [...unsubBySender.values()].map(
    (alternatives) =>
      UNSUB_METHOD_PRIORITY.map((p) => alternatives.find((m) => m.method === p)).find(Boolean) ??
      alternatives[0],
  );
  // Other ways to unsubscribe from the same sender, for when the first fails.
  const unsubFallbacks = (entry: UnsubscribeEntry): UnsubscribeEntry[] =>
    (unsubBySender.get(unsubSenderKey(entry)) ?? []).filter((m) => m.url !== entry.url);

  // Action item derivation
  const now = Date.now();
  const twoYearsAgo = now - TWO_YEARS_MS;
  const tenYearsAgo = now - TEN_YEARS_MS;

  const activeBulkMessages = detail.bulkMessages.filter(
    (m) => m.date > twoYearsAgo && m.status == null
  );
  const hasActiveSubscription = activeBulkMessages.length > 0 && unsubMethods.length > 0;
  const bulkCount = detail.bulkMessageCount;
  const totalCount = vendor.message_count;
  // Ancient: last seen > 10yr ago — company may no longer exist, so suggest verifying first.
  // Stale: last seen > 2yr ago (but not ancient) — deletion request is the right move.
  // No has_account requirement because transaction/notification emails are often classified as "personal" not "account".
  const isAncientAccount = !!(vendor.last_seen && vendor.last_seen < tenYearsAgo && totalCount >= 5);
  const isStaleAccount = !!(vendor.last_seen && vendor.last_seen < twoYearsAgo && !isAncientAccount && totalCount >= 5);
  const allEmailsAreMarketing = bulkCount > 0 && bulkCount === totalCount;
  const showDeleteMarketing = allEmailsAreMarketing;
  const showDeleteAll = totalCount > 0 && !allEmailsAreMarketing;

  const actionItems: string[] = [
    ...(anyLikelyAffected ? ["breachReview", "breachAccess", "breachDeletion"] : []),
    ...(hasActiveSubscription ? unsubMethods.map((m) => `unsub-${m.url}`) : []),
    ...(showDeleteMarketing ? ["deleteMarketing"] : []),
    ...(showDeleteAll ? ["deleteAll"] : []),
    ...((isAncientAccount && !anyLikelyAffected) ? ["checkActive"] : []),
    ...((isStaleAccount && !anyLikelyAffected) ? ["dataDeletion"] : []),
  ];
  // Multiple unsubscribe links share one number, as a single grouped step.
  const groupUnsubs = hasActiveSubscription && unsubMethods.length > 1;
  const actionSteps = [
    ...new Set(
      actionItems.map((id) => (groupUnsubs && id.startsWith("unsub-") ? "unsub" : id)),
    ),
  ];
  const stepNumber = (id: string): number => actionSteps.indexOf(id) + 1;

  function unsubEntryForId(id: string): UnsubscribeEntry | undefined {
    const url = id.replace(/^unsub-/, "");
    return unsubMethods.find((m) => m.url === url);
  }

  function handleItemAction(id: string) {
    if (id.startsWith("unsub-")) {
      const entry = unsubEntryForId(id);
      if (!entry) return;
      if (!allowAction("execute")) return;
      setActiveItemId(id);
      setPendingUnsub(entry);
    } else if (id === "deleteMarketing" || id === "deleteAll") {
      if (!allowAction("execute")) return;
      setActiveItemId(id);
      setDeleteError(undefined);
      setPendingDelete(id === "deleteAll" ? "all" : "marketing");
    } else if (id === "dataDeletion" || id === "breachAccess" || id === "breachDeletion") {
      setDataRequestType(id === "breachAccess" ? "access" : "deletion");
      setActiveTab("data");
    } else if (id === "checkActive") {
      window.api.openExternal(domainUrl);
    } else if (id === "breachReview") {
      setBreachOpen(true);
      document.getElementById("breach-alert")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const handleUnsubscribeConfirm = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!pendingUnsub || !detail) return;
    const entry = pendingUnsub;
    const vendorId = detail.vendor.id;
    const origin = viewedMailboxEmail();
    setActionLoading(true);
    try {
      if (entry.method === "rfc8058") {
        const fallbackMethods = unsubFallbacks(entry);
        const result = await window.api.executeRfc8058(entry.url);
        setPendingUnsub(null);
        if (result.success) {
          requireSameMailbox(origin);
          await window.api.markListUnsubscribed(vendorId, entry.url);
          setUnsubResult({
            entry,
            kind: "success",
            fallbackMethods: [],
            trashAlso: true,
          });
        } else {
          setUnsubResult({
            entry,
            kind: "failure",
            fallbackMethods,
            trashAlso: true,
            errorMessage: result.error,
          });
        }
      } else if (entry.url.startsWith("mailto:")) {
        const { to, subject, body } = parseMailto(entry.url);
        const fallbackMethods = unsubFallbacks(entry);
        const result = await window.api.sendEmail(to, subject, body || PAPERWEIGHT_UNSUB_BODY);
        setPendingUnsub(null);
        if (result.success) {
          requireSameMailbox(origin);
          await window.api.markListUnsubscribed(vendorId, entry.url);
          setUnsubResult({
            entry,
            kind: "success",
            fallbackMethods: [],
            trashAlso: true,
          });
        } else {
          setUnsubResult({
            entry,
            kind: "failure",
            fallbackMethods,
            trashAlso: true,
            errorMessage: result.error,
          });
        }
      } else {
        await window.api.openUnsubscribeUrl(entry.url);
        setPendingUnsub(null);
        setUnsubCheck({ entry, trashAlso: true });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubResultDone = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubResult || !detail) return;
    const { entry, trashAlso } = unsubResult;
    setActionLoading(true);
    try {
      if (trashAlso) {
        const result = await window.api.trashVendorMessages(detail.vendor.id, [...MARKETING_ACTION_TYPES]);
        if (!result.success) {
          setUnsubResult({
            ...unsubResult,
            errorMessage: result.error ?? "Отписка выполнена, но переместить письма в корзину не удалось.",
          });
          return;
        }
      }
      setUnsubResult(null);
      setDoneIds((prev) => new Set(prev).add(`unsub-${entry.url}`));
      setActiveItemId(null);
      await refreshDetail();
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubResultSpam = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubResult || !detail) return;
    const { entry } = unsubResult;
    setActionLoading(true);
    try {
      const result = await window.api.reportSpamVendor(detail.vendor.id);
      if (!result.success) {
        setUnsubResult({
          ...unsubResult,
          errorMessage: result.error ?? "Не удалось пометить как спам.",
        });
        return;
      }
      setUnsubResult(null);
      setDoneIds((prev) => new Set(prev).add(`unsub-${entry.url}`));
      setActiveItemId(null);
      await refreshDetail();
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubResultFallback = async (
    fallbackEntry: UnsubscribeEntry,
  ): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubResult || !detail) return;
    const { entry } = unsubResult;
    const origin = viewedMailboxEmail();
    setActionLoading(true);
    try {
      if (fallbackEntry.url.startsWith("mailto:")) {
        const { to, subject, body } = parseMailto(fallbackEntry.url);
        const result = await window.api.sendEmail(to, subject, body || PAPERWEIGHT_UNSUB_BODY);
        if (result.success) {
          requireSameMailbox(origin);
          await window.api.markListUnsubscribed(detail.vendor.id, fallbackEntry.url);
          setUnsubResult({
            entry,
            kind: "success",
            fallbackMethods: [],
            trashAlso: unsubResult.trashAlso,
          });
        } else {
          // Stay in the failure modal but surface the new error.
          setUnsubResult({
            ...unsubResult,
            errorMessage: result.error ?? "Не удалось отправить письмо об отписке.",
          });
        }
      } else {
        await window.api.openUnsubscribeUrl(fallbackEntry.url);
        setUnsubResult(null);
        setUnsubCheck({ entry, trashAlso: true });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubCheckDone = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubCheck || !detail) return;
    const { entry, trashAlso } = unsubCheck;
    const origin = viewedMailboxEmail();
    setActionLoading(true);
    try {
      requireSameMailbox(origin);
      await window.api.markListUnsubscribed(detail.vendor.id, entry.url);
      if (trashAlso) {
        requireSameMailbox(origin);
        const result = await window.api.trashVendorMessages(detail.vendor.id, [...MARKETING_ACTION_TYPES]);
        if (!result.success) {
          setUnsubCheck(null);
          setUnsubResult({
            entry,
            kind: "success",
            fallbackMethods: [],
            trashAlso,
            errorMessage: result.error ?? "Отписка выполнена, но переместить письма в корзину не удалось.",
          });
          return;
        }
      }
      setUnsubCheck(null);
      setDoneIds((prev) => new Set(prev).add(`unsub-${entry.url}`));
      setActiveItemId(null);
      await refreshDetail();
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubCheckSpam = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubCheck || !detail) return;
    const { entry } = unsubCheck;
    setActionLoading(true);
    try {
      const result = await window.api.reportSpamVendor(detail.vendor.id);
      if (!result.success) {
        setUnsubCheck({
          ...unsubCheck,
          errorMessage: result.error ?? "Не удалось пометить как спам.",
        });
        return;
      }
      setUnsubCheck(null);
      setDoneIds((prev) => new Set(prev).add(`unsub-${entry.url}`));
      setActiveItemId(null);
      await refreshDetail();
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!pendingDelete || !detail) return;
    setActionLoading(true);
    try {
      const result = pendingDelete === "all"
        ? await window.api.trashVendorMessages(detail.vendor.id)
        : await window.api.trashVendorMessages(detail.vendor.id, [...MARKETING_ACTION_TYPES]);
      if (!result.success) {
        setDeleteError(result.error ?? "Не удалось переместить письма в корзину.");
        return;
      }
      const doneId = pendingDelete === "all" ? "deleteAll" : "deleteMarketing";
      setPendingDelete(null);
      setDeleteError(undefined);
      setDoneIds((prev) => new Set(prev).add(doneId));
      setActiveItemId(null);
      await refreshDetail();
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenWhitelistModal = (): void => {
    if (!allowAction("curate")) return;
    if (!canOpenWhitelistModal) return;
    setSelectedWhitelistValues(new Set());
    setWhitelistModalOpen(true);
  };

  const handleToggleWhitelistValue = (value: string): void => {
    setSelectedWhitelistValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  };

  const handleWhitelistConfirm = async (): Promise<void> => {
    if (!allowAction("curate")) return;
    if (selectedWhitelistValues.size === 0) return;
    setWhitelistLoading(true);
    try {
      await Promise.all(
        Array.from(selectedWhitelistValues).map((value) =>
          window.api.addWhitelistEntry(value),
        ),
      );
      setWhitelistModalOpen(false);
      setSelectedWhitelistValues(new Set());
      await refreshWhitelist();
    } finally {
      setWhitelistLoading(false);
    }
  };

  const handleWhitelistRemove = async (value: string): Promise<void> => {
    if (!allowAction("curate")) return;
    setWhitelistLoading(true);
    try {
      await window.api.removeWhitelistEntry(value);
      await refreshWhitelist();
    } finally {
      setWhitelistLoading(false);
    }
  };

  // Takes the address explicitly so a caller that has just set state can pass
  // the new value: React has not re-rendered yet, so requesterEmail still holds
  // the old one at that point.
  const persistAccountEmail = async (address?: string): Promise<void> => {
    if (!allowAction("curate")) return;
    if (!detail) return;
    const next = (address ?? requesterEmail).trim();
    // Validate what is about to be saved, not what the field held before it.
    // Clearing the field and then picking a chip has to save the chip.
    if (!next.includes("@")) return;
    if ((detail.vendor.account_email ?? "") === next) return;
    await window.api.setVendorAccountEmail(detail.vendor.id, next);
    setDetail({
      ...detail,
      vendor: { ...detail.vendor, account_email: next },
    });
  };

  const handleRecordRequest = async (): Promise<void> => {
    if (!allowAction("curate")) return;
    const email = dataRequestType === "access" ? accessEmail : deletionEmail;
    if (!email || !recipientEmail || !detail || !canBuildRequest) return;
    setActionLoading(true);
    setGdprSendError(undefined);
    try {
      await persistAccountEmail();
      const created = await window.api.createGdprCase({
        vendorId: detail.vendor.id,
        requestType: dataRequestType,
        recipientEmail,
        subject: email.subject,
        body: email.body,
      });
      setGdprSendOpen(undefined);
      navigate(`/cases/${created.id}`);
    } catch (err) {
      setGdprSendError(errText(err, "Не удалось записать отправленный запрос."));
    } finally {
      setActionLoading(false);
    }
  };

  const handleGdprSend = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    const email = dataRequestType === "access" ? accessEmail : deletionEmail;
    if (!email || !recipientEmail || !detail || !canBuildRequest || !groupKey) return;
    const recovering = isGdprSendRecovery(pendingGdprRecord, groupKey, dataRequestType);
    const origin = viewedMailboxEmail();
    setActionLoading(true);
    setGdprSendError(undefined);
    try {
      try {
        requireSameMailbox(origin);
        await persistAccountEmail();
      } catch (err) {
        setGdprSendError(errText(err, "Не удалось сохранить email аккаунта."));
        return;
      }
      requireSameMailbox(origin);
      const result = await window.api.sendPrivacyRequest(
        detail.vendor.id,
        decodeURIComponent(groupKey),
        dataRequestType,
        recipientEmail,
        accountIdentifier || undefined,
        emailLanguage,
        recovering ? pendingGdprRecord.messageId : undefined,
        recovering,
      );
      if (result.status === "failed") {
        setGdprSendError("Не удалось отправить запрос.");
        return;
      }
      if (result.status === "no_recipient" || result.status === "active_case_exists") {
        setGdprSendError(
          result.status === "active_case_exists"
            ? "Активный запрос этого типа уже существует."
            : "Нет получателя.",
        );
        return;
      }
      if (result.status === "sent_case_failed") {
        setPendingGdprRecord({
          groupKey,
          requestType: dataRequestType,
          messageId: result.messageId,
        });
        setGdprSendError("Запрос отправлен, но открыть обращение не удалось. Не отправляйте повторно.");
        return;
      }
      if (result.status !== "sent" || result.caseId === undefined) {
        setGdprSendError("Не удалось отправить запрос.");
        return;
      }
      setGdprSendOpen(undefined);
      setPendingGdprRecord(undefined);
      navigate(`/cases/${result.caseId}`);
    } catch (err) {
      setGdprSendError(errText(err, "Не удалось отправить запрос."));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost btn-sm gap-1"
            onClick={() => navigate("/accounts", { state: accountNav ? { restore: accountNav.restoreState } : undefined })}
          >
            <ArrowLeft className="w-4 h-4" /> Назад к списку
          </button>
          {accountNav && (
            <>
              <button
                className="btn btn-ghost btn-sm btn-circle"
                disabled={isFirstInList}
                onClick={() => navigateToNeighbor("prev")}
                title="Предыдущий аккаунт"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-circle"
                disabled={isLastInList}
                onClick={() => navigateToNeighbor("next")}
                title="Следующий аккаунт"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm btn-ghost"
            onClick={handleOpenWhitelistModal}
            disabled={!canOpenWhitelistModal || whitelistLoading}
          >
            В белый список
          </button>
          <button
            className={`btn btn-sm ${vendor.status === "reviewed" ? "btn-ghost" : "btn-neutral"}`}
            onClick={handleToggleReviewed}
          >
            {vendor.status === "reviewed" ? "Снять отметку" : "Отметить проверенным"}
          </button>
        </div>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-bold">{displayName}</h1>
          {vendor.company_slug && (
            <BadgeCheck
              className="w-5 h-5 text-info shrink-0"
              strokeWidth={2}
              aria-label="Проверенная компания"
            />
          )}
          <button
            className="text-base-content/40 text-sm hover:text-base-content/70 hover:underline inline-flex items-center gap-1"
            onClick={() => window.api.openExternal(domainUrl)}
          >
            {vendor.root_domain ?? "(неизвестно)"} <ExternalLink className="w-3 h-3" />
          </button>
        </div>
        <p className="text-sm text-base-content/50 mt-1">
          Посмотрите, что эта компания знает о вас, и решите, что делать. Для старых
          аккаунтов стоит отписаться и запросить удаление данных.
        </p>
        {company?.categories && company.categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {company.categories.map((c) => {
              const info = RISK_CATEGORIES[c as keyof typeof RISK_CATEGORIES];
              return info ? (
                <span
                  key={c}
                  className={`badge badge-sm badge-soft ${badgeClass}`}
                >
                  {info.icon} {info.label}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-base-content/50 uppercase">Впервые</p>
          <p className="font-medium">
            {(first_activity ?? vendor.first_seen) ? formatAbsoluteDate(first_activity ?? vendor.first_seen ?? 0) : "Неизвестно"}
          </p>
        </div>
        <div>
          <p className="text-xs text-base-content/50 uppercase">Последний раз</p>
          <p className="font-medium">
            {vendor.last_seen ? formatRelativeDate(vendor.last_seen) : "Неизвестно"}
          </p>
        </div>
        <div>
          <p className="text-xs text-base-content/50 uppercase">Письма</p>
          <p className="font-medium tabular-nums">{vendor.message_count}</p>
        </div>
        <div>
          <p className="text-xs text-base-content/50 uppercase">Отправители</p>
          <p className="font-medium tabular-nums">{vendor.sender_count}</p>
        </div>
      </div>

      {/* Breach alert */}
      {breaches.length > 0 && (
        <div
          id="breach-alert"
          className={`card ${anyLikelyAffected ? "bg-error/10 border border-error/30" : "bg-warning/10 border border-warning/30"}`}
        >
          <div
            className="p-4 flex items-center gap-3 cursor-pointer"
            onClick={() => setBreachOpen(!breachOpen)}
          >
            <ChevronRight
              className={`w-4 h-4 text-base-content/50 shrink-0 transition-transform ${breachOpen ? "rotate-90" : ""}`}
              strokeWidth={2}
            />
            <span className="text-lg">{anyLikelyAffected ? "⚠️" : "ℹ️"}</span>
            <span className="font-semibold">
              {anyLikelyAffected ? "Предупреждение безопасности" : "Инцидент безопасности в прошлом"}
            </span>
          </div>
          {breachOpen && (
            <div className="px-4 pb-4 flex flex-col gap-4">
              <ul className="text-sm space-y-1 list-disc list-inside">
                {breaches.map((bi) => (
                  <li key={bi.breach.name}>
                    <button
                      className="font-semibold underline hover:text-base-content/80"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.api.openExternal(
                          `https://haveibeenpwned.com/Breach/${bi.breach.name}`,
                        );
                      }}
                    >
                      {bi.breach.title}
                    </button>{" "}
                    — утечка{" "}
                    <span>
                      {new Date(bi.breach.breachDate).toLocaleDateString()}
                    </span>{" "}
                    —{" "}
                    {bi.likelyAffected
                      ? "ваши данные, вероятно, попали в утечку"
                      : "ваши данные, скорее всего, не пострадали"}
                    .
                  </li>
                ))}
              </ul>
              {(() => {
                const combined = [
                  ...new Set(
                    breaches
                      .filter((b) => b.likelyAffected)
                      .flatMap((b) => b.breach.dataClasses),
                  ),
                ];
                return combined.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {combined.map((item) => (
                      <span
                        key={item}
                        className="badge badge-sm badge-outline badge-error"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              <p className="text-xs text-base-content/50">
                Источник: haveibeenpwned.com
              </p>
            </div>
          )}
        </div>
      )}

      {/* Risk profile is category-based context, not observed email data. */}
      <div className="card bg-base-200">
        <div
          className={`p-4 flex items-center gap-3 ${hasRiskDetails ? "cursor-pointer" : ""}`}
          onClick={hasRiskDetails ? () => setRiskOpen(!riskOpen) : undefined}
        >
          {/* Chevron slot stays reserved so titles line up with Personal data. */}
          <ChevronRight
            className={`w-4 h-4 text-base-content/50 shrink-0 transition-transform ${
              riskOpen ? "rotate-90" : ""
            } ${hasRiskDetails ? "" : "invisible"}`}
            strokeWidth={2}
          />
          <span className="font-semibold shrink-0">Профиль риска</span>
          <span className="shrink-0">{riskBadge}</span>
          <span className="text-base-content/60 text-sm truncate">
            {riskDescription}
          </span>
        </div>
        {riskOpen && hasRiskDetails && (
          <div className="px-4 pb-4 space-y-4">
            {catInfo && (
              <div>
                <p className="text-sm font-medium mb-3">Какие данные у них вероятно есть</p>
                <div className="flex flex-wrap gap-2">
                  {catInfo.dataAtRisk.map((item) => (
                    <span key={item} className="badge badge-sm badge-soft">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {company?.runs && company.runs.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-3">
                  {company.name} также управляет:
                </p>
                <div className="flex flex-wrap gap-2">
                  {company.runs.map((run) => (
                    <span key={run} className="badge badge-sm badge-soft">
                      {run}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <FoundInEmails
        vendorId={vendor.id}
        vendorName={displayName}
      />

      {/* Tabs */}
      <div className="tabs tabs-box p-2">
        <div role="tablist" className="tabs tabs-md flex gap-1">
          <button
            role="tab"
            aria-selected={activeTab === "actions"}
            className={tabClass(activeTab === "actions")}
            onClick={() => setActiveTab("actions")}
          >
            Действия
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "data"}
            className={tabClass(activeTab === "data")}
            onClick={() => setActiveTab("data")}
          >
            Запросы о данных
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "emails"}
            className={tabClass(activeTab === "emails")}
            onClick={() => setActiveTab("emails")}
          >
            Письма
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "cases"}
            className={tabClass(activeTab === "cases")}
            onClick={() => setActiveTab("cases")}
          >
            Обращения{vendorCases.length > 0 ? ` (${vendorCases.length})` : ""}
          </button>

          <div className={hasAnyActivity ? "" : "tooltip tooltip-bottom"} data-tip={hasAnyActivity ? undefined : "Пока нет действий"}>
            <button
              role="tab"
              aria-selected={activeTab === "activity"}
              className={`${tabClass(activeTab === "activity")} ${hasAnyActivity ? "" : "tab-disabled opacity-40 cursor-not-allowed"}`}
              onClick={() => { if (hasAnyActivity) setActiveTab("activity"); }}
            >
              Журнал
            </button>
          </div>
        </div>

        {/* Actions tab */}
        <div className={`tab-content mt-2 rounded-box bg-base-100/50 w-full px-4 py-3 ${activeTab === "actions" ? "!block" : ""}`}>
          {actionItems.length === 0 ? (
            <p className="text-base-content/50 text-sm">Для этой компании нет рекомендуемых действий.</p>
          ) : (
            <div>
              {/* Contextual recommendation blurb */}
              <p className="text-sm text-base-content/60 mb-4">
                {(() => {
                  const parts: string[] = [];
                  if (anyLikelyAffected) {
                    parts.push(`Этот отправитель пострадал от утечки, которая, вероятно, затронула ваш аккаунт. Ваши данные могут быть под угрозой — стоит посмотреть, что утекло, и принять меры.`);
                  }
                  if (isAncientAccount) {
                    const yearsAgo = vendor.last_seen
                      ? Math.round((now - vendor.last_seen) / (365.25 * 24 * 60 * 60 * 1000))
                      : null;
                    parts.push(`Этот отправитель последний раз писал вам${yearsAgo ? ` более ${yearsAgo} ${plural(yearsAgo, "года", "лет", "лет")}` : " очень давно"} назад. Возможно, компании уже нет — проверьте это, прежде чем что-то делать.`);
                  } else if (isStaleAccount) {
                    const yearsAgo = vendor.last_seen
                      ? Math.round((now - vendor.last_seen) / (365.25 * 24 * 60 * 60 * 1000))
                      : null;
                    parts.push(`Этот отправитель не писал вам${yearsAgo ? ` более ${yearsAgo} ${plural(yearsAgo, "года", "лет", "лет")}` : " долгое время"}, но ваши данные у него остаются. Запрос на удаление снимет этот риск.`);
                  }
                  if (hasActiveSubscription) {
                    parts.push(`Этот отправитель всё ещё присылает рекламу. Отписка уменьшит мусор в почте и объём данных, которые о вас собирают.`);
                  }
                  if ((showDeleteMarketing || showDeleteAll) && !hasActiveSubscription && !isStaleAccount && !isAncientAccount && !anyLikelyAffected) {
                    const base = `Удаление этих писем уберёт из вашей почты личные данные, связанные с этим отправителем.`;
                    parts.push(totalCount > 100 ? `Этот отправитель прислал вам очень много писем. ${base}` : base);
                  }
                  return parts.join(" ");
                })()}
              </p>

              {anyLikelyAffected && (
                <ActionTaskRow
                  index={stepNumber("breachReview")}
                  label="Изучите инцидент безопасности"
                  description="Проверьте, какие данные утекли. Подробности — в предупреждении безопасности на этой странице."
                  done={doneIds.has("breachReview")}
                  spinning={false}
                  anyLoading={actionLoading}
                  actionLabel="Посмотреть"
                  variant="warning"
                  onAction={() => handleItemAction("breachReview")}
                />
              )}
              {anyLikelyAffected && (
                <ActionTaskRow
                  index={stepNumber("breachAccess")}
                  label="Запросить свои данные"
                  description="Попросить отправителя предоставить все данные о вас. Откроется заполненный запрос на вкладке «Запросы о данных»."
                  done={doneIds.has("breachAccess")}
                  spinning={false}
                  anyLoading={actionLoading}
                  actionLabel="Открыть"
                  onAction={() => handleItemAction("breachAccess")}
                />
              )}
              {anyLikelyAffected && (
                <ActionTaskRow
                  index={stepNumber("breachDeletion")}
                  label="Запросить удаление данных"
                  description="Попросить отправителя удалить все данные о вас. Откроется заполненный запрос на вкладке «Запросы о данных»."
                  done={doneIds.has("breachDeletion")}
                  spinning={false}
                  anyLoading={actionLoading}
                  actionLabel="Открыть"
                  onAction={() => handleItemAction("breachDeletion")}
                />
              )}
              {hasActiveSubscription && !groupUnsubs && unsubMethods.map((entry) => {
                const id = `unsub-${entry.url}`;
                return (
                  <ActionTaskRow
                    key={id}
                    index={stepNumber(id)}
                    label="Отписаться"
                    description={`${unsubTarget(entry)} · ${methodDescription(entry.method, entry.url)}`}
                    done={doneIds.has(id)}
                    spinning={activeItemId === id && actionLoading}
                    anyLoading={actionLoading}
                    actionLabel="Отписаться"
                    onAction={() => handleItemAction(id)}
                  />
                );
              })}
              {groupUnsubs && (
                <ActionGroup
                  index={stepNumber("unsub")}
                  label="Отписаться"
                  description={`Письма приходят с ${unsubMethods.length} ${plural(unsubMethods.length, "адреса", "адресов", "адресов")}`}
                  doneCount={unsubMethods.filter((m) => doneIds.has(`unsub-${m.url}`)).length}
                  total={unsubMethods.length}
                >
                  {unsubMethods.map((entry) => {
                    const id = `unsub-${entry.url}`;
                    return (
                      <ActionTaskRow
                        key={id}
                        label={unsubTarget(entry)}
                        description={methodDescription(entry.method, entry.url)}
                        done={doneIds.has(id)}
                        spinning={activeItemId === id && actionLoading}
                        anyLoading={actionLoading}
                        actionLabel="Отписаться"
                        onAction={() => handleItemAction(id)}
                      />
                    );
                  })}
                </ActionGroup>
              )}
              {showDeleteMarketing && (
                <ActionTaskRow
                  index={stepNumber("deleteMarketing")}
                  label="Удалить рекламные письма"
                  description={`Переместит в корзину рекламные и новостные письма: ${bulkCount}`}
                  done={doneIds.has("deleteMarketing")}
                  spinning={activeItemId === "deleteMarketing" && actionLoading}
                  anyLoading={actionLoading}
                  actionLabel="Удалить"
                  onAction={() => handleItemAction("deleteMarketing")}
                />
              )}
              {showDeleteAll && (
                <ActionTaskRow
                  index={stepNumber("deleteAll")}
                  label="Удалить все письма"
                  description={`Переместит в корзину все письма от этого отправителя (${vendor.message_count}), включая чеки и уведомления`}
                  done={doneIds.has("deleteAll")}
                  spinning={activeItemId === "deleteAll" && actionLoading}
                  anyLoading={actionLoading}
                  actionLabel="Удалить"
                  onAction={() => handleItemAction("deleteAll")}
                />
              )}
              {isAncientAccount && !anyLikelyAffected && (
                <ActionTaskRow
                  index={stepNumber("checkActive")}
                  label="Проверьте, работает ли ещё компания"
                  description="Возможно, этой компании уже нет. Зайдите на их сайт, прежде чем что-то делать."
                  done={doneIds.has("checkActive")}
                  spinning={false}
                  anyLoading={actionLoading}
                  actionLabel="Открыть сайт"
                  onAction={() => handleItemAction("checkActive")}
                />
              )}
              {isStaleAccount && !anyLikelyAffected && (
                <ActionTaskRow
                  index={stepNumber("dataDeletion")}
                  label="Запросить удаление данных"
                  description="Попросить отправителя удалить все данные о вас. Откроется заполненный запрос на вкладке «Запросы о данных»."
                  done={doneIds.has("dataDeletion")}
                  spinning={false}
                  anyLoading={actionLoading}
                  actionLabel="Открыть"
                  onAction={() => handleItemAction("dataDeletion")}
                />
              )}
            </div>
          )}
        </div>

        {/* Data requests tab */}
        <div className={`tab-content mt-2 rounded-box bg-base-100/50 w-full px-4 py-3 text-sm space-y-3 ${activeTab === "data" ? "!block" : ""}`}>
          {company?.comments &&
            company.comments.length > 0 &&
            company.comments.map((comment, i) => (
              <p key={i} className="text-base-content/70">
                {comment}
              </p>
            ))}

          {company?.webform && (
            <>
              <button
                className="btn btn-primary btn-sm gap-1"
                onClick={() => window.api.openExternal(company.webform!)}
              >
                Открыть форму запроса о данных <ExternalLink className="w-3.5 h-3.5" />
              </button>
              {contactEmail && (deletionEmail || accessEmail) && <hr className="border-base-100 mt-2 mb-4" />}
            </>
          )}

          {(user_email || canBuildRequest) ? (
            <>
              {!company && (
                <p className="text-base-content/50 text-xs">
                  Этот контактный адрес не проверен. Перед отправкой запроса рекомендуем свериться с их политикой конфиденциальности.
                </p>
              )}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-base-content/50 uppercase shrink-0 w-28">Язык письма</label>
                  <select
                    className="select select-bordered select-sm"
                    value={emailLanguage}
                    onChange={(e) => { setEmailLanguage(e.target.value); setCopiedField(null); }}
                  >
                    {Object.entries(LANGUAGES).map(([code, { label, flag }]) => (
                      <option key={code} value={code}>{flag}  {LANGUAGE_LABELS_RU[code] ?? label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-base-content/50 uppercase shrink-0 w-28">Цель</label>
                  <select
                    className="select select-bordered select-sm"
                    value={dataRequestType}
                    onChange={(e) => { setDataRequestType(e.target.value as "access" | "deletion"); setCopiedField(null); }}
                  >
                    <option value="deletion">Запрос на удаление данных</option>
                    <option value="access">Запрос на доступ к данным</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-base-content/50 uppercase shrink-0 w-28">Email аккаунта</label>
                  <input
                    type="email"
                    className="input input-bordered input-sm"
                    placeholder="you@example.com"
                    value={requestEmail}
                    onChange={(e) => { setRequestEmail(e.target.value); setCopiedField(null); }}
                    onBlur={() => { void persistAccountEmail().catch(() => undefined); }}
                  />
                  <span
                    className="tooltip tooltip-top tooltip-left shrink-0 text-base-content/40"
                    data-tip="Адрес, под которым вас знает эта компания, например псевдоним скрытой почты. Отправка всё равно идёт с подключённого аккаунта."
                  >
                    <Info className="w-3.5 h-3.5" aria-label="Об email аккаунта" />
                  </span>
                </div>
                {detail.receivedAddresses.length > 0 && (
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-base-content/50 uppercase shrink-0 w-28 pt-1">
                      Получено на
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {detail.receivedAddresses.map((entry) => (
                        <button
                          key={entry.address}
                          type="button"
                          className={`btn btn-xs ${
                            entry.address === requestEmail.trim().toLowerCase()
                              ? "btn-primary"
                              : "btn-ghost border border-base-300"
                          }`}
                          title={`${entry.message_count} ${plural(entry.message_count, "письмо", "письма", "писем")}, последнее ${new Date(entry.last_seen).toLocaleDateString()}`}
                          onClick={() => {
                            setRequestEmail(entry.address);
                            setCopiedField(null);
                            void persistAccountEmail(entry.address).catch(
                              () => undefined,
                            );
                          }}
                        >
                          {entry.address}
                          <span className="opacity-50 ml-1">{entry.message_count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="text-xs text-base-content/50 uppercase shrink-0 w-28">Имя</label>
                  <input
                    type="text"
                    className="input input-bordered input-sm"
                    placeholder="Ваше полное имя"
                    value={userName}
                    onChange={(e) => { setUserName(e.target.value); setCopiedField(null); }}
                    onBlur={() => window.api.saveSettings({ userName })}
                  />
                  <span className="text-xs text-base-content/40 shrink-0">(необязательно)</span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-base-content/50 uppercase shrink-0 w-28">ID аккаунта</label>
                  <input
                    type="text"
                    className="input input-bordered input-sm"
                    placeholder="Логин, номер клиента/договора и т. п."
                    value={accountIdentifier}
                    onChange={(e) => { setAccountIdentifier(e.target.value); setCopiedField(null); }}
                  />
                  <span className="text-xs text-base-content/40 shrink-0">(необязательно)</span>
                </div>
              </div>
              {(() => {
                const email = dataRequestType === "access" ? accessEmail : deletionEmail;
                if (!email) return null;
                return (
                  <>
                    <div>
                      <p className="text-base-content/50 text-xs uppercase mb-1">Кому</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="email"
                          className="input input-bordered input-sm font-mono w-full max-w-md"
                          placeholder={
                            contactEmail && isNoReplyEmail(contactEmail)
                              ? `${contactEmail} — адрес без ответа (no-reply)`
                              : "recipient@example.com"
                          }
                          value={recipientEmail}
                          onChange={(e) => { setRecipientEmail(e.target.value); setCopiedField(null); }}
                        />
                        <button
                          className="btn btn-ghost btn-xs px-1"
                          onClick={() => handleCopyField(recipientEmail, "to")}
                          disabled={!recipientEmail}
                          title="Копировать"
                        >
                          {copiedField === "to" ? <span className="text-xs text-success">✓</span> : <Clipboard className="w-3.5 h-3.5 text-base-content/40" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-base-content/50 text-xs uppercase mb-1">Тема</p>
                      <div className="flex items-center gap-2">
                        <p>{email.subject}</p>
                        <button
                          className="btn btn-ghost btn-xs px-1"
                          onClick={() => handleCopyField(email.subject, "subject")}
                          title="Копировать"
                        >
                          {copiedField === "subject" ? <span className="text-xs text-success">✓</span> : <Clipboard className="w-3.5 h-3.5 text-base-content/40" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="text-base-content/50 text-xs uppercase mb-1">Письмо</p>
                      <pre className="whitespace-pre-wrap text-base-content/80 bg-base-100 rounded-lg p-3 mt-1">
                        {email.body}
                      </pre>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!recipientEmail || !canBuildRequest || actionLoading || !canSend}
                        onClick={() => {
                          if (!allowAction("execute")) return;
                          setGdprSendError(undefined);
                          setGdprSendOpen("send");
                        }}
                      >
                        Отправить запрос
                      </button>
                      <button
                        className="btn btn-neutral btn-sm gap-1"
                        onClick={() => handleCopyField(email.body, "body")}
                      >
                        {copiedField === "body" ? <span className="text-success">✓</span> : <Clipboard className="w-3.5 h-3.5" />}
                        {copiedField === "body" ? "Скопировано!" : "Копировать письмо"}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!recipientEmail || !canBuildRequest || actionLoading}
                        onClick={() => {
                          if (!allowAction("curate")) return;
                          setGdprSendError(undefined);
                          setGdprSendOpen("record");
                        }}
                      >
                        Я отправил(а) сегодня
                      </button>
                    </div>
                    {!canSend && (
                      <p className="text-xs text-base-content/50">
                        Этот аккаунт не может отправлять письма.{" "}
                        <button className="link" onClick={() => navigate("/settings")}>
                          Подключите аккаунт с SMTP
                        </button>{" "}
                        для отправки из Paperweight или скопируйте письмо и отправьте сами.
                      </p>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <p className="text-base-content/50">
              Нет контактов для запросов о данных.
            </p>
          )}
        </div>

        {/* Emails tab */}
        <div className={`tab-content mt-2 rounded-box bg-base-100/50 w-full py-2 ${activeTab === "emails" ? "!block" : ""}`}>
          {allMessages.length > 0 ? (
            <EmailsBySender
              messages={allMessages}
              senderCount={vendor.sender_count}
            />
          ) : (
            <p className="text-base-content/50 text-sm px-4 py-2">
              Письма не найдены.
            </p>
          )}
        </div>

        {/* Cases tab */}
        <div className={`tab-content mt-2 rounded-box bg-base-100/50 w-full px-4 py-3 ${activeTab === "cases" ? "!block" : ""}`}>
          {vendorCases.length === 0 ? (
            <p className="text-sm text-base-content/50">
              Обращений пока нет. Отправьте или запишите запрос на вкладке «Запросы о данных», чтобы начать отслеживание.
            </p>
          ) : (
            <div className="space-y-2">
              {vendorCases.map((c) => (
                <CaseListRow
                  key={c.id}
                  item={c}
                  primary={gdprRequestLabel(c.requestType)}
                  onOpen={() => navigate(`/cases/${c.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Activity tab */}
        <div className={`tab-content mt-2 rounded-box bg-base-100/50 w-full px-4 py-3 ${activeTab === "activity" ? "!block" : ""}`}>
          {!hasAnyActivity ? (
            <p className="text-sm text-base-content/50">
              Действий пока не было.
            </p>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-2">Журнал действий</h3>
                {sortedActivityLog.length === 0 ? (
                  <p className="text-sm text-base-content/50">Записей пока нет.</p>
                ) : (
                  <div className="font-mono text-sm divide-y divide-base-300">
                    {sortedActivityLog.map((entry) => (
                      <div
                        key={entry.id}
                        className="grid grid-cols-[1fr_auto] items-center gap-4 py-2"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-base-content/40 shrink-0 w-24">
                            {formatAbsoluteDate(entry.actionedAt)}
                          </span>
                          {entry.caseId ? (
                            <button
                              className={`shrink-0 hover:underline ${ACTION_COLORS[entry.actionType]}`}
                              onClick={() => navigate(`/cases/${entry.caseId}`)}
                            >
                              {activityEntryLabel(entry)}
                            </button>
                          ) : (
                            <span
                              className={`shrink-0 ${ACTION_COLORS[entry.actionType]}`}
                            >
                              {activityEntryLabel(entry)}
                            </span>
                          )}
                        </div>
                        <span className="text-base-content/40 text-right shrink-0">
                          {entry.messageCount > 0 && (
                            <>
                              {entry.messageCount.toLocaleString()} {plural(entry.messageCount, "письмо", "письма", "писем")}
                              {entry.sizeBytes > 0 &&
                                ` · ${formatBytes(entry.sizeBytes)}`}
                            </>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Белый список</h3>
                {sortedWhitelistEntries.length === 0 ? (
                  <p className="text-sm text-base-content/50">Для этого аккаунта в белом списке нет адресов или доменов.</p>
                ) : (
                  <div className="space-y-4">
                    <WhitelistSection
                      title="Домены"
                      entries={domainWhitelistEntries}
                      isLoading={whitelistLoading}
                      onRemove={handleWhitelistRemove}
                    />
                    <WhitelistSection
                      title="Адреса"
                      entries={emailWhitelistEntries}
                      isLoading={whitelistLoading}
                      onRemove={handleWhitelistRemove}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm modal */}
      {whitelistModalOpen && (
        <div className="modal modal-open">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">Добавить в белый список</h3>
            <div className="text-sm text-base-content/80 space-y-3">
              <p>Выберите адрес или домен для белого списка.</p>
              <div className="space-y-3">
                {addableDomainWhitelistOptions.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-2">Домены</h4>
                    <div className="space-y-2">
                      {addableDomainWhitelistOptions.map((option) => (
                        <label key={option} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selectedWhitelistValues.has(option)}
                            onChange={() => handleToggleWhitelistValue(option)}
                          />
                          <span className="font-mono text-sm break-all">{option}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {addableEmailWhitelistOptions.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-base-content/60 mb-2">Адреса</h4>
                    <div className="space-y-2">
                      {addableEmailWhitelistOptions.map((option) => (
                        <label key={option} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selectedWhitelistValues.has(option)}
                            onChange={() => handleToggleWhitelistValue(option)}
                          />
                          <span className="font-mono text-sm break-all">{option}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-action mt-6">
              <button
                className="btn btn-sm btn-neutral"
                onClick={() => {
                  if (!whitelistLoading) {
                    setWhitelistModalOpen(false);
                    setSelectedWhitelistValues(new Set());
                  }
                }}
                disabled={whitelistLoading}
              >
                Отмена
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleWhitelistConfirm}
                disabled={whitelistLoading || selectedWhitelistValues.size === 0}
              >
                {whitelistLoading ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Добавить"
                )}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button
              type="submit"
              onClick={() => {
                if (!whitelistLoading) {
                  setWhitelistModalOpen(false);
                  setSelectedWhitelistValues(new Set());
                }
              }}
              disabled={whitelistLoading}
            >
              закрыть
            </button>
          </form>
        </div>
      )}

      {pendingDelete && (
        <ActionModal
          isOpen
          title={pendingDelete === "all" ? "Удалить все письма" : "Удалить рекламные письма"}
          confirmLabel="В корзину"
          confirmVariant="primary"
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            if (!actionLoading) {
              setPendingDelete(null);
              setDeleteError(undefined);
              setActiveItemId(null);
            }
          }}
          loading={actionLoading}
          error={deleteError}
        >
          {pendingDelete === "all" ? (
            <>
              <p>Переместить все письма (<strong>{vendor.message_count}</strong>) от <strong>{displayName}</strong> в корзину? Это касается писем всех типов.</p>
              <p className="text-xs text-base-content/60">
                В корзину попадут все письма, а не только реклама, и отменить это отсюда нельзя. Если нужно удалить только часть (например, старые чеки) или нужен специальный инструмент очистки, см. наше{" "}
                <button
                  type="button"
                  className="link link-hover inline"
                  onClick={() => window.api.openExternal(CLEANUP_GUIDE_URL)}
                >
                  сравнение инструментов очистки почты (англ.)
                </button>
                {" "}или воспользуйтесь средствами вашего почтового сервиса.
              </p>
            </>
          ) : (
            <p>Переместить рекламные письма от <strong>{displayName}</strong> в корзину?</p>
          )}
        </ActionModal>
      )}

      {/* GDPR send confirm modal */}
      {gdprSendOpen && (
        <ActionModal
          isOpen
          title={gdprSendOpen === "record" ? "Записать отправленный запрос" : dataRequestType === "access" ? "Отправить запрос на доступ" : "Отправить запрос на удаление"}
          confirmLabel={
            isGdprSendRecovery(pendingGdprRecord, groupKey, dataRequestType) || gdprSendOpen === "record"
              ? "Записать запрос"
              : "Отправить"
          }
          confirmVariant="primary"
          onConfirm={gdprSendOpen === "record" ? handleRecordRequest : handleGdprSend}
          onCancel={() => { if (!actionLoading) { setGdprSendOpen(undefined); } }}
          loading={actionLoading}
          error={gdprSendError}
        >
          {gdprSendOpen === "record" ? (
            <p>
              Подтвердите, что сегодня отправили показанный запрос на <strong>{recipientEmail}</strong>.
              Paperweight сохранит локальное обращение с сегодняшней датой запроса.
            </p>
          ) : (
            <p>
              {isGdprSendRecovery(pendingGdprRecord, groupKey, dataRequestType)
                ? <>Запрос отправлен на <strong>{recipientEmail}</strong>, но сохранить его локально не удалось — повторите только запись, не отправляйте снова.</>
                : <>
              Paperweight отправит этот запрос с вашего аккаунта на{" "}
              <strong>{recipientEmail}</strong> и откроет обращение для контроля
              сроков ответа.
                </>}
            </p>
          )}
        </ActionModal>
      )}

      {/* Unsubscribe confirm modal */}
      {pendingUnsub && (
        <ActionModal
          isOpen
          title="Отписка"
          confirmLabel="Отписаться"
          confirmVariant="primary"
          onConfirm={handleUnsubscribeConfirm}
          onCancel={() => {
            if (!actionLoading) { setPendingUnsub(null); setActiveItemId(null); }
          }}
          loading={actionLoading}
        >
          <p>{unsubDescription(pendingUnsub, displayName)}</p>
        </ActionModal>
      )}

      {/* rfc8058 result — success */}
      {unsubResult?.kind === "success" && (
        <ActionModal
          isOpen
          title="Отписка"
          confirmLabel="Готово"
          confirmVariant="primary"
          onConfirm={handleUnsubResultDone}
          onCancel={() => {
            if (!actionLoading) {
              if (!unsubResult.errorMessage) {
                setDoneIds((prev) => new Set(prev).add(`unsub-${unsubResult.entry.url}`));
              }
              setUnsubResult(null);
              setActiveItemId(null);
            }
          }}
          loading={actionLoading}
        >
          <p>
            Вы отписались от <strong>{displayName}</strong>.
          </p>
          {unsubResult.errorMessage && (
            <p className="text-error text-sm">{unsubResult.errorMessage}</p>
          )}
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={unsubResult.trashAlso}
              onChange={(e) =>
                setUnsubResult((prev) =>
                  prev ? { ...prev, trashAlso: e.target.checked } : prev,
                )
              }
            />
            <span>Также переместить все письма в корзину</span>
          </label>
        </ActionModal>
      )}

      {/* rfc8058 result — failure */}
      {unsubResult?.kind === "failure" && (
        <ActionModal
          isOpen
          title="Отписка"
          secondaryLabel="Пометить как спам"
          secondaryVariant="neutral"
          onSecondary={handleUnsubResultSpam}
          onCancel={() => {
            if (!actionLoading) { setUnsubResult(null); setActiveItemId(null); }
          }}
          loading={actionLoading}
        >
          <p>
            Не удалось автоматически отписаться от{" "}
            <strong>{displayName}</strong>.
          </p>
          {unsubResult.errorMessage && (
            <p className="text-xs text-base-content/50 break-all">{unsubResult.errorMessage}</p>
          )}
          {unsubResult.fallbackMethods.length > 0 && (
            <div className="space-y-2 mt-1">
              <p className="text-base-content/60">Попробуйте другой способ:</p>
              {unsubResult.fallbackMethods.map((entry) => (
                <div
                  key={entry.method}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-base-content/80">
                    {unsubDescription(entry, displayName)}
                  </span>
                  <button
                    className="btn btn-primary btn-sm shrink-0"
                    disabled={actionLoading}
                    onClick={() => handleUnsubResultFallback(entry)}
                  >
                    Попробовать
                  </button>
                </div>
              ))}
            </div>
          )}
        </ActionModal>
      )}

      {/* External link confirmation */}
      {unsubCheck && (
        <ActionModal
          isOpen
          title="Отписка"
          secondaryLabel="Нет, пометить как спам"
          secondaryVariant="neutral"
          confirmLabel="Да, готово"
          confirmVariant="primary"
          onSecondary={handleUnsubCheckSpam}
          onConfirm={handleUnsubCheckDone}
          onCancel={() => {
            if (!actionLoading) { setUnsubCheck(null); setActiveItemId(null); }
          }}
          loading={actionLoading}
        >
          <p>
            Удалось отписаться от <strong>{displayName}</strong>
            ?
          </p>
          {unsubCheck.errorMessage && (
            <p className="text-error text-sm">{unsubCheck.errorMessage}</p>
          )}
          <label className="flex items-center gap-2 cursor-pointer mt-1">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={unsubCheck.trashAlso}
              onChange={(e) =>
                setUnsubCheck((prev) =>
                  prev ? { ...prev, trashAlso: e.target.checked } : prev,
                )
              }
            />
            <span>При подтверждении отписки также переместить все письма в корзину</span>
          </label>
        </ActionModal>
      )}
    </div>
  );
}
