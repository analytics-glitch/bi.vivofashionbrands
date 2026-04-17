import React, { useEffect, useMemo, useState } from "react";
import Topbar from "@/components/Topbar";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { api, fmtKES, fmtNum, fmtPct } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import { MagnifyingGlass, SortAscending, SortDescending } from "@phosphor-icons/react";

const sorBadge = (p) => {
  if (p == null) return "pill-amber";
  if (p < 30) return "pill-red";
  if (p < 60) return "pill-amber";
  return "pill-green";
};

const SOR = () => {
  const { dateFrom, dateTo, location } = useFilters();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState("desc"); // desc = high to low

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = {
      date_from: dateFrom,
      date_to: dateTo,
      location: location !== "all" ? location : undefined,
    };
    api
      .get("/sor", { params })
      .then((r) => !cancelled && setRows(r.data || []))
      .catch((e) => !cancelled && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, location]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let res = rows;
    if (q) {
      res = res.filter(
        (r) =>
          (r.style_name || "").toLowerCase().includes(q) ||
          (r.collection || "").toLowerCase().includes(q) ||
          (r.brand || "").toLowerCase().includes(q)
      );
    }
    res = [...res].sort((a, b) => {
      const av = a.sor_percent ?? 0;
      const bv = b.sor_percent ?? 0;
      return dir === "desc" ? bv - av : av - bv;
    });
    return res;
  }, [rows, search, dir]);

  return (
    <div className="space-y-8" data-testid="sor-page">
      <Topbar
        title="Sell-Out Rate"
        subtitle="Style-level sell-through across the selected period."
      />

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && (
        <div className="card p-6" data-testid="sor-table-card">
          <SectionTitle
            title={`${filtered.length} styles`}
            subtitle="Sorted by sell-out rate"
            action={
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 input-pill">
                  <MagnifyingGlass size={14} className="text-muted" />
                  <input
                    placeholder="Search style or collection…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="sor-search"
                    className="bg-transparent outline-none text-sm w-[260px]"
                  />
                </div>
                <button
                  onClick={() => setDir(dir === "desc" ? "asc" : "desc")}
                  className="input-pill flex items-center gap-1.5 text-sm"
                  data-testid="sor-sort-toggle"
                >
                  {dir === "desc" ? <SortDescending size={14} /> : <SortAscending size={14} />}
                  SOR%
                </button>
              </div>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full data" data-testid="sor-table">
              <thead>
                <tr>
                  <th>Style Name</th>
                  <th>Collection</th>
                  <th>Brand</th>
                  <th>Product Type</th>
                  <th className="text-right">Units Sold</th>
                  <th className="text-right">Current Stock</th>
                  <th className="text-right">Total Sales</th>
                  <th className="text-right">SOR %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <Empty />
                    </td>
                  </tr>
                )}
                {filtered.map((r, i) => (
                  <tr key={(r.style_name || "") + i}>
                    <td
                      className="font-medium max-w-[280px] truncate"
                      title={r.style_name}
                      data-testid={`sor-row-${i}`}
                    >
                      {r.style_name}
                    </td>
                    <td className="text-muted">{r.collection || "—"}</td>
                    <td>
                      <span className="pill-green">{r.brand || "—"}</span>
                    </td>
                    <td className="text-muted">{r.product_type || "—"}</td>
                    <td className="text-right font-semibold">{fmtNum(r.units_sold)}</td>
                    <td className="text-right">{fmtNum(r.current_stock)}</td>
                    <td className="text-right font-bold text-brand-strong">
                      {fmtKES(r.total_sales)}
                    </td>
                    <td className="text-right">
                      <span className={sorBadge(r.sor_percent)}>
                        {fmtPct(r.sor_percent)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default SOR;
