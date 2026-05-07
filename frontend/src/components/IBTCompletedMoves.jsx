import React, { useEffect, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, Empty, ErrorBox, SectionTitle } from "@/components/common";
import SortableTable from "@/components/SortableTable";
import { Archive, ArrowRight } from "@phosphor-icons/react";

/**
 * Admin-only report of every IBT suggestion that's been actioned via
 * Mark-as-Done. Generated from /api/ibt/completed.
 */
export default function IBTCompletedMoves({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get("/ibt/completed", { timeout: 30000 })
      .then((r) => { if (!cancelled) setRows(r.data || []); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.detail || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <div className="card-white p-5" data-testid="ibt-completed-report">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Archive size={16} weight="duotone" className="text-[#1a5c38]" />
            Completed Moves Report
            <span className="text-[10.5px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
              admin
            </span>
          </span>
        }
        subtitle="Audit log of every IBT suggestion that's been marked as done. Lapsed = days from suggestion to completion."
      />
      {loading && <Loading label="Loading completed moves…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && rows.length === 0 && (
        <Empty label="No completed moves yet — mark a suggestion as done to populate this table." />
      )}
      {!loading && !error && rows.length > 0 && (
        <SortableTable
          testId="ibt-completed-table"
          exportName="ibt-completed-moves.csv"
          pageSize={50}
          mobileCards
          initialSort={{ key: "completed_at", dir: "desc" }}
          rows={rows}
          columns={[
            {
              key: "style_name", label: "Style", align: "left", mobilePrimary: true,
              render: (r) => (
                <div className="max-w-[260px]">
                  <div className="font-medium break-words" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                    {r.style_name}
                  </div>
                  <div className="text-[10.5px] text-muted">
                    {r.brand}{r.brand && r.subcategory ? " · " : ""}{r.subcategory}
                  </div>
                </div>
              ),
              csv: (r) => r.style_name,
            },
            {
              key: "from_store", label: "From", align: "left",
              render: (r) => <span className="text-[12px]">{r.from_store}</span>,
              csv: (r) => r.from_store,
            },
            {
              key: "__arrow", label: "", sortable: false, align: "left",
              render: () => <ArrowRight size={12} className="text-brand" weight="bold" />,
            },
            {
              key: "to_store", label: "To", align: "left",
              render: (r) => <span className="font-semibold text-[12px] text-brand">{r.to_store}</span>,
              csv: (r) => r.to_store,
            },
            {
              key: "actual_units_moved", label: "Units", numeric: true,
              render: (r) => (
                <span className="num font-bold">
                  {fmtNum(r.actual_units_moved)}
                  {r.actual_units_moved !== r.units_to_move && (
                    <span className="text-[10px] text-muted ml-1">
                      / {r.units_to_move} suggested
                    </span>
                  )}
                </span>
              ),
              csv: (r) => r.actual_units_moved,
            },
            {
              key: "suggested_at", label: "Day suggested", numeric: false, align: "left",
              render: (r) => (
                <span className="text-[11.5px] text-muted">
                  {(r.suggested_at || "").slice(0, 10)}
                </span>
              ),
              csv: (r) => (r.suggested_at || "").slice(0, 10),
              sortValue: (r) => r.suggested_at,
            },
            {
              key: "completed_at", label: "Day transferred", numeric: false, align: "left",
              render: (r) => (
                <span className="text-[11.5px] font-semibold">
                  {(r.completed_at || "").slice(0, 10)}
                </span>
              ),
              csv: (r) => (r.completed_at || "").slice(0, 10),
              sortValue: (r) => r.completed_at,
            },
            {
              key: "days_lapsed", label: "Days lapsed", numeric: true,
              render: (r) => {
                const days = r.days_lapsed;
                const cls = days <= 1 ? "pill-green" : days <= 3 ? "pill-amber" : "pill-red";
                return <span className={cls}>{fmtNum(days)} d</span>;
              },
              csv: (r) => r.days_lapsed,
            },
            {
              key: "po_number", label: "PO #", align: "left",
              render: (r) => <span className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">{r.po_number}</span>,
              csv: (r) => r.po_number,
            },
            {
              key: "completed_by_name", label: "Completed by", align: "left",
              render: (r) => <span className="text-[11.5px]">{r.completed_by_name}</span>,
              csv: (r) => r.completed_by_name,
            },
          ]}
        />
      )}
    </div>
  );
}
