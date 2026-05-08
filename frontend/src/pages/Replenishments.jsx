import React, { useEffect, useMemo, useState, useCallback } from "react";
import { api, fmtNum } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Loading, ErrorBox, Empty, SectionTitle } from "@/components/common";
import {
  Calendar as CalendarIcon, CheckCircle, FilePdf,
  Package, Users, FloppyDisk, ArrowCounterClockwise, MagnifyingGlass,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";

/**
 * Daily Replenishment Page — full workflow.
 *
 * Features:
 *  • Owner roster panel (admin/owner only): set how many people are
 *    available + their names. Persists to /api/admin/replenishment-config
 *    so the next run uses the new roster automatically.
 *  • Live replenishment list — one row per (POS × SKU) needing top-up.
 *    Columns: Owner / POS / Days lapsed / Product / Size / Barcode /
 *    Bin / Sold / SOH Store / SOH WH / Suggested / Actual Replenished /
 *    Action (Mark As Done).
 *  • Days-lapsed pill goes RED when > 2 days.
 *  • Mark As Done snapshots the current shop-floor stock for the SKU
 *    (server-side) so the Completed report shows post-replenishment SOH
 *    and a fulfilment %.
 *  • Per-owner PDF export — tap "PDF" next to an owner's pill to
 *    generate a `<Owner>_replenishments_<date>.pdf`.
 *  • Completed Replenishments table at the bottom — audit trail with
 *    fulfilment rate per row.
 */

const fmtDateInput = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const _isAdminOrOwner = (user) => {
  if (!user) return false;
  const r = (user.role || "").toLowerCase();
  return r === "admin" || r === "owner";
};

const Replenishments = () => {
  const { user } = useAuth();
  const isAdmin = _isAdminOrOwner(user);

  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return fmtDateInput(d);
  }, []);
  const [dateFrom, setDateFrom] = useState(yesterday);
  const [dateTo, setDateTo] = useState(yesterday);

  // Owner config (persisted server-side).
  const [ownerCount, setOwnerCount] = useState(4);
  const [ownerNames, setOwnerNames] = useState(["", "", "", ""]);
  const [ownerSaving, setOwnerSaving] = useState(false);
  const [ownerSavedTick, setOwnerSavedTick] = useState(0);

  // Live data.
  const [data, setData] = useState({ rows: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Per-row local actuals input — empty string until typed; on Mark As Done
  // we send `actual_units_replenished` so the server snapshot can compute
  // a real fulfilment rate.
  const [actuals, setActuals] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  // Search across all visible columns.
  const [search, setSearch] = useState("");

  // Completed report.
  const [completed, setCompleted] = useState({ rows: [], total: 0 });
  const [completedLoading, setCompletedLoading] = useState(false);
  const [completedRefresh, setCompletedRefresh] = useState(0);

  // Bootstrap owner config (admin only — fetch is only allowed for admins).
  useEffect(() => {
    if (!isAdmin) return;
    let cancel = false;
    api.get("/admin/replenishment-config")
      .then(({ data: cfg }) => {
        if (cancel) return;
        const names = (cfg?.owners || []).map(String);
        setOwnerCount(Math.max(1, names.length || 4));
        setOwnerNames(names.length ? names : ["", "", "", ""]);
      })
      .catch(() => { /* fall back to defaults */ });
    return () => { cancel = true; };
  }, [isAdmin]);

  // Resize the owner names array when count changes.
  useEffect(() => {
    setOwnerNames((prev) => {
      const n = Math.max(1, Math.min(20, ownerCount));
      const out = [...prev];
      while (out.length < n) out.push("");
      while (out.length > n) out.pop();
      return out;
    });
  }, [ownerCount]);

  const saveOwners = async () => {
    setOwnerSaving(true);
    try {
      const cleaned = ownerNames.map((s) => s.trim()).filter(Boolean);
      await api.post("/admin/replenishment-config", { owners: cleaned });
      setOwnerSavedTick((t) => t + 1);
      toast.success(cleaned.length
        ? `Roster saved — ${cleaned.length} ${cleaned.length === 1 ? "person" : "people"}`
        : "Roster reset to default");
    } catch (e) {
      toast.error("Couldn't save — " + (e?.response?.data?.detail || e.message));
    } finally {
      setOwnerSaving(false);
    }
  };

  // Fetch live replenishment list (re-runs when roster save tick changes
  // so admins see the new owner assignment immediately).
  const loadLive = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await api.get("/analytics/replenishment-report", {
        params: { date_from: dateFrom, date_to: dateTo },
        timeout: 240000,
      });
      setData(d || { rows: [], summary: null });
      // Re-seed the actuals input with the suggested qty for any row not
      // already in the local state (so the input shows a sensible default).
      const seed = {};
      for (const r of d?.rows || []) {
        const k = `${r.pos_location}|${r.barcode}`;
        if (!(k in actuals)) {
          // If the server already has an actual snapshot, prefer that.
          seed[k] = r.actual_units_replenished != null
            ? String(r.actual_units_replenished)
            : "";
        }
      }
      setActuals((prev) => ({ ...seed, ...prev }));
    } catch (e) {
      setError(e?.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, ownerSavedTick]);

  useEffect(() => { loadLive(); }, [loadLive]);

  // Completed report — admin/owner only since it's a chain-wide audit.
  useEffect(() => {
    if (!isAdmin) return;
    let cancel = false;
    setCompletedLoading(true);
    api.get("/analytics/replenishment-completed", { params: { days: 30 } })
      .then(({ data: c }) => { if (!cancel) setCompleted(c || { rows: [], total: 0 }); })
      .catch(() => { if (!cancel) setCompleted({ rows: [], total: 0 }); })
      .finally(() => { if (!cancel) setCompletedLoading(false); });
    return () => { cancel = true; };
  }, [isAdmin, completedRefresh]);

  // Visible rows = filter out already-completed rows AND apply free-text search.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data.rows || [])
      .filter((r) => !r.replenished)
      .filter((r) => {
        if (!q) return true;
        return (
          (r.owner || "").toLowerCase().includes(q)
          || (r.pos_location || "").toLowerCase().includes(q)
          || (r.product_name || "").toLowerCase().includes(q)
          || (r.size || "").toLowerCase().includes(q)
          || (r.barcode || "").toLowerCase().includes(q)
          || (r.sku || "").toLowerCase().includes(q)
          || (r.bin || "").toLowerCase().includes(q)
        );
      });
  }, [data.rows, search]);

  const setActual = (k, v) => setActuals((prev) => ({ ...prev, [k]: v }));

  const markAsDone = async (row) => {
    const k = `${row.pos_location}|${row.barcode}`;
    const raw = actuals[k];
    const actual = raw === "" || raw == null ? row.replenish : Number(raw);
    if (Number.isNaN(actual) || actual < 0) {
      toast.error("Actual replenished must be ≥ 0");
      return;
    }
    setSavingKey(k);
    try {
      await api.post("/analytics/replenishment-report/mark", {
        date_from: dateFrom,
        date_to: dateTo,
        pos_location: row.pos_location,
        barcode: row.barcode,
        replenished: true,
        actual_units_replenished: actual,
        owner: row.owner,
        product_name: row.product_name,
        size: row.size,
        sku: row.sku,
        country: row.country,
        units_to_replenish: row.replenish,
        soh_store: row.soh_store,
        soh_wh: row.soh_wh,
      });
      // Optimistic flip: stamp `replenished=true` locally so the row
      // disappears from the live list immediately.
      setData((prev) => ({
        ...prev,
        rows: (prev.rows || []).map((r) =>
          r.pos_location === row.pos_location && r.barcode === row.barcode
            ? { ...r, replenished: true, actual_units_replenished: actual }
            : r
        ),
      }));
      setCompletedRefresh((t) => t + 1);
      toast.success("Marked done.");
    } catch (e) {
      toast.error("Couldn't save — " + (e?.response?.data?.detail || e.message));
    } finally {
      setSavingKey(null);
    }
  };

  // Build a per-owner subset for PDF export.
  const ownersUsed = data.summary?.owners_used || [];

  const exportOwnerPdf = (ownerName) => {
    const rows = (data.rows || []).filter(
      (r) => !r.replenished && r.owner === ownerName
    );
    if (rows.length === 0) {
      toast("Nothing to export — this person has no open lines.");
      return;
    }
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 28;

    // Header.
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(`Replenishment Pick List — ${ownerName}`, margin, 36);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const rangeLbl = dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`;
    doc.text(`Window: ${rangeLbl}   ·   Generated: ${new Date().toLocaleString("en-KE")}`, margin, 52);
    const totUnits = rows.reduce((s, r) => s + (r.replenish || 0), 0);
    doc.text(`${rows.length} lines · ${totUnits} units`, margin, 66);

    // Hand-rolled table (avoids the jspdf-autotable runtime dep).
    const headers = ["POS", "Days", "Product", "Size", "Barcode", "Bin", "Sold", "Store", "WH", "Need", "Actual"];
    const colWidths = [110, 32, 200, 40, 70, 56, 38, 38, 38, 38, 50];
    const startX = margin;
    let y = 88;

    const drawRow = (cells, isHeader = false) => {
      let x = startX;
      doc.setFont("helvetica", isHeader ? "bold" : "normal");
      doc.setFontSize(isHeader ? 9 : 9);
      if (isHeader) {
        doc.setFillColor(15, 61, 36);
        doc.rect(startX, y - 11, colWidths.reduce((a, b) => a + b, 0), 16, "F");
        doc.setTextColor(255, 255, 255);
      } else {
        doc.setTextColor(0, 0, 0);
      }
      cells.forEach((c, i) => {
        const text = String(c == null ? "" : c);
        // Truncate long text to fit column.
        const maxW = colWidths[i] - 6;
        let t = text;
        while (doc.getTextWidth(t) > maxW && t.length > 1) t = t.slice(0, -1);
        if (t !== text) t = t.slice(0, -1) + "…";
        doc.text(t, x + 3, y);
        x += colWidths[i];
      });
      doc.setTextColor(0, 0, 0);
    };

    drawRow(headers, true);
    y += 12;
    doc.setDrawColor(220, 220, 220);
    for (const r of rows) {
      if (y > doc.internal.pageSize.getHeight() - 28) {
        doc.addPage();
        y = 36;
        drawRow(headers, true);
        y += 12;
      }
      drawRow([
        r.pos_location || "",
        r.days_lapsed != null ? `${r.days_lapsed}d` : "—",
        r.product_name || "",
        r.size || "",
        r.barcode || "",
        r.bin || "",
        r.units_sold ?? "",
        r.soh_store ?? "",
        r.soh_wh ?? "",
        r.replenish ?? "",
        "",  // blank box for the picker to write the actual qty
      ]);
      doc.line(startX, y + 2, startX + colWidths.reduce((a, b) => a + b, 0), y + 2);
      y += 14;
    }

    // Footer signature block.
    if (y > doc.internal.pageSize.getHeight() - 60) doc.addPage();
    y += 20;
    doc.setFontSize(10);
    doc.text(`Signed by ${ownerName}: __________________________   Date: ____________`, margin, y);

    const safe = ownerName.replace(/[^a-z0-9_-]+/gi, "_");
    doc.save(`${safe}_replenishment_${dateFrom}.pdf`);
  };

  const dateLabel = dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`;
  const summary = data.summary;

  return (
    <div className="space-y-5" data-testid="replenishments-page">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted">Dashboard · Replenishments</div>
        <h1 className="font-extrabold text-foreground" style={{ fontSize: "clamp(20px, 3vw, 28px)" }}>
          Daily Replenishment Workflow
        </h1>
        <p className="text-[12.5px] text-muted mt-1 max-w-3xl">
          For each POS where shop-floor stock is below 2 units AND units sold &gt; 0 in
          the window we recommend a top-up to <b>2 units per SKU</b>, drawn from the
          warehouse. Online channels excluded. Lines distribute equally across your
          team, sorted by POS ascending.
        </p>
      </div>

      {/* Owner roster panel — admin/owner only. */}
      {isAdmin && (
        <div className="card-white p-5" data-testid="replen-owner-panel">
          <SectionTitle
            title={
              <span className="inline-flex items-center gap-2">
                <Users size={16} weight="duotone" className="text-brand-deep" />
                Replenishment team roster
              </span>
            }
            subtitle="How many people are picking today, and who? Save to redistribute lines across your roster — POS sorted ascending so each person owns a contiguous block of stores."
          />
          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4 items-start">
            <div>
              <label className="eyebrow block mb-1">Number of pickers</label>
              <input
                type="number"
                min={1}
                max={20}
                value={ownerCount}
                onChange={(e) => setOwnerCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="input-pill w-full"
                data-testid="replen-owner-count"
              />
            </div>
            <div>
              <label className="eyebrow block mb-1">Names (one per row)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {ownerNames.map((name, i) => (
                  <input
                    key={i}
                    type="text"
                    value={name}
                    placeholder={`Picker ${i + 1}`}
                    onChange={(e) => setOwnerNames((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })}
                    className="input-pill w-full"
                    data-testid={`replen-owner-name-${i}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={saveOwners}
              disabled={ownerSaving}
              className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-3 py-2 rounded-md disabled:opacity-50"
              data-testid="replen-save-owners"
            >
              <FloppyDisk size={13} weight="bold" /> {ownerSaving ? "Saving…" : "Save & redistribute"}
            </button>
            <span className="text-[11px] text-muted">
              Empty list = use the default roster (Matthew, Teddy, Alvi, Emma).
            </span>
          </div>
        </div>
      )}

      {/* Live list. */}
      <div className="card-white p-5" data-testid="replen-live-card">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h2 className="font-extrabold text-[14px] text-[#0f3d24] inline-flex items-center gap-2">
            <Package size={16} weight="duotone" /> Today's pick list · {dateLabel}
          </h2>
          <label className="inline-flex items-center gap-2 text-[12px] font-semibold">
            <CalendarIcon size={14} weight="bold" className="text-brand" /> From
            <input type="date" value={dateFrom} max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              data-testid="replen-date-from"
              className="input-pill text-[12px] py-1.5 px-3" />
          </label>
          <label className="inline-flex items-center gap-2 text-[12px] font-semibold">
            To
            <input type="date" value={dateTo} min={dateFrom} max={fmtDateInput(new Date())}
              onChange={(e) => setDateTo(e.target.value)}
              data-testid="replen-date-to"
              className="input-pill text-[12px] py-1.5 px-3" />
          </label>
        </div>

        {/* Summary pills with per-person PDF export. */}
        {summary && summary.by_owner && summary.by_owner.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3" data-testid="replen-summary">
            {summary.by_owner.map((o) => (
              <span
                key={o.owner}
                className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-semibold pl-2 pr-1 py-1 rounded-full"
                data-testid={`replen-owner-${o.owner.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {o.owner}: <b>{fmtNum(o.lines)}</b> lines · {fmtNum(o.units)} units · {fmtNum(o.stores)} stores
                <button
                  type="button"
                  onClick={() => exportOwnerPdf(o.owner)}
                  className="ml-1 inline-flex items-center gap-0.5 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-2 py-0.5 rounded-full"
                  title={`Download ${o.owner}'s pick list as PDF`}
                  data-testid={`replen-pdf-${o.owner.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  <FilePdf size={10} weight="bold" /> PDF
                </button>
              </span>
            ))}
            <span className="inline-flex items-center gap-1 bg-panel border border-border text-[11px] font-semibold px-2 py-1 rounded-full">
              Total: <b>{fmtNum(summary.total_units)}</b> units · {fmtNum(summary.total_rows)} rows
            </span>
            {(summary.completed ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 bg-emerald-100 border border-emerald-300 text-emerald-900 text-[11px] font-bold px-2 py-1 rounded-full">
                <CheckCircle size={11} weight="fill" /> {summary.completed} done
              </span>
            )}
          </div>
        )}

        {/* Search */}
        <div className="flex items-center gap-2 input-pill mb-3" style={{ maxWidth: 360 }}>
          <MagnifyingGlass size={14} className="text-muted" />
          <input
            placeholder="Search owner / store / SKU / barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="replen-search"
            className="bg-transparent outline-none text-[13px] w-full"
          />
        </div>

        {loading && <Loading label="Computing replenishment list…" />}
        {error && <ErrorBox message={error} />}

        {!loading && !error && (
          visibleRows.length === 0 ? (
            <Empty label={
              (data.rows || []).length === 0
                ? "Nothing to replenish — no in-store SKU sold > 0 with stock < 2 in this window."
                : "All open lines have been actioned. 🎉"
            } />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-white">
              <table className="w-full min-w-max text-[12.5px]" data-testid="replen-table">
                <thead className="bg-panel sticky top-0 z-10">
                  <tr className="text-left">
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Owner</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">POS Location</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap text-right" title="Days since this SKU first appeared on the replenishment list. RED when > 2.">Days lapsed</th>
                    <th className="px-3 py-2.5 font-semibold sticky left-0 bg-panel z-20 min-w-[200px] max-w-[280px]">Product</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Size</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Barcode</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Bin</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Sold</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">SOH Store</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">SOH WH</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Suggested</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Actual replenished</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r, idx) => {
                    const k = `${r.pos_location}|${r.barcode}`;
                    const dl = r.days_lapsed;
                    return (
                      <tr key={k} className={`border-t border-border/50 ${idx % 2 === 0 ? "bg-white" : "bg-panel/30"} hover:bg-amber-50/40`}>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center bg-emerald-100 text-emerald-900 text-[11px] font-bold px-2 py-0.5 rounded-full">
                            {r.owner || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap font-semibold">{r.pos_location}</td>
                        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap" data-testid={`replen-days-lapsed-${idx}`}>
                          {dl == null ? <span className="text-muted">—</span>
                            : dl > 2 ? <span className="inline-flex items-center bg-rose-100 text-rose-800 border border-rose-300 font-bold px-2 py-0.5 rounded-full">{dl}d</span>
                            : <span className="text-muted">{dl}d</span>}
                        </td>
                        <td className="px-3 py-3 sticky left-0 bg-inherit z-[5] min-w-[200px] max-w-[280px]">
                          <span className="break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.product_name}</span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{r.size || "—"}</td>
                        <td className="px-3 py-3 whitespace-nowrap font-mono text-[11px]">{r.barcode}</td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          {r.bin
                            ? <span className="inline-flex items-center bg-amber-100 text-amber-900 text-[10.5px] font-bold px-1.5 py-0.5 rounded">{r.bin}</span>
                            : <span className="text-muted text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmtNum(r.units_sold)}</td>
                        <td className={`px-3 py-3 text-right tabular-nums ${r.soh_store === 0 ? "text-rose-700 font-bold" : ""}`}>
                          {fmtNum(r.soh_store)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmtNum(r.soh_wh)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          <span className="inline-flex items-center bg-emerald-100 text-emerald-900 font-bold px-2 py-0.5 rounded-full">{fmtNum(r.replenish)}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            placeholder={String(r.replenish)}
                            value={actuals[k] ?? ""}
                            onChange={(e) => setActual(k, e.target.value)}
                            className="w-20 h-9 px-2 text-right tabular-nums border border-border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand/40"
                            data-testid={`replen-actual-${idx}`}
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => markAsDone(r)}
                            disabled={savingKey === k}
                            className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 px-3 py-2 rounded-md whitespace-nowrap"
                            data-testid={`replen-mark-done-${idx}`}
                            title="Log the actual units replenished and remove this row from the open list"
                          >
                            <CheckCircle size={13} weight="fill" />
                            {savingKey === k ? "Saving…" : "Mark As Done"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Completed report (admin/owner). */}
      {isAdmin && (
        <div className="card-white p-5" data-testid="replen-completed-card">
          <SectionTitle
            title={
              <span className="inline-flex items-center gap-2">
                <CheckCircle size={16} weight="duotone" className="text-emerald-700" />
                Completed Replenishments · last 30 days
              </span>
            }
            subtitle="Audit trail of every line marked done — fulfilment % = actual replenished ÷ suggested. Stock after replenishment is sampled from the live store SOH at the moment Mark As Done was clicked."
            action={
              <button
                type="button"
                onClick={() => setCompletedRefresh((t) => t + 1)}
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-deep border border-border hover:bg-panel px-2.5 py-1.5 rounded-md"
                data-testid="replen-completed-refresh"
              >
                <ArrowCounterClockwise size={12} weight="bold" /> Refresh
              </button>
            }
          />
          {completedLoading && <Loading label="Loading audit trail…" />}
          {!completedLoading && (completed.rows || []).length === 0 && (
            <Empty label="No completed replenishments in the last 30 days." />
          )}
          {!completedLoading && (completed.rows || []).length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border bg-white">
              <table className="w-full min-w-max text-[12.5px]">
                <thead className="bg-panel sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Completed at</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">User</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">POS Location</th>
                    <th className="px-3 py-2.5 font-semibold">Product</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Size</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Barcode</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Qty to replenish</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Qty replenished</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Fulfilment %</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Qty after replenish</th>
                  </tr>
                </thead>
                <tbody>
                  {(completed.rows || []).map((r) => (
                    <tr key={r.key} className="border-t border-border/50 hover:bg-panel/30">
                      <td className="px-3 py-2 text-[11px] tabular-nums">
                        {r.completed_at ? r.completed_at.replace("T", " ").slice(0, 16) : "—"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center bg-emerald-100 text-emerald-900 text-[11px] font-bold px-2 py-0.5 rounded-full">
                          {r.owner || r.completed_by_name || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.pos_location}</td>
                      <td className="px-3 py-2 break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.product_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.size || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px]">{r.barcode}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.units_to_replenish)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-700">{fmtNum(r.actual_units_replenished)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.fulfilment_pct == null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <span className={`inline-flex items-center font-bold px-2 py-0.5 rounded-full ${
                            r.fulfilment_pct >= 100 ? "bg-emerald-100 text-emerald-900"
                              : r.fulfilment_pct >= 50 ? "bg-amber-100 text-amber-900"
                              : "bg-rose-100 text-rose-900"
                          }`}>{r.fulfilment_pct}%</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.soh_after == null ? <span className="text-muted">—</span> : fmtNum(r.soh_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Replenishments;
