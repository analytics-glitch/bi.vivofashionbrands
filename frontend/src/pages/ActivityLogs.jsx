import React, { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api";
import { SectionTitle, Loading, ErrorBox } from "@/components/common";
import { MagnifyingGlass, ArrowClockwise } from "@phosphor-icons/react";
import SortableTable from "@/components/SortableTable";

const PAGE_SIZE = 100;

// Hash a string to an HSL hue so each user gets a stable, distinct
// avatar background even without an upstream colour assignment.
const colorFor = (seed) => {
  if (!seed) return "#475569";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 38%)`;
};

const initialsOf = (name, email) => {
  const src = (name || email || "?").trim();
  if (!src) return "?";
  const parts = src.split(/\s+|@|\./).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
};

const ActiveUsersSection = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    api.get("/admin/active-sessions", { params: { window_minutes: 5 } })
      .then((r) => setData(r.data || null))
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    // Live-poll every 30s so the count drifts up/down as users come
    // and go without manual reload.  Heartbeats from the FE happen
    // every 2 min, so anything more frequent than 30s is wasteful.
    const id = setInterval(refresh, 30 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const rows = data?.rows || [];
  return (
    <div className="card-white p-5" data-testid="active-users-section">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="eyebrow text-[10.5px] mb-0.5">Live presence · last 5 min</div>
          <h3 className="font-extrabold text-[15px] leading-tight" data-testid="active-users-count">
            {loading && !data ? "Loading…" : `${data?.count ?? 0} user${(data?.count ?? 0) === 1 ? "" : "s"} active right now`}
          </h3>
          <p className="text-muted text-[12px] mt-0.5">
            Anyone with a tab open in the last 5 minutes. Polled every 30s.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          data-testid="active-users-refresh"
          className="px-3 py-1 rounded-lg border border-border text-[11.5px] font-semibold hover:bg-panel disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <ArrowClockwise size={12} weight="bold" />
          Refresh
        </button>
      </div>
      {error && <ErrorBox message={error} />}
      {!error && (
        <div className="flex flex-wrap gap-2" data-testid="active-users-avatars">
          {rows.length === 0 && !loading && (
            <span className="text-muted text-[12px] italic">
              No one else online — looks like you're flying solo right now.
            </span>
          )}
          {rows.map((u) => (
            <div
              key={u.user_id}
              className="inline-flex items-center gap-2 rounded-full bg-panel pl-1 pr-3 py-1 border border-border"
              title={`${u.name || u.email} · ${u.role}\nLast seen ${new Date(u.last_seen).toLocaleTimeString()}${u.page ? `\nOn: ${u.page}` : ""}`}
              data-testid={`active-user-${u.user_id}`}
            >
              <span
                className="inline-flex items-center justify-center text-white font-bold rounded-full w-6 h-6 text-[10px]"
                style={{ background: colorFor(u.email || u.user_id) }}
              >
                {initialsOf(u.name, u.email)}
              </span>
              <span className="text-[11.5px] font-medium">{u.name || u.email?.split("@")[0]}</span>
              {u.role === "admin" && (
                <span className="text-[9px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-full">ADMIN</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

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
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(15px,1.5vw,19px)]">Activity Logs</h1>
        <p className="text-muted text-[13px] mt-0.5">Every authenticated API request is logged. Useful for auditing access.</p>
      </div>

      <ActiveUsersSection />

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
