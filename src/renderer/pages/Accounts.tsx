import { useActionAccess } from "../context/LicenseContext";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { Vendor, VendorQuery } from "@shared/types";
import { PII_LABELS, PII_TYPES } from "@shared/pii-query";
import { RISK_CATEGORIES } from "@shared/vendor-risk";
import { BadgeCheck, ChevronRight, ChevronLeft, ArrowUpDown, SlidersHorizontal, Check, IdCard } from "lucide-react";
import { getActivitySignal, ACTIVITY_BADGE } from "../utils/signals";
import ActionModal from "../components/ActionModal";
import FilterGroup from "../components/FilterGroup";
import { plural } from "@shared/formatting";

const RISK_BORDER: Record<string, string> = {
  high: "border-error",
  medium: "border-warning",
  low: "border-success",
  unknown: "border-base-300",
};

const CATEGORY_OPTIONS = Object.keys(RISK_CATEGORIES) as Array<keyof typeof RISK_CATEGORIES>;
const CATEGORY_LABELS = CATEGORY_OPTIONS.map((c) => `${RISK_CATEGORIES[c].icon} ${RISK_CATEGORIES[c].label}`);

const SORT_OPTIONS = [
  { value: "risk", label: "По риску" },
  { value: "message_count", label: "Больше писем" },
  { value: "last_seen", label: "Сначала новые" },
  { value: "last_seen_asc", label: "Сначала старые" },
  { value: "name", label: "По названию" },
];

interface Preset {
  id: string;
  label: string;
  risk?: string;
  activity?: string;
  dataType?: string;
  volume?: string;
  breached?: boolean;
  defaultSort?: string;
}

const DISCOVERY_PRESETS: Preset[] = [
  { id: "highrisk", label: "Высокий риск", risk: "high" },
  { id: "onetime", label: "Разовые заказы", dataType: "has_orders", volume: "oneoff" },
  { id: "breached", label: "Утечки", breached: true, defaultSort: "risk" },
];

const HISTORY_PRESETS: Preset[] = [
  { id: "oldaccounts", label: "Старые аккаунты", risk: "high", activity: "stale" },
  { id: "oldorders", label: "Старые заказы", dataType: "has_orders", activity: "stale" },
];

type AccountModal =
  | { kind: "whitelist"; vendor: Vendor }
  | { kind: "reviewed"; vendor: Vendor };

interface AccountsState {
  page: number;
  sortBy: string;
  search: string;
  riskFilter: string;
  activityFilter: string;
  dataTypeFilter: string;
  volumeFilter: string;
  categoryFilter: string;
  piiTypeFilter: string;
  anyBreachFilter: boolean;
  showReviewed: boolean;
}

export default function Accounts(): JSX.Element {
  const allowAction = useActionAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = location.state as { preset?: string; restore?: AccountsState } | null;

  // Restore previous filter state when returning from a detail page.
  // Preset activation (e.g. from Dashboard) is used only on a fresh load.
  const restore = locState?.restore;
  const presets = [...DISCOVERY_PRESETS, ...HISTORY_PRESETS];
  const initialPreset = restore ? undefined : presets.find((p) => p.id === locState?.preset);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState<AccountModal | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(restore?.page ?? 1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(restore?.search ?? "");
  const [sortBy, setSortBy] = useState(restore?.sortBy ?? initialPreset?.defaultSort ?? "risk");
  const [riskFilter, setRiskFilter] = useState(restore?.riskFilter ?? (initialPreset ? (initialPreset.risk ?? "") : ""));
  const [activityFilter, setActivityFilter] = useState(restore?.activityFilter ?? (initialPreset ? (initialPreset.activity ?? "") : ""));
  const [dataTypeFilter, setDataTypeFilter] = useState(restore?.dataTypeFilter ?? initialPreset?.dataType ?? "");
  const [volumeFilter, setVolumeFilter] = useState(restore?.volumeFilter ?? initialPreset?.volume ?? "");
  const [categoryFilter, setCategoryFilter] = useState(restore?.categoryFilter ?? "");
  const [piiTypeFilter, setPiiTypeFilter] = useState(restore?.piiTypeFilter ?? "");
  const [anyBreachFilter, setAnyBreachFilter] = useState(restore?.anyBreachFilter ?? !!(initialPreset?.breached));
  const [showReviewed, setShowReviewed] = useState(restore?.showReviewed ?? false);
  const [showSort, setShowSort] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const limit = 25;

  const sortRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  function isPresetActive(p: Preset): boolean {
    return (
      !showReviewed &&
      !piiTypeFilter &&
      (p.risk ?? "") === riskFilter &&
      (p.activity ?? "") === activityFilter &&
      (p.dataType ?? "") === dataTypeFilter &&
      (p.volume ?? "") === volumeFilter &&
      !!(p.breached) === anyBreachFilter
    );
  }

  function togglePreset(p: Preset) {
    if (isPresetActive(p)) {
      setRiskFilter("");
      setActivityFilter("");
      setDataTypeFilter("");
      setVolumeFilter("");
      setCategoryFilter("");
      setPiiTypeFilter("");
      setAnyBreachFilter(false);
      setSortBy("risk");
    } else {
      setRiskFilter(p.risk ?? "");
      setActivityFilter(p.activity ?? "");
      setDataTypeFilter(p.dataType ?? "");
      setVolumeFilter(p.volume ?? "");
      setCategoryFilter("");
      setPiiTypeFilter("");
      setAnyBreachFilter(!!(p.breached));
      setSortBy(p.defaultSort ?? "message_count");
      setShowReviewed(false);
    }
    setPage(1);
  }

  function toggleReviewed() {
    if (showReviewed) {
      setShowReviewed(false);
    } else {
      setRiskFilter("");
      setActivityFilter("");
      setDataTypeFilter("");
      setVolumeFilter("");
      setCategoryFilter("");
      setPiiTypeFilter("");
      setAnyBreachFilter(false);
      setShowReviewed(true);
    }
    setPage(1);
  }

  function clearAll() {
    setSearch("");
    setRiskFilter("");
    setActivityFilter("");
    setDataTypeFilter("");
    setVolumeFilter("");
    setCategoryFilter("");
    setPiiTypeFilter("");
    setAnyBreachFilter(false);
    setShowReviewed(false);
    setSortBy("risk");
    setPage(1);
  }

  const hasAnyFilter = !!(
    search || riskFilter || activityFilter || dataTypeFilter ||
    volumeFilter || categoryFilter || piiTypeFilter || anyBreachFilter || showReviewed ||
    sortBy !== "risk" || page > 1
  );

  // Keep the current history entry in sync with filter state so the browser back button
  // lands on an entry that already has the correct filters — no flash, no lost state.
  const pathname = location.pathname;
  useEffect(() => {
    navigate(pathname, {
      replace: true,
      state: { restore: { page, sortBy, search, riskFilter, activityFilter, dataTypeFilter, volumeFilter, categoryFilter, piiTypeFilter, anyBreachFilter, showReviewed } satisfies AccountsState },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortBy, search, riskFilter, activityFilter, dataTypeFilter, volumeFilter, categoryFilter, piiTypeFilter, anyBreachFilter, showReviewed]);

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

  function handleWhitelistClick(e: React.MouseEvent, vendor: Vendor) {
    e.stopPropagation();
    if (!allowAction("curate")) return;
    setModal({ kind: "whitelist", vendor });
  }

  function handleReviewedClick(e: React.MouseEvent, vendor: Vendor) {
    e.stopPropagation();
    if (!allowAction("curate")) return;
    setModal({ kind: "reviewed", vendor });
  }

  async function handleWhitelistConfirm() {
    if (!allowAction("curate")) return;
    if (!modal || modal.kind !== "whitelist") return;
    const { vendor } = modal;
    if (!vendor.root_domain) return;
    setActionLoading(true);
    try {
      await window.api.addWhitelistEntry(vendor.root_domain);
      setModal(null);
      setVendors(prev => prev.filter(v => v.id !== vendor.id));
      setTotal(prev => prev - 1);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReviewedConfirm() {
    if (!allowAction("curate")) return;
    if (!modal || modal.kind !== "reviewed") return;
    const { vendor } = modal;
    const newValue = vendor.status !== "reviewed";
    setActionLoading(true);
    try {
      await window.api.markVendorReviewed(vendor.id, newValue);
      setModal(null);
      setVendors(prev => prev.filter(v => v.id !== vendor.id));
      setTotal(prev => prev - 1);
    } finally {
      setActionLoading(false);
    }
  }

  const currentQuery = useMemo((): VendorQuery => {
    const actualSortBy = sortBy === "last_seen_asc" ? "last_seen" : sortBy;
    return {
      page,
      limit,
      sortBy: actualSortBy,
      sortDir: sortBy === "name" || sortBy === "last_seen_asc" || sortBy === "risk" ? "ASC" : "DESC",
      filter: "accounts",
      search: search || undefined,
      risk: riskFilter || undefined,
      activity: activityFilter || undefined,
      dataType: dataTypeFilter || undefined,
      volume: volumeFilter || undefined,
      category: categoryFilter || undefined,
      piiType: (piiTypeFilter || undefined) as VendorQuery["piiType"],
      showReviewed,
      onBreachList: anyBreachFilter || undefined,
    };
  }, [page, sortBy, search, riskFilter, activityFilter, dataTypeFilter, volumeFilter, categoryFilter, piiTypeFilter, showReviewed, anyBreachFilter]);

  const fetchVendors = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const data = await window.api.queryVendors(currentQuery);
    setVendors(data.vendors);
    setTotal(data.total);
    setLoading(false);
  }, [currentQuery]);

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);


  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Аккаунты</h1>
        <p className="text-sm text-base-content/50 mt-1">Компании, у которых, вероятно, есть ваши личные данные: заказы, аккаунты, счета и прочее. Риск оценивается по типу данных и истории утечек.</p>
      </div>

      {/* Row 1 — toolbar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Поиск..."
          className="input input-sm input-bordered w-48"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />

        <span className="text-sm text-base-content/60 shrink-0">
          {total} {plural(total, "компания", "компании", "компаний")}
        </span>

        {hasAnyFilter && (
          <button className="badge badge-sm badge-ghost cursor-pointer" onClick={clearAll}>
            сбросить всё
          </button>
        )}

        {/* Inline pagination */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            className="btn btn-sm btn-ghost btn-circle"
            disabled={page === 1}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm tabular-nums text-base-content/60 px-1">
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-sm btn-ghost btn-circle"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
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
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-base-300 transition-colors ${sortBy === o.value ? "font-medium text-base-content" : "text-base-content/60"
                    }`}
                  onClick={() => { setSortBy(o.value); setPage(1); setShowSort(false); }}
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
                label="Риск"
                options={["high", "medium", "low"]}
                labels={["Высокий", "Средний", "Низкий"]}
                colors={["error", "warning", "success"]}
                value={riskFilter}
                onChange={v => { setRiskFilter(v); setShowReviewed(false); setPage(1); }}
              />
              <FilterGroup
                label="Тип"
                options={["has_orders"]}
                labels={["Заказы"]}
                value={dataTypeFilter}
                onChange={v => { setDataTypeFilter(v); setShowReviewed(false); setPage(1); }}
              />
              <FilterGroup
                label="Активность"
                options={["recent", "active", "inactive", "stale", "dead"]}
                labels={["Недавно (<3 мес)", "Активен (<1 года)", "1–2 года назад", "2+ года назад", "5+ лет назад"]}
                colors={["secondary", "secondary", "secondary", "secondary", "secondary"]}
                value={activityFilter}
                onChange={v => { setActivityFilter(v); setShowReviewed(false); setPage(1); }}
              />
              <FilterGroup
                label="Объём"
                options={["oneoff", "low", "medium", "high"]}
                labels={["Разово (≤5)", "Мало (≤25)", "Средне (≤100)", "Много (100+)"]}
                value={volumeFilter}
                onChange={v => { setVolumeFilter(v); setShowReviewed(false); setPage(1); }}
              />
              <FilterGroup
                label="Категория"
                options={CATEGORY_OPTIONS}
                labels={CATEGORY_LABELS}
                value={categoryFilter}
                onChange={v => { setCategoryFilter(v); setShowReviewed(false); setPage(1); }}
              />
              <FilterGroup
                label="Найдено в письмах"
                options={PII_TYPES}
                labels={PII_TYPES.map(t => PII_LABELS[t])}
                value={piiTypeFilter}
                onChange={v => { setPiiTypeFilter(v); setShowReviewed(false); setPage(1); }}
              />
              <div className="pt-2 border-t border-base-content/10">
                <div className="text-sm text-base-content/40 mb-1.5">Утечки</div>
                <button
                  className={`badge badge-sm cursor-pointer ${anyBreachFilter ? "badge-warning" : "badge-soft badge-warning"}`}
                  onClick={() => { setAnyBreachFilter(v => !v); setShowReviewed(false); setPage(1); }}
                >
                  ⚠️ В базах утечек
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2 — presets + filter icon */}
      <div className="flex items-center gap-2">
        <button
          className={`badge badge-sm cursor-pointer gap-1 ${showReviewed ? "badge-accent" : "badge-soft badge-accent"}`}
          onClick={toggleReviewed}
        >
          <BadgeCheck className="w-3 h-3" />
          Проверенные
        </button>

        <div className="w-px h-3 bg-base-content/20" />

        {presets.map(p => (
          <button
            key={p.id}
            className={`badge badge-sm cursor-pointer ${isPresetActive(p) ? "badge-accent" : "badge-soft badge-accent"}`}
            onClick={() => togglePreset(p)}
          >
            {p.label}
          </button>
        ))}

      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : vendors.length === 0 ? (
        <div className="card bg-base-200">
          <div className="card-body text-center">
            <h2 className="card-title justify-center">Аккаунты не найдены</h2>
            <p className="text-base-content/60 mx-auto">
              {activityFilter === "dead"
                ? "За этот период аккаунты не найдены. Синхронизируйте, чтобы найти более старые."
                : search
                  ? "Нет аккаунтов, подходящих под поиск"
                  : "Измените фильтры или синхронизируйте, чтобы увидеть больше"}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {vendors.map((vendor) => {
              const displayName = vendor.name || vendor.root_domain || "Неизвестно";
              const computedRisk = vendor.risk_level ?? "unknown";
              const groupKey = vendor.root_domain ?? vendor.company_slug ?? String(vendor.id);
              const activitySignal = getActivitySignal(vendor.last_seen);
              const activityBadgeInfo = ACTIVITY_BADGE[activitySignal] ?? null;

              return (
                <div
                  key={vendor.id}
                  className={`card bg-base-200 overflow-visible rounded-2xl border-l-4 ${RISK_BORDER[computedRisk] ?? RISK_BORDER.unknown}`}
                >
                  <div
                    className="p-4 cursor-pointer hover:bg-base-300 transition-colors rounded-2xl group"
                    onClick={() => {
                      const allGroupKeys = vendors.map(v => v.root_domain ?? v.company_slug ?? String(v.id));
                      const currentIndex = allGroupKeys.indexOf(groupKey);
                      navigate(`/accounts/${encodeURIComponent(groupKey)}`, {
                        state: {
                          accountsState: { page, sortBy, search, riskFilter, activityFilter, dataTypeFilter, volumeFilter, categoryFilter, piiTypeFilter, anyBreachFilter, showReviewed } satisfies AccountsState,
                          accountNav: { groupKeys: allGroupKeys, currentIndex, vendorQuery: currentQuery, total, restoreState: { page, sortBy, search, riskFilter, activityFilter, dataTypeFilter, volumeFilter, categoryFilter, piiTypeFilter, anyBreachFilter, showReviewed } },
                        },
                      });
                    }}
                  >
                    <div className="flex items-center gap-3 w-full">
                      {/* Name + count */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{displayName}</span>
                        {vendor.company_slug && (
                          <BadgeCheck
                            className="w-4 h-4 text-info shrink-0"
                            strokeWidth={2}
                            aria-label="Проверенная компания"
                          />
                        )}
                        <span
                          className="badge badge-sm badge-soft badge-neutral text-base-content/60 shrink-0 tabular-nums"
                          title="Письма"
                        >
                          {vendor.message_count}
                        </span>
                        {vendor.hasNotablePii && (
                          <span
                            className="shrink-0 leading-none"
                            title="В этих письмах найдены личные данные"
                          >
                            <IdCard
                              className="w-4 h-4 text-base-content/50"
                              strokeWidth={2}
                              aria-label="В письмах найдены личные данные"
                            />
                          </span>
                        )}
                        {vendor.breachInfo && vendor.breachInfo.length > 0 && (
                          <span
                            className="shrink-0 leading-none"
                            title={vendor.breachInfo.some(b => b.likelyAffected) ? "Вероятно, у вас был аккаунт на момент утечки" : "Утечка была, но ваши данные могли не пострадать"}
                          >
                            {vendor.breachInfo.some(b => b.likelyAffected) ? "⚠️" : "ℹ️"}
                          </span>
                        )}
                      </div>
                      {/* Hover-reveal actions */}
                      <div
                        className="flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
                          className={`btn btn-ghost btn-sm btn-square tooltip tooltip-top text-base-content/50 hover:bg-base-content/10 hover:text-base-content/80 ${vendor.status === "reviewed" ? "text-success" : ""
                            }`}
                          data-tip={vendor.status === "reviewed" ? "Снять отметку" : "Отметить проверенным"}
                          onClick={(e) => handleReviewedClick(e, vendor)}
                          aria-label="Отметить проверенным"
                        >
                          <Check className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                      </div>
                      {/* Signal badges */}
                      <div className="flex gap-1 w-36 shrink-0 justify-end">
                        {activityBadgeInfo && (
                          <span className={`badge badge-xs badge-soft ${activityBadgeInfo.color}`}>
                            {activityBadgeInfo.label}
                          </span>
                        )}
                        {vendor.has_orders && (
                          <span className="badge badge-xs badge-soft">Заказы</span>
                        )}
                        {vendor.has_account && !vendor.has_orders && (
                          <span className="badge badge-xs badge-soft">Аккаунт</span>
                        )}
                        {vendor.has_marketing && !vendor.has_account && (
                          <span className="badge badge-xs badge-soft">Маркетинг</span>
                        )}
                      </div>
                      <ChevronRight
                        className="w-5 h-5 text-base-content/30 shrink-0"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end items-center gap-1">
            <button
              className="btn btn-sm btn-ghost btn-circle"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm tabular-nums text-base-content/60 px-1">
              {page} / {totalPages}
            </span>
            <button
              className="btn btn-sm btn-ghost btn-circle"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {modal?.kind === "whitelist" && (
        <ActionModal
          isOpen
          title="Белый список"
          confirmLabel="Добавить"
          confirmVariant="primary"
          onConfirm={handleWhitelistConfirm}
          onCancel={() => setModal(null)}
          loading={actionLoading}
        >
          <p>
            Отправители из белого списка не показываются в «Аккаунтах» и «Рассылках». Добавить в белый список весь домен{" "}
            <span className="font-mono text-xs bg-base-300 px-1 rounded">
              {modal.vendor.root_domain}
            </span>
            ?
          </p>
        </ActionModal>
      )}

      {modal?.kind === "reviewed" && (
        <ActionModal
          isOpen
          title={modal.vendor.status === "reviewed" ? "Снять отметку" : "Отметить как проверенный"}
          confirmLabel={modal.vendor.status === "reviewed" ? "Снять" : "Отметить"}
          confirmVariant="primary"
          onConfirm={handleReviewedConfirm}
          onCancel={() => setModal(null)}
          loading={actionLoading}
        >
          <p>
            {modal.vendor.status === "reviewed"
              ? `Снять отметку «проверено» с ${modal.vendor.name || modal.vendor.root_domain}?`
              : `Отметить ${modal.vendor.name || modal.vendor.root_domain} как проверенный? Проверенные аккаунты по-прежнему доступны через фильтр «Проверенные».`}
          </p>
        </ActionModal>
      )}
    </div>
  );
}
