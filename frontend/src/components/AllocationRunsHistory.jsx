import React, { useEffect, useMemo, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, Empty, ErrorBox, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { ClockCounterClockwise, DownloadSimple, CaretDown, CaretRight } from "@phosphor-icons/react";

/**
 * Recent allocation runs — a per-row snapshot of every Save click.
 * Click a row to expand and see the per-store suggested-vs-allocated
 * detail. Each run also has a "Download CSV" button.
 */
const AllocationRunsHistory = ({ refreshKey }) => {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/allocations/runs", { timeout: 30000 })
      .then((r) => { if (!cancelled) setRuns(r.data || []); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const downloadRun = (run) => {
    const sizeKeys = Object.keys(run.pack_breakdown || {});
    const header = [
      "Store",
      "Suggested Packs", "Suggested Units",
      "Allocated Packs", "Allocated Units",
      "Delta Units",
      ...sizeKeys.map((s) => `${s} units`),
    ];
    const lines = [
      `Style:,"${(run.style_name || "").replace(/"/g, '""')}"`,
      `Type:,${run.allocation_type}`,
      `Subcategory:,"${run.subcategory || ""}"`,
      `Color:,"${run.color || "all"}"`,
      `Units total:,${run.units_total}`,
      `Pack size:,${run.pack_unit_size}`,
      `Saved:,${run.created_at}`,
      `Saved by:,${run.created_by_email}`,
      "",
      header.join(","),
    ];
    (run.rows || []).forEach((r) => {
      lines.push([
        `"${(r.store || "").replace(/"/g, '""')}"`,
        r.suggested_packs, r.suggested_units,
        r.allocated_packs, r.allocated_units,
        (r.allocated_units || 0) - (r.suggested_units || 0),
        ...sizeKeys.map((s) => (r.sizes?.[s] || 0)),
      ].join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const fname = `allocation_${(run.style_name || "untitled").replace(/[^\w]+/g, "_")}_${(run.created_at || "").slice(0, 10)}.csv`;
    link.download = fname;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(link.href);
  };

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [runs]
  );

  return (
    <div className="card-white p-5" data-testid="allocation-history">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <ClockCounterClockwise size={16} weight="duotone" className="text-[#1a5c38]" />
            Recent Allocations
          </span>
        }
        subtitle="Every saved allocation run. Click a row to see per-store suggested vs allocated detail. Use Download to export the run as a CSV."
      />
      {loading && <Loading label="Loading history…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && sortedRuns.length === 0 && (
        <Empty label="No saved allocations yet — calculate then click Save allocation to create a record." />
      )}
      {!loading && !error && sortedRuns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" data-testid="allocation-history-table">
            <thead>
              <tr className="bg-[#fde7c5] text-[#5b3a00]">
                <th className="text-left px-3 py-2 w-6"></th>
                <th className="text-left px-3 py-2">Style</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Subcat</th>
                <th className="text-left px-3 py-2">Color</th>
                <th className="text-right px-3 py-2">Suggested</th>
                <th className="text-right px-3 py-2">Allocated</th>
                <th className="text-right px-3 py-2">Δ</th>
                <th className="text-left px-3 py-2">Saved</th>
                <th className="text-left px-3 py-2">By</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRuns.map((run) => {
                const open = expandedId === run.id;
                return (
                  <React.Fragment key={run.id}>
                    <tr
                      className={`border-b border-border/40 hover:bg-amber-50/40 cursor-pointer ${open ? "bg-amber-50/40" : ""}`}
                      onClick={() => setExpandedId(open ? null : run.id)}
                      data-testid={`alloc-history-row-${run.id}`}
                    >
                      <td className="px-3 py-1.5">
                        {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                      </td>
                      <td className="px-3 py-1.5 font-bold text-foreground" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                        {run.style_name}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                          run.allocation_type === "replenishment"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}>
                          {run.allocation_type}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted">{run.subcategory}</td>
                      <td className="px-3 py-1.5 text-muted">{run.color || "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-muted">{fmtNum(run.suggested_total)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-bold">{fmtNum(run.allocated_total)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                        run.delta_total > 0 ? "text-amber-700" : run.delta_total < 0 ? "text-rose-700" : "text-muted"
                      }`}>
                        {run.delta_total > 0 ? `+${run.delta_total}` : run.delta_total}
                      </td>
                      <td className="px-3 py-1.5 text-muted">
                        {(run.created_at || "").slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-3 py-1.5 text-muted">{run.created_by_name || run.created_by_email}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); downloadRun(run); }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-deep border border-brand-deep/30 hover:bg-brand-deep/5 px-2 py-1 rounded-md"
                          data-testid={`alloc-history-download-${run.id}`}
                        >
                          <DownloadSimple size={11} /> CSV
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-amber-50/30 border-b border-amber-200">
                        <td colSpan={11} className="px-3 py-3">
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11.5px]">
                              <thead>
                                <tr className="text-muted">
                                  <th className="text-left px-2 py-1">Store</th>
                                  <th className="text-right px-2 py-1">Suggested packs</th>
                                  <th className="text-right px-2 py-1">Allocated packs</th>
                                  <th className="text-right px-2 py-1">Suggested units</th>
                                  <th className="text-right px-2 py-1">Allocated units</th>
                                  <th className="text-right px-2 py-1">Δ Units</th>
                                  {Object.keys(run.pack_breakdown || {}).map((sz) => (
                                    <th key={sz} className="text-right px-2 py-1">{sz}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(run.rows || []).map((r, i) => {
                                  const delta = (r.allocated_units || 0) - (r.suggested_units || 0);
                                  return (
                                    <tr key={i} className="border-b border-border/30">
                                      <td className="px-2 py-1 font-medium">{r.store}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-muted">{r.suggested_packs}</td>
                                      <td className="px-2 py-1 text-right tabular-nums font-bold">{r.allocated_packs}</td>
                                      <td className="px-2 py-1 text-right tabular-nums text-muted">{fmtNum(r.suggested_units)}</td>
                                      <td className="px-2 py-1 text-right tabular-nums font-bold">{fmtNum(r.allocated_units)}</td>
                                      <td className={`px-2 py-1 text-right tabular-nums ${
                                        delta > 0 ? "text-amber-700" : delta < 0 ? "text-rose-700" : "text-muted"
                                      }`}>
                                        {delta > 0 ? `+${delta}` : delta}
                                      </td>
                                      {Object.keys(run.pack_breakdown || {}).map((sz) => (
                                        <td key={sz} className="px-2 py-1 text-right tabular-nums">
                                          {fmtNum(r.sizes?.[sz] || 0)}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AllocationRunsHistory;
