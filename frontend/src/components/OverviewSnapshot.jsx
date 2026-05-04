import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { fmtKESMobile, fmtNum, fmtPct, fmtDate, pctDelta } from "@/lib/api";
import { X, DownloadSimple, CircleNotch } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Mobile KPI snapshot — a single-screen compact layout designed for taking
 * one mobile screenshot of every headline KPI.  Drill-down actions, formula
 * tooltips, and icons are intentionally stripped; we keep just:
 *   • the label
 *   • the current-period value
 *   • the vs-compare-period delta (when a compare period is set)
 *
 * Triggered from the Overview page via the "Mobile snapshot" pill button —
 * Overview swaps its full layout for this component while `snapshot` state
 * is true. The "Exit" button restores the regular dashboard.
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

const OverviewSnapshot = ({
  dateFrom, dateTo, compareLbl,
  kpis, kpisPrev,
  footfallAgg, footfallAggPrev,
  subcatTop, topChannel, bestConversionStore,
  isOnlineOnly,
  onClose,
}) => {
  const k = kpis || {};
  const kp = kpisPrev || {};

  // Derived values that match the Overview KPI layout exactly.
  const abv = k.total_orders ? k.total_sales / k.total_orders : 0;
  const abvPrev = kp.total_orders ? kp.total_sales / kp.total_orders : null;
  const msi = k.total_orders ? k.total_units / k.total_orders : 0;
  const msiPrev = kp.total_orders ? kp.total_units / kp.total_orders : null;

  const d = (cur, prev) => (compareLbl && prev != null ? pctDelta(cur, prev) : null);

  const captureRef = useRef(null);
  const [saving, setSaving] = useState(false);

  const onSaveImage = async () => {
    if (!captureRef.current || saving) return;
    setSaving(true);
    try {
      // Render the snapshot card to a canvas at 2x DPR for retina-sharp output,
      // then trigger a PNG download. We pass `backgroundColor: null` so the
      // card's own background colour is preserved (avoids a stray white halo
      // when the card uses a tinted bg).
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const stamp = `${dateFrom}_to_${dateTo}`.replace(/-/g, "");
      const link = document.createElement("a");
      link.download = `vivo-overview-snapshot_${stamp}.png`;
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
      data-testid="overview-snapshot"
    >
      <div className="mx-auto w-full max-w-[440px] px-3 pt-2 pb-4" ref={captureRef} data-snapshot-capture>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="eyebrow text-[9px]">Snapshot · Overview</div>
          <h1 className="font-extrabold text-[18px] tracking-tight leading-tight">Overview</h1>
          <p className="text-muted text-[10.5px] mt-0.5 leading-tight">
            {fmtDate(dateFrom)} → {fmtDate(dateTo)}
            {compareLbl && (
              <span className="ml-1.5 pill-neutral text-[9.5px]">{compareLbl}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onSaveImage}
            disabled={saving}
            data-testid="snapshot-save"
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
            data-testid="snapshot-close"
            data-html2canvas-ignore="true"
            className="p-1.5 rounded-full border border-border hover:bg-panel"
            aria-label="Exit snapshot"
          >
            <X size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* Headline KPIs — 2-column compact grid (single screenshot height) */}
      <div className="grid grid-cols-2 gap-1.5">
        <Tile
          testId="snap-total-sales"
          accent
          label="Total Sales"
          value={fmtKESMobile(k.total_sales)}
          deltaPct={d(k.total_sales, kp.total_sales)}
          compareLbl={compareLbl}
        />
        <Tile
          testId="snap-net-sales"
          label="Net Sales"
          value={fmtKESMobile(k.net_sales)}
          deltaPct={d(k.net_sales, kp.net_sales)}
          compareLbl={compareLbl}
        />
        <Tile
          testId="snap-orders"
          label="Transactions"
          value={fmtNum(k.total_orders)}
          deltaPct={d(k.total_orders, kp.total_orders)}
          compareLbl={compareLbl}
        />
        <Tile
          testId="snap-units"
          label="Total Units Sold"
          value={fmtNum(k.total_units)}
          deltaPct={d(k.total_units, kp.total_units)}
          compareLbl={compareLbl}
        />
        {!isOnlineOnly && (
          <Tile
            testId="snap-footfall"
            label="Total Footfall"
            value={fmtNum(footfallAgg?.total_footfall || 0)}
            deltaPct={d(footfallAgg?.total_footfall || 0, footfallAggPrev?.total_footfall)}
            compareLbl={compareLbl}
          />
        )}
        {!isOnlineOnly && (
          <Tile
            testId="snap-conversion"
            label="Conversion Rate"
            value={fmtPct(footfallAgg?.conversion_rate || 0, 2)}
            deltaPct={d(footfallAgg?.conversion_rate || 0, footfallAggPrev?.conversion_rate)}
            compareLbl={compareLbl}
          />
        )}

        {/* Sub-KPIs */}
        <Tile
          testId="snap-abv"
          label="ABV · Avg Basket"
          value={fmtKESMobile(abv)}
          deltaPct={d(abv, abvPrev)}
          compareLbl={compareLbl}
        />
        <Tile
          testId="snap-asp"
          label="ASP · Avg Sell Price"
          value={fmtKESMobile(k.avg_selling_price)}
          deltaPct={d(k.avg_selling_price, kp.avg_selling_price)}
          compareLbl={compareLbl}
        />
        <Tile
          testId="snap-msi"
          label="MSI · Items / Basket"
          value={msi.toFixed(2)}
          deltaPct={d(msi, msiPrev)}
          compareLbl={compareLbl}
        />
        <Tile
          testId="snap-rr"
          label="Return Rate"
          value={fmtPct(k.return_rate, 2)}
          deltaPct={d(k.return_rate, kp.return_rate)}
          compareLbl={compareLbl}
          higherIsBetter={false}
        />
        <Tile
          testId="snap-returns"
          label="Return Amount"
          value={fmtKESMobile(k.total_returns)}
          deltaPct={d(k.total_returns, kp.total_returns)}
          compareLbl={compareLbl}
          higherIsBetter={false}
        />
      </div>

      {/* Highlights — compact 3-col strip so all 3 fit on the same screenshot row */}
      <div className={`grid ${isOnlineOnly ? "grid-cols-1" : "grid-cols-3"} gap-1.5 mt-1.5`}>
        <Highlight
          testId="snap-top-subcategory"
          label="Top Subcat"
          name={subcatTop && subcatTop.length ? subcatTop[0].subcategory : "—"}
          amount={
            subcatTop && subcatTop.length
              ? `${fmtKESMobile(subcatTop[0].total_sales)} · ${subcatTop[0].pct.toFixed(1)}%`
              : null
          }
        />
        {!isOnlineOnly && (
          <Highlight
            testId="snap-top-location"
            label="Top Location"
            name={topChannel ? topChannel.channel : "—"}
            amount={topChannel ? fmtKESMobile(topChannel.total_sales) : null}
          />
        )}
        {!isOnlineOnly && (
          <Highlight
            testId="snap-best-conversion"
            label="Best Conv."
            name={bestConversionStore ? bestConversionStore.location : "—"}
            amount={bestConversionStore ? fmtPct(bestConversionStore.conversion_rate) : null}
          />
        )}
      </div>
      </div>
    </div>
  );
};

export default OverviewSnapshot;
