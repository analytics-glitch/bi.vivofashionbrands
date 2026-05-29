import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { fmtKESMobile, fmtNum, fmtPct } from "@/lib/api";
import { X, DownloadSimple, CircleNotch } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Executive Summary mobile snapshot — full-screen overlay matching
 * the OverviewSnapshot pattern exactly. Strips drill-downs, formula
 * tooltips, and side panes; keeps just the headline label · value ·
 * vs-LY delta tiles arranged in a single-screenshot 2-col grid.
 *
 * Triggered from the Executive Summary page's "Mobile snapshot" pill
 * button. The page hides its full layout while `snapshot` state is
 * true; clicking "Save image" calls html2canvas and downloads a PNG.
 */

const Delta = ({ pct, higherIsBetter = true }) => {
  if (pct == null || Number.isNaN(pct)) return null;
  const positive = pct > 0;
  const good = higherIsBetter ? positive : !positive;
  const cls = Math.abs(pct) < 0.5
    ? "text-muted"
    : good ? "text-emerald-700" : "text-red-700";
  const arrow = Math.abs(pct) < 0.5 ? "—" : positive ? "▲" : "▼";
  return (
    <span className={`text-[10.5px] font-semibold ${cls}`}>
      {arrow} {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

const Tile = ({ testId, label, value, deltaPct, compareLbl, accent = false, higherIsBetter = true }) => (
  <div
    data-testid={testId}
    className={`rounded-lg px-2.5 py-2 border ${
      accent
        ? "bg-brand text-white border-brand"
        : "bg-panel/60 border-border text-foreground"
    }`}
  >
    <div className={`text-[9px] uppercase tracking-wider font-semibold leading-tight truncate ${accent ? "text-white/85" : "text-muted"}`}>{label}</div>
    <div className={`font-extrabold text-[16px] leading-tight mt-0.5 truncate ${accent ? "text-white" : ""}`}>{value}</div>
    {compareLbl && (
      <div className={`mt-0.5 text-[9px] leading-tight flex items-center gap-1 truncate ${accent ? "text-white/85" : "text-muted"}`}>
        <span className="truncate">{compareLbl}</span>
        <Delta pct={deltaPct} higherIsBetter={higherIsBetter} />
      </div>
    )}
  </div>
);

const Highlight = ({ testId, label, name, amount }) => (
  <div className="rounded-lg px-2.5 py-2 bg-brand text-white" data-testid={testId}>
    <div className="text-[9px] uppercase tracking-wider font-semibold text-white/80 leading-tight">{label}</div>
    <div className="font-extrabold text-[12.5px] leading-tight mt-0.5 truncate">{name || "—"}</div>
    {amount && <div className="text-[9px] font-semibold text-white/85 mt-0.5 truncate">{amount}</div>}
  </div>
);

/**
 * Helper: short-form a [from, to] window like the Overview snapshot's
 * "29 May 2026 → 29 May 2026" header. Falls back gracefully if the
 * range isn't ISO-shaped (e.g. payload didn't include `windows`).
 */
const _fmtShort = (iso) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
};

const ExecutiveSummarySnapshot = ({ data, onClose }) => {
  const ytd = data?.ytd?.kpis || {};
  const mtd = data?.mtd?.kpis || {};
  const ytdWin = data?.windows?.ytd?.current;
  const mtdWin = data?.windows?.mtd?.current;

  // Top country, top store, best category — mined client-side from
  // the same data block the rest of the page reads so we don't fire
  // a snapshot-only request.
  const topCountry = [...(data?.ytd?.countries || [])]
    .sort((a, b) => (b.revenue?.cur || 0) - (a.revenue?.cur || 0))[0];
  const topStore = [...(data?.ytd?.stores || [])]
    .sort((a, b) => (b.cur || 0) - (a.cur || 0))[0];
  const topSubcat = [...(data?.ytd?.categories?.subcategories || [])]
    .sort((a, b) => (b.cur || 0) - (a.cur || 0))[0];

  const captureRef = useRef(null);
  const [saving, setSaving] = useState(false);

  const onSaveImage = async () => {
    if (!captureRef.current || saving) return;
    setSaving(true);
    try {
      // Match OverviewSnapshot exactly: 2× DPR, transparent bg so the
      // card's own tint shows through.
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const stamp = (data?.as_of || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
      const link = document.createElement("a");
      link.download = `vivo-exec-summary-snapshot_${stamp}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Snapshot saved — ready to share", { duration: 3000 });
    } catch (e) {
      toast.error("Couldn't save snapshot — " + (e?.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-background"
      data-testid="exec-snapshot"
    >
      <div className="mx-auto w-full max-w-[440px] px-3 pt-2 pb-4" ref={captureRef} data-snapshot-capture>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="eyebrow text-[9px]">Snapshot · Executive Summary</div>
            <h1 className="font-extrabold text-[18px] tracking-tight leading-tight">Executive Summary</h1>
            <p className="text-muted text-[10.5px] mt-0.5 leading-tight">
              {ytdWin ? `YTD ${_fmtShort(ytdWin[0])} → ${_fmtShort(ytdWin[1])}` : ""}
              <span className="ml-1.5 pill-neutral text-[9.5px]">vs Last Year</span>
            </p>
            {mtdWin && (
              <p className="text-muted text-[9.5px] leading-tight">
                MTD {_fmtShort(mtdWin[0])} → {_fmtShort(mtdWin[1])}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onSaveImage}
              disabled={saving}
              data-testid="exec-snapshot-save"
              data-html2canvas-ignore="true"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-bold border border-brand bg-brand text-white hover:bg-brand/90 disabled:opacity-60 disabled:cursor-wait"
              title="Save this snapshot as a PNG to share"
            >
              {saving
                ? <CircleNotch size={12} weight="bold" className="animate-spin" />
                : <DownloadSimple size={12} weight="bold" />}
              {saving ? "Saving…" : "Save image"}
            </button>
            <button
              type="button"
              onClick={onClose}
              data-testid="exec-snapshot-close"
              data-html2canvas-ignore="true"
              className="p-1.5 rounded-full border border-border hover:bg-panel"
              aria-label="Exit snapshot"
            >
              <X size={14} weight="bold" />
            </button>
          </div>
        </div>

        {/* YTD headline KPIs — 2-column compact grid */}
        <div className="text-[9px] uppercase tracking-wider font-bold text-muted mt-2 mb-1">YTD vs LY</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Tile
            testId="exec-snap-revenue"
            accent
            label="Total Revenue"
            value={fmtKESMobile(ytd.revenue?.cur || 0)}
            deltaPct={ytd.revenue?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-avgday"
            label="Avg Sales / Day"
            value={fmtKESMobile(ytd.avg_sales_per_day?.cur || 0)}
            deltaPct={ytd.avg_sales_per_day?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-units"
            label="Units Sold"
            value={fmtNum(ytd.units?.cur || 0)}
            deltaPct={ytd.units?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-footfall"
            label="Total Footfall"
            value={fmtNum(ytd.footfall?.cur || 0)}
            deltaPct={ytd.footfall?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-basket"
            label="Avg Basket"
            value={fmtKESMobile(ytd.avg_basket?.cur || 0)}
            deltaPct={ytd.avg_basket?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-asp"
            label="ASP · Avg Sell Price"
            value={fmtKESMobile(ytd.asp?.cur || 0)}
            deltaPct={ytd.asp?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-customers"
            label="Total Customers"
            value={fmtNum(ytd.total_customers?.cur || 0)}
            deltaPct={ytd.total_customers?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-new"
            label="New Customers"
            value={fmtNum(ytd.new_customers?.cur || 0)}
            deltaPct={ytd.new_customers?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-returning"
            label="Returning Customers"
            value={fmtNum(ytd.returning_customers?.cur || 0)}
            deltaPct={ytd.returning_customers?.delta_pct}
            compareLbl="vs Last Year"
          />
        </div>

        {/* MTD headline — same metrics but the current month, side-by-
            side so leadership reads the short-window story underneath
            the long-window context. */}
        <div className="text-[9px] uppercase tracking-wider font-bold text-muted mt-3 mb-1">MTD vs LY</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Tile
            testId="exec-snap-mtd-revenue"
            accent
            label="MTD Revenue"
            value={fmtKESMobile(mtd.revenue?.cur || 0)}
            deltaPct={mtd.revenue?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-mtd-avgday"
            label="MTD Avg / Day"
            value={fmtKESMobile(mtd.avg_sales_per_day?.cur || 0)}
            deltaPct={mtd.avg_sales_per_day?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-mtd-units"
            label="MTD Units"
            value={fmtNum(mtd.units?.cur || 0)}
            deltaPct={mtd.units?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-mtd-asp"
            label="MTD ASP"
            value={fmtKESMobile(mtd.asp?.cur || 0)}
            deltaPct={mtd.asp?.delta_pct}
            compareLbl="vs Last Year"
          />
          <Tile
            testId="exec-snap-mtd-basket"
            label="MTD Avg Basket"
            value={fmtKESMobile(mtd.avg_basket?.cur || 0)}
            deltaPct={mtd.avg_basket?.delta_pct}
            compareLbl="vs Last Year"
          />
        </div>

        {/* Highlights — top country / store / category mined from the
            same payload (no extra fetch). */}
        <div className="grid grid-cols-3 gap-1.5 mt-3">
          <Highlight
            testId="exec-snap-top-country"
            label="Top Country"
            name={topCountry?.country || "—"}
            amount={topCountry ? fmtKESMobile(topCountry.revenue?.cur || 0) : null}
          />
          <Highlight
            testId="exec-snap-top-store"
            label="Top Store"
            name={topStore?.channel || "—"}
            amount={topStore ? fmtKESMobile(topStore.cur || 0) : null}
          />
          <Highlight
            testId="exec-snap-top-subcat"
            label="Top Subcat"
            name={topSubcat?.subcategory || "—"}
            amount={topSubcat ? fmtKESMobile(topSubcat.cur || 0) : null}
          />
        </div>

        {/* Group pace banner — single full-width tile so the headline
            target % stands alone at the bottom of the snapshot. */}
        {data?.targets?.total?.ytd > 0 && (
          (() => {
            const pct = ((ytd.revenue?.cur || 0) / data.targets.total.ytd) * 100;
            const tone = pct >= 100 ? "bg-emerald-600" : pct >= 90 ? "bg-amber-500" : "bg-rose-600";
            return (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-white ${tone}`}
                data-testid="exec-snap-group-pace"
              >
                <div className="text-[9px] uppercase tracking-wider font-bold text-white/80 leading-tight">Group YTD pace vs target</div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="font-extrabold text-[18px] tabular-nums">{pct.toFixed(0)}%</span>
                  <span className="text-[10px] text-white/85">of {fmtKESMobile(data.targets.total.ytd)} target</span>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
};

export default ExecutiveSummarySnapshot;
