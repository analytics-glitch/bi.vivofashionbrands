import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtKES, fmtNum, fmtPct, fmtDelta, buildParams } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { Loading, Empty } from "@/components/common";
import { KPICard } from "@/components/KPICard";
import { DataQualityPill } from "@/components/DataQualityPill";
import {
  X, Storefront, ArrowRight, ShoppingBag, UsersThree,
  Calendar, Download, Target, Coins, Flag,
} from "@phosphor-icons/react";

/**
 * StoreDeepDive — the slide-over drawer triggered by clicking any
 * Location card. The audit called this "the single biggest missed
 * opportunity on the platform" — every store card was a dead-end.
 *
 * This pane answers the Store-Manager persona's real question:
 *   "How is MY store doing, what's selling, who are my people,
 *    and where do I go to act on this?"
 *
 * Design decisions:
 *   - Right-side slide-over (not a full-page replacement) so the
 *     Locations grid stays in peripheral vision and the user can
 *     jump between stores quickly.
 *   - ESC to close, click-outside-to-close, and a big × in the header.
 *   - Each section has a "see more" CTA that navigates to the relevant
 *     full-page view with filters pre-applied.
 *   - Everything else on the platform already knows about the channel
 *     filter, so the CTAs are free composition.
 */

const COUNTRY_FLAGS = {
  Kenya: "🇰🇪", Uganda: "🇺🇬", Rwanda: "🇷🇼", Online: "🌐",
};
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Reusable tone helper for mini-stat pills
const statTone = (delta) => {
  if (delta == null || !isFinite(delta)) return "";
  return delta >= 0 ? "text-emerald-700" : "text-red-600";
};

const DeltaPill = ({ delta, higherIsBetter = true, label }) => {
  if (delta == null || !isFinite(delta)) return null;
  const up = delta >= 0;
  const good = higherIsBetter ? up : !up;
  const cls = good ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
      {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%{label && <span className="font-normal opacity-60 ml-0.5">{label}</span>}
    </span>
  );
};

const StoreDeepDive = ({
  open,
  onClose,
  row,                // the store's enriched row from the parent grid
  compareLbl,         // "vs last month" etc.
  weekdayData,        // /api/footfall/weekday-pattern payload (optional — if
                      // provided, we extract this store's row for the mini heatmap)
}) => {
  const navigate = useNavigate();
  const { applied } = useFilters();
  const { dateFrom, dateTo, countries } = applied;
  const [topSkus, setTopSkus] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  const channel = row?.channel;

  // ESC handler for accessibility. Mount/unmount-scoped so it doesn't
  // interfere with other components.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock page scroll while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open || !channel) return;
    let cancel = false;
    setLoading(true);
    // Two parallel calls the second the drawer opens. If the backend
    // ever gets slow, this is the place to add a short-lived cache.
    const params = { date_from: dateFrom, date_to: dateTo, channel, limit: 10 };
    Promise.all([
      api.get("/top-skus", { params }).then((r) => r.data || []).catch(() => []),
      api.get("/top-customers", { params }).then((r) => r.data || []).catch(() => []),
    ]).then(([skus, customers]) => {
      if (cancel) return;
      setTopSkus(skus);
      setTopCustomers(customers);
    }).finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [open, channel, dateFrom, dateTo]);

  // Pull just this store's weekday row from the parent's heatmap payload.
  const storeWeekday = useMemo(() => {
    if (!weekdayData?.rows || !channel) return null;
    return weekdayData.rows.find((r) => r.location === channel) || null;
  }, [weekdayData, channel]);

  const groupWeekday = weekdayData?.group_avg_by_weekday || [];

  if (!row || !open) return null;

  const country = row.country || "—";
  const dqFlags = [];
  if (row.return_outlier) dqFlags.push({ label: "Returns flagged", reason: row.return_outlier.reason });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        data-testid="store-deepdive-backdrop"
        aria-hidden="true"
      />
      {/* Sheet */}
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[min(720px,92vw)] bg-panel shadow-2xl overflow-y-auto"
        data-testid="store-deepdive"
        role="dialog"
        aria-modal="true"
        aria-labelledby="store-deepdive-title"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-panel/95 backdrop-blur px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-soft text-brand grid place-items-center shrink-0">
            <Storefront size={20} weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] text-muted font-semibold uppercase tracking-[0.14em]">
              {COUNTRY_FLAGS[country] || "🌍"} {country} · Store deep-dive
            </div>
            <h2
              id="store-deepdive-title"
              className="text-[20px] sm:text-[22px] font-bold text-brand-deep leading-tight tracking-tight truncate"
              title={channel}
            >
              {channel}
            </h2>
            {dqFlags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {dqFlags.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                    title={f.reason}
                    data-testid={`deepdive-dq-${i}`}
                  >
                    ⚠ {f.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full hover:bg-white text-muted hover:text-foreground transition-colors grid place-items-center"
            data-testid="store-deepdive-close"
            aria-label="Close store deep-dive"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* KPI strip — read entirely from `row` (already computed upstream). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <MiniStat
              icon={<Coins size={12} />}
              label="Sales" value={fmtKES(row.total_sales)}
              deltaPct={row.d_sales}
              testId="dd-stat-sales"
            />
            <MiniStat
              icon={<ShoppingBag size={12} />}
              label="Orders" value={fmtNum(row.orders)}
              deltaPct={row.d_orders}
              testId="dd-stat-orders"
            />
            <MiniStat
              icon={<Target size={12} />}
              label="ABV" value={fmtKES(row.abv)}
              deltaPct={row.d_abv}
              testId="dd-stat-abv"
            />
            <MiniStat
              icon={<Flag size={12} />}
              label="Returns" value={fmtKES(row.returns || 0)}
              deltaPct={row.d_returns}
              higherIsBetter={false}
              testId="dd-stat-returns"
            />
          </div>

          {/* Weekday pattern — only renders if the parent has the heatmap
              payload (Locations page provides it when a winner is clicked
              from the leaderboard). Mini inline version, 1-row × 7-col. */}
          {storeWeekday && (
            <section
              className="card-white p-4"
              data-testid="deepdive-weekday"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-[11.5px] font-bold uppercase tracking-wider text-brand-deep flex items-center gap-1.5">
                    <Calendar size={12} weight="fill" /> Weekday pattern
                  </div>
                  <div className="text-[10.5px] text-muted">
                    Avg footfall & conversion over the last 28 days.
                  </div>
                </div>
              </div>
              <div className="grid gap-0.5" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
                {WEEKDAY_SHORT.map((w) => (
                  <div key={w} className="text-center text-[9.5px] text-muted font-semibold uppercase tracking-wider">{w}</div>
                ))}
                {storeWeekday.by_weekday.map((w, i) => {
                  const hasData = w.days > 0;
                  const grp = groupWeekday[i]?.avg_footfall || 0;
                  const ratio = grp > 0 ? Math.min(1.5, (w.avg_footfall || 0) / grp) : 0;
                  // Above-group = brand-green intensity; below = cream.
                  const bg = hasData
                    ? `rgba(26, 92, 56, ${Math.min(0.85, ratio * 0.6)})`
                    : "transparent";
                  const textLight = ratio > 0.8;
                  return (
                    <div
                      key={i}
                      className="rounded-md px-1 py-1 text-center"
                      style={{ background: bg, color: textLight ? "white" : "#1f2937" }}
                      title={hasData ? `${w.avg_footfall} visitors · ${w.avg_conversion_rate.toFixed(1)}% CR (${w.days} days sampled)` : "no data"}
                      data-testid={`dd-wk-${WEEKDAY_SHORT[i]}`}
                    >
                      <div className="text-[11px] font-bold">
                        {hasData ? (w.avg_footfall >= 1000 ? `${(w.avg_footfall / 1000).toFixed(1)}k` : Math.round(w.avg_footfall)) : "—"}
                      </div>
                      <div className="text-[9px] opacity-80">
                        {hasData ? `${w.avg_conversion_rate.toFixed(0)}%` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Top 10 styles */}
          <section className="card-white p-4" data-testid="deepdive-top-styles">
            <SectionHeader
              title="Top 10 styles"
              subtitle="Best-sellers at this store — protect stock cover on these."
              cta="Open Products"
              onCta={() => navigate("/products")}
              testId="deepdive-top-styles-cta"
            />
            {loading ? (
              <Loading label="Loading styles…" />
            ) : topSkus.length === 0 ? (
              <Empty label="No style data for this store in the selected window." />
            ) : (
              <ol className="space-y-1.5">
                {topSkus.map((s, i) => (
                  <li
                    key={(s.style_name || "") + i}
                    className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0"
                  >
                    <span className="w-4 text-[11px] text-muted text-right font-bold">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[12.5px] truncate" title={s.style_name}>{s.style_name}</div>
                      <div className="text-[10.5px] text-muted truncate">
                        {s.brand || "—"} · {s.product_type || "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[12.5px] font-bold text-brand num">{fmtKES(s.total_sales)}</div>
                      <div className="text-[10.5px] text-muted num">{fmtNum(s.units_sold)} units</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Top 10 customers */}
          <section className="card-white p-4" data-testid="deepdive-top-customers">
            <SectionHeader
              title="Top 10 customers"
              subtitle="Biggest spenders at this location — a shortlist for thank-you calls."
              cta="Open Customers"
              onCta={() => navigate("/customers")}
              testId="deepdive-top-customers-cta"
            />
            {loading ? (
              <Loading label="Loading customers…" />
            ) : topCustomers.length === 0 ? (
              <Empty label="No customer data for this store in the selected window." />
            ) : (
              <ol className="space-y-1.5">
                {topCustomers.map((c, i) => {
                  const name = c.customer_name || c.display_name || c.customer_id || "Customer";
                  return (
                    <li
                      key={(c.customer_id || name) + i}
                      className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0"
                    >
                      <span className="w-4 text-[11px] text-muted text-right font-bold">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[12.5px] truncate">{name}</div>
                        <div className="text-[10.5px] text-muted">
                          {fmtNum(c.total_orders || c.orders)} orders
                          {c.last_purchase && ` · last ${new Date(c.last_purchase).toLocaleDateString("en-GB")}`}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[12.5px] font-bold text-brand num">{fmtKES(c.total_spent || c.total_sales)}</div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Deep-link CTAs — every other page on the platform already knows
              about the channel filter. This is where the workbench pattern
              pays off: the deep-dive is the launcher. */}
          <section className="card-white p-4" data-testid="deepdive-cross-links">
            <div className="text-[11.5px] font-bold uppercase tracking-wider text-brand-deep mb-2">
              Go deeper on {channel}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CrossLink label="Footfall" icon={<UsersThree size={14} />} onClick={() => navigate("/footfall")} testId="deepdive-goto-footfall" />
              <CrossLink label="Customers" icon={<UsersThree size={14} />} onClick={() => navigate("/customers")} testId="deepdive-goto-customers" />
              <CrossLink label="Products" icon={<ShoppingBag size={14} />} onClick={() => navigate("/products")} testId="deepdive-goto-products" />
              <CrossLink label="Export this store's data" icon={<Download size={14} />} onClick={() => navigate("/exports")} testId="deepdive-goto-exports" />
            </div>
            <div className="mt-2 text-[10.5px] text-muted/90">
              Tip: open the global POS filter to narrow these pages to this store only.
            </div>
          </section>
        </div>
      </aside>
    </>
  );
};

const MiniStat = ({ icon, label, value, deltaPct, higherIsBetter = true, testId }) => (
  <div className="card-white p-2.5" data-testid={testId}>
    <div className="flex items-center gap-1 text-[10.5px] text-muted font-semibold uppercase tracking-wider">
      <span className="text-brand">{icon}</span>
      {label}
    </div>
    <div className="mt-1 text-[16px] font-bold text-brand-deep num leading-tight">{value}</div>
    <div className="mt-0.5">
      <DeltaPill delta={deltaPct} higherIsBetter={higherIsBetter} />
    </div>
  </div>
);

const SectionHeader = ({ title, subtitle, cta, onCta, testId }) => (
  <div className="flex items-start justify-between gap-2 mb-2">
    <div>
      <div className="text-[13px] font-bold text-brand-deep tracking-tight">{title}</div>
      {subtitle && <div className="text-[11px] text-muted">{subtitle}</div>}
    </div>
    {cta && (
      <button
        type="button"
        onClick={onCta}
        data-testid={testId}
        className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full text-[11px] font-semibold bg-brand/10 hover:bg-brand/20 border border-brand/30 text-brand-deep hover:border-brand/60 transition-all whitespace-nowrap"
      >
        {cta} <ArrowRight size={10} weight="bold" />
      </button>
    )}
  </div>
);

const CrossLink = ({ label, icon, onClick, testId }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className="inline-flex items-center justify-between gap-1 px-2.5 py-2 rounded-lg bg-brand-soft/60 hover:bg-brand-soft border border-brand/25 hover:border-brand/60 text-[12px] font-semibold text-brand-deep transition-all"
  >
    <span className="flex items-center gap-1.5"><span className="text-brand">{icon}</span>{label}</span>
    <ArrowRight size={12} weight="bold" />
  </button>
);

export default StoreDeepDive;
