import React, { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api";
import { SectionTitle, Loading, ErrorBox } from "@/components/common";
import { MagnifyingGlass } from "@phosphor-icons/react";
import SortableTable from "@/components/SortableTable";

const PAGE_SIZE = 100;

const ActivityLogs = () => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [skip, setSkip] = useState(0);
  const [emailQ, setEmailQ] = useState("");
  const [pathQ, setPathQ] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params = { limit: PAGE_SIZE, skip };
    if (pathQ) params.path = pathQ;
    api.get("/admin/activity-logs", { params })
      .then((r) => {
        setRows(r.data.rows || []);
        setTotal(r.data.total || 0);
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, [skip, pathQ]);

  useEffect(() => { load(); }, [load]);

  const fmtTs = (ts) => {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    } catch { return ts; }
  };

  const filtered = emailQ
    ? rows.filter((r) => (r.email || "").toLowerCase().includes(emailQ.toLowerCase()))
    : rows;

  return (
    <div className="space-y-6" data-testid="activity-logs-page">
      <div>
        <div className="eyebrow">Admin · Activity Logs</div>
        <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">Activity Logs</h1>
        <p className="text-muted text-[13px] mt-0.5">Every authenticated API request is logged. Useful for auditing access.</p>
      </div>

      <div className="card-white p-3 flex flex-wrap items-center gap-3" data-testid="logs-filter">
        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="pl-8 pr-3 py-2 rounded-lg border border-border text-[13px] w-56"
            placeholder="Email contains…" value={emailQ} onChange={(e) => setEmailQ(e.target.value)}
            data-testid="logs-filter-email" />
        </div>
        <div className="relative">
          <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="pl-8 pr-3 py-2 rounded-lg border border-border text-[13px] w-56"
            placeholder="Path contains…" value={pathQ}
            onChange={(e) => { setSkip(0); setPathQ(e.target.value); }}
            data-testid="logs-filter-path" />
        </div>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted">{total.toLocaleString()} total events</span>
      </div>

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <div className="card-white p-5" data-testid="logs-table-wrap">
          <SectionTitle
            title={`Showing ${filtered.length} / ${total.toLocaleString()}`}
            subtitle={skip > 0 ? `Skip: ${skip}` : "Most recent first"}
          />
          <SortableTable
            testId="logs-table"
            exportName="activity-logs.csv"
            initialSort={{ key: "ts", dir: "desc" }}
            columns={[
              { key: "ts", label: "Timestamp", align: "left", render: (r) => fmtTs(r.ts) },
              { key: "email", label: "User", align: "left", render: (r) => (
                <span className="font-mono text-[12px]">{r.email}</span>
              ) },
              { key: "method", label: "Method", align: "left", render: (r) => (
                <span className={`pill-${r.method === "GET" ? "neutral" : "green"} text-[10.5px]`}>{r.method}</span>
              ) },
              { key: "path", label: "Path", align: "left", render: (r) => (
                <span className="font-mono text-[11px]">{r.path}</span>
              ) },
              { key: "query", label: "Query", align: "left", render: (r) => (
                <span className="text-muted font-mono text-[10.5px] max-w-[280px] truncate inline-block" title={r.query}>{r.query || "—"}</span>
              ) },
              { key: "status_code", label: "Status", numeric: true, render: (r) => (
                <span className={`pill-${r.status_code < 300 ? "green" : r.status_code < 400 ? "neutral" : "red"}`}>{r.status_code}</span>
              ) },
              { key: "duration_ms", label: "Time (ms)", numeric: true, render: (r) => r.duration_ms?.toLocaleString() || "—" },
              { key: "ip", label: "IP", align: "left", render: (r) => (
                <span className="font-mono text-[10.5px] text-muted max-w-[140px] truncate inline-block" title={r.ip}>{r.ip}</span>
              ) },
            ]}
            rows={filtered}
          />
          <div className="flex justify-between items-center mt-3 text-[12px]">
            <button
              className="px-3 py-1.5 rounded-lg border border-border hover:border-brand disabled:opacity-40"
              disabled={skip === 0}
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              data-testid="logs-prev"
            >← Previous</button>
            <button
              className="px-3 py-1.5 rounded-lg border border-border hover:border-brand disabled:opacity-40"
              disabled={skip + PAGE_SIZE >= total}
              onClick={() => setSkip(skip + PAGE_SIZE)}
              data-testid="logs-next"
            >Next →</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityLogs;
