import { useActionAccess } from "../context/LicenseContext";
import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { Vendor, VendorQuery, UnsubscribeEntry } from "@shared/types";
import { MARKETING_ACTION_TYPES } from "@shared/types";
import { formatRelativeDate, plural } from "@shared/formatting";
import { parseMailto, PAPERWEIGHT_UNSUB_BODY } from "@shared/utils";
import { ArrowUpDown, BadgeCheck, BellOff, ChevronLeft, ChevronRight, Flag, SlidersHorizontal, Trash2 } from "lucide-react";
import ActionModal from "../components/ActionModal";
import { MAILBOX_CHANGED, requireSameMailbox, viewedMailboxEmail } from "../hooks/useAccounts";

// ---------- types ----------

type ModalKind = "whitelist" | "unsubscribe" | "spam" | "trash";

interface ModalState {
  kind: ModalKind;
  vendor: Vendor;
  // whitelist
  senderEmail?: string;
  whitelistTarget: "domain" | "email";
  // unsubscribe
  methods?: UnsubscribeEntry[];
}

/** After opening an external unsubscribe link, ask the user to confirm. */
interface UnsubCheckState {
  vendor: Vendor;
  url: string;
  trashAlso: boolean;
  errorMessage?: string;
}

/** Result of an automated unsubscribe attempt (rfc8058 POST or mailto SMTP send). */
interface UnsubResultState {
  vendor: Vendor;
  kind: "success" | "failure";
  /** Other methods to offer as fallback when kind = 'failure' */
  fallbackMethods: UnsubscribeEntry[];
  trashAlso: boolean;
  errorMessage?: string;
}

type BatchPhase = "confirm" | "progress" | "results";
type BatchKind = "unsubscribe" | "spam" | "trash";

interface BatchState {
  phase: BatchPhase;
  kind: BatchKind;
  trashAlso: boolean;
  current: number;
  total: number;
  succeeded: number[];
  failed: string[];
}

// ---------- filter group ----------

interface FilterGroupProps {
  label: string;
  options: string[];
  labels: string[];
  value: string;
  onChange: (val: string) => void;
  colors?: string[];
}

function FilterGroup({ label, options, labels, value, onChange, colors }: FilterGroupProps) {
  return (
    <div>
      <div className="text-sm text-base-content/40 mb-1.5">{label}</div>
      <div className="flex gap-1 flex-wrap">
        {options.map((opt, i) => {
          const color = colors?.[i];
          const cls = color
            ? value === opt
              ? `badge-${color}`
              : `badge-soft badge-${color}`
            : value === opt
            ? "badge-neutral"
            : "badge-soft";
          return (
            <button
              key={opt}
              className={`badge badge-sm cursor-pointer ${cls}`}
              onClick={() => onChange(value === opt ? "" : opt)}
            >
              {labels[i]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- presets ----------

const MAIL_PRESETS = [
  { id: "whitelisted", label: "Белый список" },
  { id: "priorities",  label: "Приоритетные" },
  { id: "breached",    label: "Утечки" },
] as const;

type MailPresetId = typeof MAIL_PRESETS[number]["id"];

// ---------- helpers ----------

const SORT_OPTIONS = [
  { value: "message_count", label: "Больше писем" },
  { value: "last_seen", label: "Сначала новые" },
  { value: "last_seen_asc", label: "Сначала старые" },
  { value: "name", label: "По названию" },
  { value: "root_domain", label: "По домену" },
];

const ROW_GRID =
  "grid grid-cols-[24px_20px_minmax(0,1fr)_auto_100px] items-center gap-4";

/** Priority order matching architecture.md */
const METHOD_PRIORITY = ["rfc8058", "list-unsubscribe", "footer"] as const;

function pickBestMethod(
  methods: UnsubscribeEntry[],
): UnsubscribeEntry | undefined {
  for (const p of METHOD_PRIORITY) {
    const found = methods.find((m) => m.method === p);
    if (found) return found;
  }
  return undefined;
}

/** Best mailto fallback for batch when rfc8058 isn't available. */
function pickBestMailto(
  methods: UnsubscribeEntry[],
): UnsubscribeEntry | undefined {
  for (const p of ["list-unsubscribe", "footer"] as const) {
    const found = methods.find(
      (m) => m.method === p && m.url.startsWith("mailto:"),
    );
    if (found) return found;
  }
  return undefined;
}

function unsubDescription(entry: UnsubscribeEntry, vendorName: string) {
  if (entry.method === "rfc8058") {
    return <>Paperweight автоматически отправит запрос на отписку <strong>{vendorName}</strong>.</>;
  }
  if (entry.url.startsWith("mailto:")) {
    return <>Paperweight отправит письмо об отписке с вашего аккаунта <strong>{vendorName}</strong>.</>;
  }
  return <>Страница отписки <strong>{vendorName}</strong> откроется в браузере. Завершите отписку там.</>;
}

const BATCH_LABELS: Record<
  BatchKind,
  { title: string; progressVerb: string; successVerb: string }
> = {
  unsubscribe: {
    title: "Массовая отписка",
    progressVerb: "Отписка",
    successVerb: "отписано",
  },
  spam: {
    title: "Пометить как спам",
    progressVerb: "Отметка спама",
    successVerb: "отмечено",
  },
  trash: {
    title: "Переместить в корзину",
    progressVerb: "Удаление",
    successVerb: "перемещено в корзину",
  },
};

// ---------- component ----------

interface MailState {
  page: number;
  sortBy: string;
  search: string;
  volumeFilter: string;
  activityFilter: string;
  whitelistedFilter: boolean;
  priorityFilter: boolean;
  breachedFilter: boolean;
}

export default function Mail(): JSX.Element {
  const allowAction = useActionAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { preset?: MailPresetId; restore?: MailState } | null;
  const restore = locState?.restore;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(restore?.page ?? 1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(restore?.search ?? "");
  const [sortBy, setSortBy] = useState(restore?.sortBy ?? "message_count");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [messagesCache, setMessagesCache] = useState<
    Map<number, Array<{ id: string; subject?: string; date: number }>>
  >(new Map());
  const [methodsCache, setMethodsCache] = useState<
    Map<number, UnsubscribeEntry[]>
  >(new Map());

  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [unsubCheck, setUnsubCheck] = useState<UnsubCheckState | null>(null);
  const [unsubResult, setUnsubResult] = useState<UnsubResultState | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showSort, setShowSort] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [volumeFilter, setVolumeFilter] = useState(restore?.volumeFilter ?? "");
  const [activityFilter, setActivityFilter] = useState(restore?.activityFilter ?? "");
  const [whitelistedFilter, setWhitelistedFilter] = useState(restore?.whitelistedFilter ?? locState?.preset === "whitelisted");
  const [priorityFilter, setPriorityFilter] = useState(restore?.priorityFilter ?? locState?.preset === "priorities");
  const [breachedFilter, setBreachedFilter] = useState(restore?.breachedFilter ?? locState?.preset === "breached");

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batch, setBatch] = useState<BatchState | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const removedIdsRef = useRef<Set<number>>(new Set());

  const limit = 25;

  // ---------- data fetching ----------

  const fetchVendors = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      const query: VendorQuery = {
        page,
        limit,
        sortBy: sortBy === "last_seen_asc" ? "last_seen" : sortBy,
        sortDir:
          sortBy === "name" ||
          sortBy === "root_domain" ||
          sortBy === "last_seen_asc"
            ? "ASC"
            : "DESC",
        search: search || undefined,
        filter: "lists",
        activity: activityFilter || undefined,
        volume: volumeFilter || undefined,
        activeSubscriptions: priorityFilter || undefined,
        onBreachList: breachedFilter || undefined,
        showWhitelisted: whitelistedFilter || undefined,
      };
      const data = await window.api.queryVendors(query);
      setVendors(data.vendors.filter((v) => !removedIdsRef.current.has(v.id)));
      setTotal(data.total);
      setLoading(false);
    },
    [page, sortBy, search, activityFilter, volumeFilter, priorityFilter, breachedFilter, whitelistedFilter],
  );

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);


  // Sync indeterminate state on select-all checkbox
  const eligibleVendors = vendors.filter((v) => v.has_rfc8058 || v.has_mailto_unsub);
  const allEligibleSelected =
    eligibleVendors.length > 0 &&
    eligibleVendors.every((v) => selectedIds.has(v.id));
  const someEligibleSelected = eligibleVendors.some((v) =>
    selectedIds.has(v.id),
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someEligibleSelected && !allEligibleSelected;
    }
  }, [someEligibleSelected, allEligibleSelected]);

  // ---------- toolbar ----------

  const handleSearchChange = (value: string) => {
    removedIdsRef.current = new Set();
    setSearch(value);
    setPage(1);
    setSelectedIds(new Set());
  };

  const handleClearAll = () => {
    removedIdsRef.current = new Set();
    setSearch("");
    setSortBy("message_count");
    setVolumeFilter("");
    setActivityFilter("");
    setWhitelistedFilter(false);
    setPriorityFilter(false);
    setBreachedFilter(false);
    setPage(1);
    setSelectedIds(new Set());
  };

  const hasAnyFilter = !!(search || sortBy !== "message_count" || volumeFilter || activityFilter || whitelistedFilter || priorityFilter || breachedFilter || page > 1);

  const handleSortChange = (value: string) => {
    removedIdsRef.current = new Set();
    setSortBy(value);
    setPage(1);
    setSelectedIds(new Set());
  };

  const handlePageChange = (p: number) => {
    removedIdsRef.current = new Set();
    setPage(p);
    setSelectedIds(new Set());
  };

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (showSort && sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSort(false);
      }
      if (showFilters && filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSort, showFilters]);

  // Keep history entry in sync so navigate(-1) restores filter state
  const pathname = location.pathname;
  useEffect(() => {
    navigate(pathname, {
      replace: true,
      state: { restore: { page, sortBy, search, volumeFilter, activityFilter, whitelistedFilter, priorityFilter, breachedFilter } satisfies MailState },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortBy, search, volumeFilter, activityFilter, whitelistedFilter, priorityFilter, breachedFilter]);

  // ---------- select-all ----------

  const handleSelectAll = () => {
    if (allEligibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleVendors.map((v) => v.id)));
    }
  };

  // ---------- row expand ----------

  const handleToggleExpand = async (vendor: Vendor): Promise<void> => {
    const id = vendor.id;
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
      if (!messagesCache.has(id)) {
        const messages = await window.api.getVendorMessages(id, 5);
        setMessagesCache((prev) => new Map(prev).set(id, messages));
      }
    }
    setExpandedRows(newExpanded);
  };

  // ---------- shared helpers ----------

  const removeVendor = (vendorId: number) => {
    removedIdsRef.current.add(vendorId);
    setVendors((prev) => prev.filter((v) => v.id !== vendorId));
    setTotal((t) => t - 1);
  };

  const closeModal = () => {
    if (!actionLoading) {
      setModal(null);
      setModalError(null);
    }
  };

  /** Fetch methods for vendor, using cache if available */
  const getOrFetchMethods = async (
    vendorId: number,
  ): Promise<UnsubscribeEntry[]> => {
    const cached = methodsCache.get(vendorId);
    if (cached) return cached;
    const methods = await window.api.getAllUnsubscribeMethods(vendorId);
    setMethodsCache((prev) => new Map(prev).set(vendorId, methods));
    return methods;
  };

  // ---------- action button handlers (open modals) ----------

  const handleWhitelistClick = async (
    e: React.MouseEvent,
    vendor: Vendor,
  ): Promise<void> => {
    e.stopPropagation();
    if (!allowAction("curate")) return;
    // Try to get a representative sender email from cached methods
    const methods = await getOrFetchMethods(vendor.id);
    const senderEmail = methods[0]?.senderEmail;
    setModal({
      kind: "whitelist",
      vendor,
      senderEmail,
      whitelistTarget: "domain",
    });
  };

  const handleUnsubscribeClick = async (
    e: React.MouseEvent,
    vendor: Vendor,
  ): Promise<void> => {
    e.stopPropagation();
    if (!allowAction("execute")) return;
    const methods = await getOrFetchMethods(vendor.id);
    setModal({
      kind: "unsubscribe",
      vendor,
      methods,
      whitelistTarget: "domain",
    });
  };

  const handleSpamClick = (e: React.MouseEvent, vendor: Vendor): void => {
    e.stopPropagation();
    if (!allowAction("execute")) return;
    setModal({ kind: "spam", vendor, whitelistTarget: "domain" });
  };

  const handleTrashClick = (e: React.MouseEvent, vendor: Vendor): void => {
    e.stopPropagation();
    if (!allowAction("execute")) return;
    setModal({ kind: "trash", vendor, whitelistTarget: "domain" });
  };

  // ---------- batch actions ----------

  const openBatch = (kind: BatchKind) => {
    if (!allowAction("execute")) return;
    setBatch({
      phase: "confirm",
      kind,
      trashAlso: false,
      current: 0,
      total: 0,
      succeeded: [],
      failed: [],
    });
  };

  const runBatch = async () => {
    if (!allowAction("execute")) return;
    if (!batch || batch.phase !== "confirm") return;
    const kind = batch.kind;
    const trashAlso = batch.trashAlso;
    const batchVendors = vendors.filter((v) => selectedIds.has(v.id));

    setBatch((prev) =>
      prev
        ? { ...prev, phase: "progress", current: 0, total: batchVendors.length }
        : prev,
    );

    const succeeded: number[] = [];
    const failed: string[] = [];
    const origin = viewedMailboxEmail();

    for (let i = 0; i < batchVendors.length; i++) {
      setBatch((prev) => (prev ? { ...prev, current: i + 1 } : prev));
      const vendor = batchVendors[i];
      const name = vendor.name || vendor.root_domain || "Неизвестно";
      try {
        requireSameMailbox(origin);
        if (kind === "unsubscribe") {
          const methods = await getOrFetchMethods(vendor.id);
          const rfc = methods.find((m) => m.method === "rfc8058");
          let success = false;
          let sentEmail = false;
          let usedUrl: string | undefined;
          if (rfc) {
            const result = await window.api.executeRfc8058(rfc.url);
            success = result.success;
            usedUrl = rfc.url;
          } else {
            const mailtoEntry = pickBestMailto(methods);
            if (mailtoEntry) {
              const { to, subject, body } = parseMailto(mailtoEntry.url);
              const result = await window.api.sendEmail(
                to,
                subject,
                body || PAPERWEIGHT_UNSUB_BODY,
              );
              success = result.success;
              sentEmail = true;
              usedUrl = mailtoEntry.url;
            }
          }
          if (success && usedUrl) {
            requireSameMailbox(origin);
            await window.api.markListUnsubscribed(vendor.id, usedUrl);
            if (trashAlso) {
              requireSameMailbox(origin);
              const result = await window.api.trashVendorMessages(vendor.id, [...MARKETING_ACTION_TYPES]);
              if (!result.success) {
                failed.push(name);
              } else {
                succeeded.push(vendor.id);
              }
            } else {
              succeeded.push(vendor.id);
            }
          } else {
            failed.push(name);
          }
          // Throttle between SMTP sends regardless of success — repeated auth
          // failures shouldn't hammer the provider. Quotas: Gmail submission
          // ~100/24h free, ~2000 Workspace; Microsoft 10k/day.
          // No throttle for rfc8058 POSTs — those are fine back-to-back.
          if (sentEmail && i < batchVendors.length - 1) {
            await new Promise((r) => setTimeout(r, 300));
            requireSameMailbox(origin);
          }
        } else if (kind === "spam") {
          const result = await window.api.reportSpamVendor(vendor.id);
          if (!result.success) {
            failed.push(name);
            continue;
          }
          succeeded.push(vendor.id);
        } else if (kind === "trash") {
          const result = await window.api.trashVendorMessages(vendor.id, [...MARKETING_ACTION_TYPES]);
          if (!result.success) {
            failed.push(name);
            continue;
          }
          succeeded.push(vendor.id);
        }
      } catch (err) {
        failed.push(name);
        if (err instanceof Error && err.message === MAILBOX_CHANGED) {
          for (let j = i + 1; j < batchVendors.length; j++) {
            failed.push(batchVendors[j].name || batchVendors[j].root_domain || "Неизвестно");
          }
          break;
        }
      }
    }

    setBatch((prev) =>
      prev ? { ...prev, phase: "results", succeeded, failed } : prev,
    );
  };

  const closeBatch = () => {
    if (!batch || batch.phase !== "results") return;
    const { succeeded } = batch;
    succeeded.forEach((id) => removedIdsRef.current.add(id));
    setVendors((prev) => prev.filter((v) => !succeeded.includes(v.id)));
    setTotal((t) => t - succeeded.length);
    setSelectedIds(new Set());
    setBatch(null);
  };

  // ---------- modal confirmations ----------

  const handleWhitelistConfirm = async (): Promise<void> => {
    if (!allowAction("curate")) return;
    if (!modal || modal.kind !== "whitelist") return;
    const { vendor, whitelistTarget, senderEmail } = modal;
    const target =
      whitelistTarget === "email" && senderEmail
        ? senderEmail
        : vendor.root_domain;
    if (!target) return;
    setActionLoading(true);
    try {
      await window.api.addWhitelistEntry(target);
      setModal(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubscribeConfirm = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!modal || modal.kind !== "unsubscribe") return;
    const { vendor, methods } = modal;
    const best = methods ? pickBestMethod(methods) : undefined;
    if (!best) return;

    const origin = viewedMailboxEmail();
    setActionLoading(true);
    try {
      if (best.method === "rfc8058") {
        const fallbackMethods = (methods ?? []).filter((m) => m.method !== "rfc8058");
        const result = await window.api.executeRfc8058(best.url);
        if (result.success) {
          requireSameMailbox(origin);
          await window.api.markListUnsubscribed(vendor.id, best.url);
          setModal(null);
          setUnsubResult({ vendor, kind: "success", fallbackMethods: [], trashAlso: true });
        } else {
          setModal(null);
          setUnsubResult({ vendor, kind: "failure", fallbackMethods, trashAlso: true, errorMessage: result.error });
        }
      } else if (best.url.startsWith("mailto:")) {
        const { to, subject, body } = parseMailto(best.url);
        const fallbackMethods = (methods ?? []).filter((m) => m.url !== best.url);
        const result = await window.api.sendEmail(to, subject, body || PAPERWEIGHT_UNSUB_BODY);
        if (result.success) {
          requireSameMailbox(origin);
          await window.api.markListUnsubscribed(vendor.id, best.url);
          setModal(null);
          setUnsubResult({ vendor, kind: "success", fallbackMethods: [], trashAlso: true });
        } else {
          setModal(null);
          setUnsubResult({ vendor, kind: "failure", fallbackMethods, trashAlso: true, errorMessage: result.error });
        }
      } else {
        await window.api.openUnsubscribeUrl(best.url);
        setModal(null);
        setUnsubCheck({ vendor, url: best.url, trashAlso: true });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubResultDone = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubResult) return;
    const { vendor, trashAlso } = unsubResult;
    setActionLoading(true);
    try {
      if (trashAlso) {
        const result = await window.api.trashVendorMessages(vendor.id, [...MARKETING_ACTION_TYPES]);
        if (!result.success) {
          setUnsubResult({
            ...unsubResult,
            errorMessage: result.error ?? "Отписка выполнена, но переместить письма в корзину не удалось.",
          });
          return;
        }
      }
      setUnsubResult(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubResultSpam = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubResult) return;
    const { vendor } = unsubResult;
    setActionLoading(true);
    try {
      const result = await window.api.reportSpamVendor(vendor.id);
      if (!result.success) {
        setUnsubResult({
          ...unsubResult,
          errorMessage: result.error ?? "Не удалось пометить как спам.",
        });
        return;
      }
      setUnsubResult(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubResultFallback = async (entry: UnsubscribeEntry): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubResult) return;
    const { vendor } = unsubResult;
    const origin = viewedMailboxEmail();
    setActionLoading(true);
    try {
      if (entry.url.startsWith("mailto:")) {
        const { to, subject, body } = parseMailto(entry.url);
        const result = await window.api.sendEmail(to, subject, body || PAPERWEIGHT_UNSUB_BODY);
        if (result.success) {
          requireSameMailbox(origin);
          await window.api.markListUnsubscribed(vendor.id, entry.url);
          setUnsubResult({ vendor, kind: "success", fallbackMethods: [], trashAlso: unsubResult.trashAlso });
        } else {
          setToast(result.error ?? "Не удалось отправить письмо об отписке.");
        }
      } else {
        await window.api.openUnsubscribeUrl(entry.url);
        setUnsubResult(null);
        setUnsubCheck({ vendor, url: entry.url, trashAlso: true });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubCheckDone = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubCheck) return;
    const { vendor, trashAlso } = unsubCheck;
    const origin = viewedMailboxEmail();
    setActionLoading(true);
    try {
      requireSameMailbox(origin);
      await window.api.markListUnsubscribed(vendor.id, unsubCheck.url);
      if (trashAlso) {
        requireSameMailbox(origin);
        const result = await window.api.trashVendorMessages(vendor.id, [...MARKETING_ACTION_TYPES]);
        if (!result.success) {
          setUnsubCheck(null);
          setUnsubResult({
            vendor,
            kind: "success",
            fallbackMethods: [],
            trashAlso,
            errorMessage: result.error ?? "Отписка выполнена, но переместить письма в корзину не удалось.",
          });
          return;
        }
      }
      setUnsubCheck(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnsubCheckSpam = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!unsubCheck) return;
    const { vendor } = unsubCheck;
    setActionLoading(true);
    try {
      const result = await window.api.reportSpamVendor(vendor.id);
      if (!result.success) {
        setUnsubCheck({
          ...unsubCheck,
          errorMessage: result.error ?? "Не удалось пометить как спам.",
        });
        return;
      }
      setUnsubCheck(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSpamConfirm = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    // Called from spam modal AND from unsubscribe "no methods" modal
    if (!modal || (modal.kind !== "spam" && modal.kind !== "unsubscribe"))
      return;
    const { vendor } = modal;
    setActionLoading(true);
    setModalError(null);
    try {
      const spamResult = await window.api.reportSpamVendor(vendor.id);
      if (!spamResult.success) {
        setModalError(spamResult.error ?? "Не удалось пометить как спам.");
        return;
      }
      setModal(null);
      setModalError(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTrashConfirm = async (): Promise<void> => {
    if (!allowAction("execute")) return;
    if (!modal || modal.kind !== "trash") return;
    const { vendor } = modal;
    setActionLoading(true);
    setModalError(null);
    try {
      const result = await window.api.trashVendorMessages(vendor.id, [...MARKETING_ACTION_TYPES]);
      if (!result.success) {
        setModalError(result.error ?? "Не удалось переместить письма в корзину.");
        return;
      }
      setModal(null);
      setModalError(null);
      removeVendor(vendor.id);
    } finally {
      setActionLoading(false);
    }
  };

  // ---------- modal rendering ----------

  const renderModal = () => {
    // Batch modal (takes priority over per-row modals)
    if (batch) {
      const labels = BATCH_LABELS[batch.kind];

      if (batch.phase === "confirm") {
        return (
          <ActionModal
            isOpen
            title={labels.title}
            confirmLabel={
              batch.kind === "unsubscribe"
                ? `Отписаться: ${selectedIds.size} ${plural(selectedIds.size, "компания", "компании", "компаний")}`
                : batch.kind === "spam"
                  ? "Пометить как спам"
                  : "В корзину"
            }
            confirmVariant="primary"
            onConfirm={runBatch}
            onCancel={() => setBatch(null)}
          >
            {batch.kind === "unsubscribe" && (
              <>
                <p>
                  Paperweight автоматически отправит запросы на отписку{" "}
                  <strong>{selectedIds.size}</strong>{" "}
                  {plural(selectedIds.size, "компании", "компаниям", "компаниям")}.
                </p>
                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={batch.trashAlso}
                    onChange={(e) =>
                      setBatch((prev) =>
                        prev ? { ...prev, trashAlso: e.target.checked } : prev,
                      )
                    }
                  />
                  <span>После отписки также переместить все письма в корзину</span>
                </label>
              </>
            )}
            {batch.kind === "spam" && (
              <p>
                Отметка «спам» подходит для писем, на которые вы не подписывались. Для рассылок,
                на которые вы подписались сами, отписка эффективнее и корректнее.
              </p>
            )}
            {batch.kind === "trash" && (
              <p>
                Эти отправители продолжат вам писать. Чтобы перестать получать
                новые письма, сначала отпишитесь.
              </p>
            )}
          </ActionModal>
        );
      }

      if (batch.phase === "progress") {
        return (
          <ActionModal
            isOpen
            title={labels.title}
            loading={true}
            onCancel={() => {}}
          >
            <p>
              {labels.progressVerb} {batch.current} / {batch.total}…
            </p>
          </ActionModal>
        );
      }

      // results
      return (
        <ActionModal
          isOpen
          title={labels.title}
          confirmLabel="Готово"
          confirmVariant="primary"
          onConfirm={closeBatch}
          onCancel={closeBatch}
        >
          <p>
            Готово — {labels.successVerb}: {batch.succeeded.length}
            {batch.failed.length > 0 ? `, ошибок: ${batch.failed.length}.` : "."}
          </p>
          {batch.failed.length > 0 && (
            <p className="text-base-content/60">
              Не удалось: {batch.failed.join(", ")}
            </p>
          )}
        </ActionModal>
      );
    }

    // rfc8058 result — success or failure
    if (unsubResult) {
      const name =
        unsubResult.vendor.name || unsubResult.vendor.root_domain || "этот отправитель";

      if (unsubResult.kind === "success") {
        return (
          <ActionModal
            isOpen
            title="Отписка"
            confirmLabel="Готово"
            confirmVariant="primary"
            onConfirm={handleUnsubResultDone}
            onCancel={() => {
              if (!actionLoading) {
                setUnsubResult(null);
                if (!unsubResult.errorMessage) removeVendor(unsubResult.vendor.id);
              }
            }}
            loading={actionLoading}
          >
            <p>
              Вы отписались от <strong>{name}</strong>.
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
        );
      }

      // failure
      const { fallbackMethods } = unsubResult;
      return (
        <ActionModal
          isOpen
          title="Отписка"
          secondaryLabel="Пометить как спам"
          secondaryVariant="neutral"
          onSecondary={handleUnsubResultSpam}
          onCancel={() => !actionLoading && setUnsubResult(null)}
          loading={actionLoading}
        >
          <p>
            Не удалось автоматически отписаться от <strong>{name}</strong>.
          </p>
          {unsubResult.errorMessage && (
            <p className="text-xs text-base-content/50 break-all">{unsubResult.errorMessage}</p>
          )}
          {fallbackMethods.length > 0 && (
            <div className="space-y-2 mt-1">
              <p className="text-base-content/60">Попробуйте другой способ:</p>
              {fallbackMethods.map((entry) => (
                <div
                  key={entry.method}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="text-base-content/80">
                    {unsubDescription(entry, name)}
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
      );
    }

    // Unsubscribe confirmation check (shown after opening external link)
    if (unsubCheck) {
      const name =
        unsubCheck.vendor.name ||
        unsubCheck.vendor.root_domain ||
        "этот отправитель";
      return (
        <ActionModal
          isOpen
          title="Отписка"
          secondaryLabel="Нет, пометить как спам"
          secondaryVariant="neutral"
          confirmLabel="Да, готово"
          confirmVariant="primary"
          onSecondary={handleUnsubCheckSpam}
          onConfirm={handleUnsubCheckDone}
          onCancel={() => !actionLoading && setUnsubCheck(null)}
          loading={actionLoading}
        >
          <p>
            Удалось отписаться от <strong>{name}</strong>?
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
      );
    }

    if (!modal) return null;

    const { kind, vendor } = modal;
    const name = vendor.name || vendor.root_domain || "Неизвестно";

    // ---- Whitelist ----
    if (kind === "whitelist") {
      const { senderEmail, whitelistTarget } = modal;
      return (
        <ActionModal
          isOpen
          title="Белый список"
          confirmLabel="Добавить"
          confirmVariant="primary"
          onConfirm={handleWhitelistConfirm}
          onCancel={closeModal}
          loading={actionLoading}
        >
          <p>
            Отправители из белого списка не показываются здесь. Выберите, что
            добавить в белый список для <strong>{name}</strong>:
          </p>
          <div className="space-y-2 mt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="whitelist_target"
                className="radio radio-sm"
                checked={whitelistTarget === "domain"}
                onChange={() =>
                  setModal((prev) =>
                    prev ? { ...prev, whitelistTarget: "domain" } : prev,
                  )
                }
              />
              <span>
                Весь домен{" "}
                <span className="font-mono text-xs bg-base-300 px-1 rounded">
                  {vendor.root_domain}
                </span>
              </span>
            </label>
            {senderEmail && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="whitelist_target"
                  className="radio radio-sm"
                  checked={whitelistTarget === "email"}
                  onChange={() =>
                    setModal((prev) =>
                      prev ? { ...prev, whitelistTarget: "email" } : prev,
                    )
                  }
                />
                <span>
                  Конкретный отправитель{" "}
                  <span className="font-mono text-xs bg-base-300 px-1 rounded">
                    {senderEmail}
                  </span>
                </span>
              </label>
            )}
          </div>
        </ActionModal>
      );
    }

    // ---- Unsubscribe ----
    if (kind === "unsubscribe") {
      const { methods } = modal;
      const best = methods ? pickBestMethod(methods) : undefined;

      if (!best) {
        return (
          <ActionModal
            isOpen
            title="Отписка"
            confirmLabel="Пометить как спам"
            confirmVariant="primary"
            onConfirm={handleSpamConfirm}
            onCancel={closeModal}
            loading={actionLoading}
          >
            <p>
              Ссылка для отписки от <strong>{name}</strong> не найдена. Вместо этого
              можно пометить отправителя как спам.
            </p>
            {modalError && <p className="text-error text-sm mt-2">{modalError}</p>}
          </ActionModal>
        );
      }

      return (
        <ActionModal
          isOpen
          title="Отписка"
          confirmLabel="Отписаться"
          confirmVariant="primary"
          onConfirm={handleUnsubscribeConfirm}
          onCancel={closeModal}
          loading={actionLoading}
        >
          <p>{unsubDescription(best, name)}</p>
        </ActionModal>
      );
    }

    // ---- Report Spam ----
    if (kind === "spam") {
      return (
        <ActionModal
          isOpen
          title="Пометить как спам"
          confirmLabel="Пометить как спам"
          confirmVariant="primary"
          onConfirm={handleSpamConfirm}
          onCancel={closeModal}
          loading={actionLoading}
        >
          <p>
            Пометить <strong>{name}</strong> как спам?
          </p>
          {modalError && <p className="text-error text-sm mt-2">{modalError}</p>}
        </ActionModal>
      );
    }

    // ---- Move to Trash ----
    if (kind === "trash") {
      return (
        <ActionModal
          isOpen
          title="Переместить в корзину"
          confirmLabel="В корзину"
          confirmVariant="primary"
          onConfirm={handleTrashConfirm}
          onCancel={closeModal}
          loading={actionLoading}
        >
          <p>
            Переместить все письма ({vendor.message_count}) от{" "}
            <strong>{name}</strong> в корзину?
          </p>
          {modalError && <p className="text-error text-sm mt-2">{modalError}</p>}
        </ActionModal>
      );
    }

    return null;
  };

  // ---------- render ----------

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Рассылки</h1>
        <p className="text-sm text-base-content/50 mt-1">Новостные и рекламные рассылки, от которых можно отписаться. Где возможно, отписываем автоматически, иначе открываем ссылку для отписки.</p>
      </div>

      {toast && (
        <div role="alert" className="alert alert-warning">
          <span>{toast}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Поиск..."
          className="input input-sm input-bordered w-48"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        <span className="text-sm text-base-content/60 shrink-0">
          {total.toLocaleString()} {plural(total, "рассылка", "рассылки", "рассылок")}
        </span>

        {hasAnyFilter && (
          <button className="badge badge-sm badge-ghost cursor-pointer" onClick={handleClearAll}>
            сбросить всё
          </button>
        )}

        {/* Inline pagination */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            className="btn btn-sm btn-ghost btn-circle"
            disabled={page === 1}
            onClick={() => handlePageChange(page - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm tabular-nums text-base-content/60 px-1">
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-sm btn-ghost btn-circle"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Sort dropdown */}
        <div className="relative" ref={sortRef}>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={() => setShowSort(s => !s)}>
            <ArrowUpDown className="w-4 h-4" />
          </button>
          {showSort && (
            <div className="absolute right-0 top-full z-20 bg-base-200 rounded-xl shadow-lg mt-1 py-1 min-w-36">
              {SORT_OPTIONS.map(o => (
                <button
                  key={o.value}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-base-300 transition-colors ${
                    sortBy === o.value ? "font-medium text-base-content" : "text-base-content/60"
                  }`}
                  onClick={() => { handleSortChange(o.value); setShowSort(false); }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter dropdown */}
        <div className="relative" ref={filterRef}>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={() => setShowFilters(f => !f)}>
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          {showFilters && (
            <div className="absolute right-0 top-full z-20 bg-base-200 rounded-xl shadow-lg mt-1 p-4 min-w-64 space-y-3">
              <FilterGroup
                label="Объём"
                options={["oneoff", "low", "medium", "high"]}
                labels={["Разово (≤5)", "Мало (≤25)", "Средне (≤100)", "Много (100+)"]}
                value={volumeFilter}
                onChange={v => { setVolumeFilter(v); setPage(1); }}
              />
              <FilterGroup
                label="Активность"
                options={["active", "inactive", "stale"]}
                labels={["Активна (<1 года)", "1–2 года назад", "2+ года назад"]}
                colors={["secondary", "secondary", "secondary"]}
                value={activityFilter}
                onChange={v => { setActivityFilter(v); setPage(1); }}
              />
              <div className="pt-2 border-t border-base-content/10">
                <div className="text-sm text-base-content/40 mb-1.5">Утечки</div>
                <button
                  className={`badge badge-sm cursor-pointer ${breachedFilter ? "badge-warning" : "badge-soft badge-warning"}`}
                  onClick={() => { setBreachedFilter(v => !v); setPriorityFilter(false); setWhitelistedFilter(false); setPage(1); }}
                >
                  ⚠️ В базах утечек
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2 — presets */}
      <div className="flex items-center gap-2">
        <button
          className={`badge badge-sm cursor-pointer gap-1 ${whitelistedFilter ? "badge-accent" : "badge-soft badge-accent"}`}
          onClick={() => { const next = !whitelistedFilter; setWhitelistedFilter(next); setPriorityFilter(false); setBreachedFilter(false); setPage(1); setSelectedIds(new Set()); }}
        >
          <BadgeCheck className="w-3 h-3" />
          Белый список
        </button>

        <div className="w-px h-3 bg-base-content/20" />

        {MAIL_PRESETS.filter(p => p.id !== "whitelisted").map(p => {
          const active = p.id === "priorities" ? priorityFilter : breachedFilter;
          return (
            <button
              key={p.id}
              className={`badge badge-sm cursor-pointer ${active ? "badge-accent" : "badge-soft badge-accent"}`}
              onClick={() => {
                const next = !active;
                setWhitelistedFilter(false);
                setPriorityFilter(p.id === "priorities" ? next : false);
                setBreachedFilter(p.id === "breached" ? next : false);
                setPage(1);
                setSelectedIds(new Set());
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : vendors.length === 0 ? (
        <div className="card bg-base-200">
          <div className="card-body text-center">
            <h2 className="card-title justify-center">Всё чисто!</h2>
            <p className="text-base-content/60">
              {search ? "Нет рассылок, подходящих под поиск" : "Массовые рассылки не обнаружены"}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {/* Select-all / batch actions header */}
            <div className={`${ROW_GRID} px-4 py-1 rounded-xl bg-base-300`}>
              {/* Col 1: select-all checkbox */}
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                ref={selectAllRef}
                checked={allEligibleSelected}
                onChange={handleSelectAll}
                disabled={eligibleVendors.length === 0}
              />
              {/* Col 2: separator — mirrors chevron slot width without implying expandability */}
              <div className="flex items-center justify-center">
                <div className="w-px h-3 bg-base-content/20" />
              </div>
              {/* Col 3: action buttons + selected count — aligned with sender name */}
              <div className="flex items-center gap-1">
                <button
                  className="btn btn-ghost btn-sm btn-square tooltip text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80 disabled:opacity-25"
                  data-tip="Отписаться"
                  disabled={selectedIds.size === 0}
                  onClick={() => openBatch("unsubscribe")}
                >
                  <BellOff className="w-4 h-4" strokeWidth={1.5} />
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-square tooltip text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80 disabled:opacity-25"
                  data-tip="Пометить как спам"
                  disabled={selectedIds.size === 0}
                  onClick={() => openBatch("spam")}
                >
                  <Flag className="w-4 h-4" strokeWidth={1.5} />
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-square tooltip text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80 disabled:opacity-25"
                  data-tip="В корзину"
                  disabled={selectedIds.size === 0}
                  onClick={() => openBatch("trash")}
                >
                  <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                </button>
                {selectedIds.size > 0 && (
                  <span className="text-sm text-base-content/50 ml-1">
                    выбрано: {selectedIds.size}
                  </span>
                )}
              </div>
              {/* Col 4: empty */}
              <div />
              {/* Col 5: empty */}
              <div />
            </div>

            {vendors.map((vendor) => {
              const isExpanded = expandedRows.has(vendor.id);
              const messages = messagesCache.get(vendor.id);
              const displayName =
                vendor.name || vendor.root_domain || "Неизвестно";

              return (
                <div
                  key={vendor.id}
                  className="card bg-base-200 overflow-visible rounded-2xl"
                >
                  <div
                    className={`group p-4 cursor-pointer hover:bg-base-300 transition-colors ${
                      isExpanded ? "rounded-t-2xl" : "rounded-2xl"
                    }`}
                    onClick={() => handleToggleExpand(vendor)}
                  >
                    <div className={`${ROW_GRID} w-full`}>
                      {/* Checkbox column */}
                      {vendor.has_rfc8058 || vendor.has_mailto_unsub ? (
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selectedIds.has(vendor.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(vendor.id);
                            else next.delete(vendor.id);
                            setSelectedIds(next);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          disabled
                          title="Нужна ручная отписка"
                        />
                      )}

                      <ChevronRight
                        className={`w-5 h-5 text-base-content/50 shrink-0 transition-transform ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />

                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">
                          {displayName}
                        </span>
                        {vendor.breachInfo && vendor.breachInfo.length > 0 && (
                          <span
                            className="shrink-0 leading-none"
                            title={vendor.breachInfo.some(b => b.likelyAffected) ? "Вероятно, у вас был аккаунт на момент утечки" : "Домен есть в базах утечек"}
                          >
                            {vendor.breachInfo.some(b => b.likelyAffected) ? "⚠️" : "ℹ️"}
                          </span>
                        )}
                        <span
                          className="badge badge-sm badge-soft badge-neutral text-base-content/60 shrink-0 tabular-nums"
                          title="Письма"
                        >
                          {vendor.message_count}
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div
                        className={`flex items-center gap-2 transition-opacity ${isExpanded ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {vendor.root_domain && (
                          <button
                            className="btn btn-outline btn-xs text-base-content/50 hover:border-base-content/80 hover:text-base-content/80"
                            onClick={(e) => handleWhitelistClick(e, vendor)}
                            aria-label="В белый список"
                          >
                            В белый список
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm btn-square tooltip tooltip-top text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80"
                          data-tip="Отписаться"
                          onClick={(e) => handleUnsubscribeClick(e, vendor)}
                          aria-label="Отписаться"
                        >
                          <BellOff className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-square tooltip tooltip-top text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80"
                          data-tip="Пометить как спам"
                          onClick={(e) => handleSpamClick(e, vendor)}
                          aria-label="Пометить как спам"
                        >
                          <Flag className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-square tooltip tooltip-top text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80"
                          data-tip="В корзину"
                          onClick={(e) => handleTrashClick(e, vendor)}
                          aria-label="В корзину"
                        >
                          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>

                      <div className="text-sm text-base-content/60 tabular-nums text-right justify-self-end">
                        {formatRelativeDate(vendor.last_seen ?? 0)}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-base-300 bg-base-300/50 rounded-b-2xl">
                      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
                        <span className="text-sm font-medium text-base-content/60">
                          {vendor.root_domain ?? vendor.name}
                        </span>
                        <button
                          className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content"
                          onClick={(e) => {
                            e.stopPropagation();
                            const groupKey = vendor.company_slug ?? vendor.root_domain ?? String(vendor.id);
                            navigate(`/accounts/${encodeURIComponent(groupKey)}`);
                          }}
                        >
                          Подробнее
                          <ChevronRight className="w-3 h-3" strokeWidth={2} />
                        </button>
                      </div>
                      {messages === undefined ? (
                        <div className="p-4 flex justify-center">
                          <span className="loading loading-spinner loading-sm"></span>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="p-4 text-center text-base-content/50">
                          Писем не найдено
                        </div>
                      ) : (
                        <div className="divide-y divide-base-300">
                          {messages.map((msg) => (
                            <div
                              key={msg.id}
                              className="px-4 py-3 flex items-center gap-4"
                            >
                              <span className="text-sm text-base-content/50 shrink-0 w-24">
                                {formatRelativeDate(msg.date)}
                              </span>
                              <span className="text-sm truncate">
                                {msg.subject ?? "(Без темы)"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end items-center gap-1">
            <button
              className="btn btn-sm btn-ghost btn-circle"
              disabled={page === 1}
              onClick={() => handlePageChange(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm tabular-nums text-base-content/60 px-1">
              {page} / {totalPages}
            </span>
            <button
              className="btn btn-sm btn-ghost btn-circle"
              disabled={page >= totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {renderModal()}
    </div>
  );
}
