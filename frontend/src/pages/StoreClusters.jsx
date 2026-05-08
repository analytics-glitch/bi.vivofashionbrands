import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Loading, ErrorBox, SectionTitle, Empty } from "@/components/common";
import { ArrowsClockwise, Stack, Calendar } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Store Peer-Cluster inspector (Phase 1 — surface only).
 *
 * Lets admins eyeball the latest cluster run before we trust it to drive
 * IBT logic in Phase 2. Shows:
 *   • Per-cluster centroid in plain English (ASP, basket, size skew, mix)
 *   • Member stores with their feature values
 *   • A "Re-cluster now" button (uses the cached 90-day order pull, fast)
 *   • Optional "Use 12-month tier" checkbox for the slower run
 */
const StoreClusters = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reclustering, setReclustering] = useState(false);
  const [useYear, setUseYear] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api.get("/admin/store-clusters", { forceFresh: refreshKey > 0 })
      .then(({ data: d }) => {
        if (cancel) return;
        setData(d);
        setError(null);
      })
      .catch((e) => !cancel && setError(e?.response?.data?.detail || e.message))
      .finally(() => !cancel && setLoading(false));
    return () => { cancel = true; };
  }, [refreshKey]);

  const recluster = async () => {
    setReclustering(true);
    try {
      const { data: d } = await api.post(
        `/admin/store-clusters/recluster${useYear ? "?use_year=true" : ""}`,
        null,
        { timeout: 240000 }
      );
      setData(d);
      toast.success(`Re-clustered ${d.n_stores} stores using ${d.tier_window} window`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error("Re-cluster failed — " + (e?.response?.data?.detail || e.message));
    } finally {
      setReclustering(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="store-clusters-page">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted">Admin · Store peer-clusters</div>
        <h1 className="font-extrabold text-foreground" style={{ fontSize: "clamp(20px, 3vw, 28px)" }}>
          Store Peer-Cluster Inspector
        </h1>
        <p className="text-[12.5px] text-muted mt-1 max-w-3xl">
          Phase 1 surface — IBT recommendations now display each store's
          peer-cluster id (e.g. <b>A1</b>) but the math still uses the chain-wide
          average. Inspect the clusters below; once they look right, we'll
          flip the IBT engine to use cluster averages in Phase 2.
        </p>
      </div>

      <div className="card-white p-4 sm:p-5" data-testid="cluster-controls">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={recluster}
            disabled={reclustering}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-white bg-[#1a5c38] hover:bg-[#0f3d24] disabled:opacity-50 px-3 py-2 rounded-md"
            data-testid="cluster-recluster-btn"
          >
            <ArrowsClockwise size={13} weight={reclustering ? "regular" : "bold"} className={reclustering ? "animate-spin" : ""} />
            {reclustering ? "Re-clustering…" : "Re-cluster now"}
          </button>
          <label className="inline-flex items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={useYear}
              onChange={(e) => setUseYear(e.target.checked)}
              className="accent-brand"
              data-testid="cluster-use-year"
            />
            Use 12-month window for tier (slower)
          </label>
          {data?.computed_at && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-muted ml-auto">
              <Calendar size={12} /> Last run: {new Date(data.computed_at).toLocaleString("en-KE")}
              {data.tier_window && <b className="ml-2 text-foreground">tier window: {data.tier_window}</b>}
            </span>
          )}
        </div>
      </div>

      {loading && <Loading label="Loading clusters…" />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && data?.ok === false && (
        <Empty label="No cluster run yet — click 'Re-cluster now' to compute the first one." />
      )}

      {!loading && !error && data?.clusters && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="cluster-grid">
          {Object.entries(data.clusters).map(([cid, meta]) => (
            <div key={cid} className="card-white p-4 border-l-4" style={{ borderColor: tierColor(meta.tier) }}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-extrabold text-[18px] text-foreground inline-flex items-center gap-2">
                  <Stack size={16} weight="duotone" className="text-brand-deep" /> {cid}
                </span>
                <span className="text-[11px] font-semibold text-muted">
                  Tier {meta.tier} · {meta.size} stores
                </span>
              </div>
              <div className="text-[11.5px] text-foreground/90 mb-2 leading-relaxed">
                {meta.explainer}
              </div>
              <div className="text-[11px] text-muted mb-1 font-semibold uppercase tracking-wide">Members</div>
              <ul className="space-y-0.5 text-[12px]" data-testid={`cluster-members-${cid}`}>
                {meta.members.map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-brand inline-block"></span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && data?.by_store && (
        <div className="card-white p-4 sm:p-5" data-testid="cluster-store-table">
          <SectionTitle
            title="Per-store features"
            subtitle="The 6 normalised features feeding the within-tier k-means. Hover any feature value to compare against the cluster centroid."
          />
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full text-[12.5px]">
              <thead className="bg-panel">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Store</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Tier</th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">Cluster</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">ASP</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Basket</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Size CoG</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">% Tops</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">% Bottoms</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">% Acc</th>
                  <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">90d Rev</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.by_store).sort((a, b) => (a[1].cluster_id || "").localeCompare(b[1].cluster_id || "")).map(([store, row], i) => (
                  <tr key={store} className={`border-t border-border/50 ${i % 2 === 0 ? "bg-white" : "bg-panel/30"}`}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{store}</td>
                    <td className="px-3 py-2"><span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-white" style={{ background: tierColor(row.tier) }}>{row.tier}</span></td>
                    <td className="px-3 py-2 font-mono">{row.cluster_id || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">KES {Math.round(row.asp || 0).toLocaleString("en-KE")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(row.avg_basket_units || 0).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{(row.size_cog || 0).toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round((row.pct_tops || 0) * 100)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round((row.pct_bottoms || 0) * 100)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round((row.pct_accessories || 0) * 100)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Math.round((row.revenue_90d || 0) / 1000).toLocaleString("en-KE")}K</td>
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

const tierColor = (t) => t === "A" ? "#0f3d24" : t === "B" ? "#1a5c38" : "#9c6c2e";

export default StoreClusters;
