import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, fmtNum } from "@/lib/api";
import { Loading, Empty, ErrorBox, SectionTitle } from "@/components/common";
import { Truck, CaretDown, CaretRight, FloppyDisk, ArrowCounterClockwise } from "@phosphor-icons/react";

/**
 * Pending Warehouse Fulfilment queue — shows every saved allocation
 * run with status="pending_fulfilment". Each row expands to a per-
 * store table where the warehouse team types in the actual units
 * shipped per size. Confirm flips the run to "fulfilled" and it
 * disappears from this queue (it'll re-appear in the Recent
 * Allocations table further down the page).
 */
const AllocationPendingQueue = ({ refreshKey, onFulfilled, optimisticRun }) => {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  // editsByRun = { runId: { storeName: { sizeKey: actualUnits } } }
  const [editsByRun, setEditsByRun] = useState({});
  const [savingId, setSavingId] = useState(null);
  // Synchronous guard — set BEFORE the async PATCH so a double-click
  // (which can fire two events in the ~16ms before React paints the
  // disabled prop) can't slip through and produce a duplicate request.
  const inflightRef = useRef(new Set());

  // Optimistic prepend: parent passes the just-saved doc so the row
  // appears instantly without waiting for the GET round-trip.
  useEffect(() => {
    if (!optimisticRun || optimisticRun.status !== "pending_fulfilment") return;
    setRuns((prev) => {
      if (prev.some((r) => r.id === optimisticRun.id)) return prev;
      return [optimisticRun, ...prev];
    });
  }, [optimisticRun]);

  const load = () => {
    setLoading(true);
    setError(null);
    api.get("/allocations/runs", { params: { status: "pending_fulfilment" }, timeout: 30000 })
      .then((r) => {
        const fetched = r.data || [];
        // Merge — keep optimistic if not yet returned by GET.
        if (optimisticRun && optimisticRun.status === "pending_fulfilment"
            && !fetched.some((x) => x.id === optimisticRun.id)) {
          setRuns([optimisticRun, ...fetched]);
        } else {
          setRuns(fetched);
        }
      })
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey]);

  const setSizeEdit = (runId, store, sizeKey, val) => {
    setEditsByRun((prev) => {
      const next = { ...prev };
      const runMap = { ...(next[runId] || {}) };
      const storeMap = { ...(runMap[store] || {}) };
      if (val === "" || val == null) delete storeMap[sizeKey];
      else storeMap[sizeKey] = val;
      runMap[store] = storeMap;
      next[runId] = runMap;
      return next;
    });
  };

  const resetEdits = (runId) => {
    setEditsByRun((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
  };

  const buildFulfilPayload = (run) => {
    const overrides = editsByRun[run.id] || {};
    return run.rows.map((r) => {
      const storeOverride = overrides[r.store] || {};
      // Default to buying_sizes (already-mirrored on save) so the
      // warehouse can confirm "ship as planned" with zero edits.
      const buying = r.buying_sizes || r.sizes || {};
      const sizes = {};
      Object.keys(buying).forEach((sz) => {
        const overridden = storeOverride[sz];
        sizes[sz] = overridden === undefined || overridden === ""
          ? Number(buying[sz] || 0)
          : Math.max(0, parseInt(overridden, 10) || 0);
      });
      return { store: r.store, sizes };
    });
  };

  const computedPreview = (run) => {
    const payload = buildFulfilPayload(run);
    const total = payload.reduce(
      (s, r) => s + Object.values(r.sizes).reduce((a, b) => a + Number(b || 0), 0),
      0,
    );
    return { rows: payload, total };
  };

  const confirmFulfil = async (run) => {
    // Synchronous in-flight guard: rejects the second click if the
    // first PATCH for this run hasn't resolved yet.
    if (inflightRef.current.has(run.id)) return;
    inflightRef.current.add(run.id);
    const payload = buildFulfilPayload(run);
    setSavingId(run.id);
    try {
      await api.patch(`/allocations/runs/${run.id}/fulfil`, { rows: payload });
      // Remove from the local pending list immediately and refresh the
      // history table further down.
      setRuns((prev) => prev.filter((x) => x.id !== run.id));
      resetEdits(run.id);
      onFulfilled?.();
    } catch (e) {
      const detail = e?.response?.data?.detail || e.message || "Failed to confirm";
      // "Run already fulfilled" means the desired state is already
      // achieved on the server (almost always a duplicate click from a
      // prior session / tab). Treat as a benign no-op: drop the row
      // from the pending queue and refresh history, no scary alert.
      if (e?.response?.status === 400 && /already fulfilled/i.test(detail)) {
        setRuns((prev) => prev.filter((x) => x.id !== run.id));
        resetEdits(run.id);
        onFulfilled?.();
      } else {
        alert(detail);
      }
    } finally {
      inflightRef.current.delete(run.id);
      setSavingId(null);
    }
  };

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [runs]
  );

  if (loading) return <div className="card-white p-5"><Loading label="Loading pending fulfilment…" /></div>;
  if (error) return <div className="card-white p-5"><ErrorBox message={error} /></div>;
  if (sortedRuns.length === 0) return null; // hide section entirely when empty

  return (
    <div className="card-white p-5 border-l-4 border-l-amber-400 bg-amber-50/30" data-testid="allocation-pending-queue">
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Truck size={16} weight="duotone" className="text-amber-700" />
            Step 2 · Pending Warehouse Fulfilment
            <span className="text-[10.5px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
              {sortedRuns.length} pending
            </span>
          </span>
        }
        subtitle="Allocations the buying team has sent. Click a row, fill in actual units shipped per store + size, then confirm — that locks the audit trail."
      />

      <ul className="space-y-2.5">
        {sortedRuns.map((run) => {
          const open = expandedId === run.id;
          const sizeKeys = Object.keys(run.pack_breakdown || {});
          const preview = computedPreview(run);
          const buyingTotal = run.suggested_total || 0;
          const variance = preview.total - buyingTotal;
          return (
            <li key={run.id} className="bg-white border border-amber-300 rounded-lg overflow-hidden" data-testid={`alloc-pending-${run.id}`}>
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : run.id)}
                className="w-full flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-amber-50/50 text-left"
              >
                {open ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold text-[13px] text-foreground" style={{ whiteSpace: "normal", wordBreak: "break-word" }}>
                    {run.style_name}
                    {run.color && (
                      <span className="ml-2 text-[10.5px] font-bold uppercase tracking-wide bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                        {run.color}
                      </span>
                    )}
                    <span className={`ml-2 text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      run.allocation_type === "replenishment" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"
                    }`}>
                      {run.allocation_type}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted">
                    {run.subcategory} · {run.rows?.length || 0} stores · sent by {run.created_by_name || run.created_by_email} ·{" "}
                    {(run.created_at || "").slice(0, 16).replace("T", " ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10.5px] text-muted">Buying / Actual</div>
                  <div className="text-[13px] font-bold tabular-nums">
                    {fmtNum(buyingTotal)} <span className="text-muted">/</span>{" "}
                    <span className={variance === 0 ? "text-emerald-700" : variance > 0 ? "text-amber-700" : "text-rose-700"}>
                      {fmtNum(preview.total)}
                    </span>
                  </div>
                </div>
              </button>
              {open && (
                <div className="border-t border-amber-200 bg-amber-50/30 p-4 space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11.5px]">
                      <thead>
                        <tr className="bg-white text-muted">
                          <th className="text-left px-2 py-1">Store</th>
                          <th className="text-right px-2 py-1">Buying total</th>
                          {sizeKeys.map((sz) => (
                            <th key={sz} className="text-right px-2 py-1" colSpan={2}>{sz}</th>
                          ))}
                          <th className="text-right px-2 py-1 bg-emerald-50">Actual total</th>
                        </tr>
                        <tr className="bg-white text-[10.5px] text-muted">
                          <th></th>
                          <th></th>
                          {sizeKeys.map((sz) => (
                            <React.Fragment key={sz}>
                              <th className="text-right px-2 pb-1">Plan</th>
                              <th className="text-right px-2 pb-1 bg-amber-50">Actual</th>
                            </React.Fragment>
                          ))}
                          <th className="bg-emerald-50"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(run.rows || []).map((r) => {
                          const storeOverrides = (editsByRun[run.id] || {})[r.store] || {};
                          const buying = r.buying_sizes || r.sizes || {};
                          // Per-row actual total computed from current edits.
                          const actualTotal = sizeKeys.reduce((acc, sz) => {
                            const ov = storeOverrides[sz];
                            const v = ov === undefined || ov === ""
                              ? Number(buying[sz] || 0)
                              : Math.max(0, parseInt(ov, 10) || 0);
                            return acc + v;
                          }, 0);
                          const buyingTotal = Number(r.buying_units || r.allocated_units || 0);
                          return (
                            <tr key={r.store} className="border-b border-amber-100 hover:bg-white" data-testid={`alloc-pending-store-${r.store}`}>
                              <td className="px-2 py-1.5 font-medium">{r.store}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted">{fmtNum(buyingTotal)}</td>
                              {sizeKeys.map((sz) => {
                                const planVal = Number(buying[sz] || 0);
                                const ov = storeOverrides[sz];
                                return (
                                  <React.Fragment key={sz}>
                                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{fmtNum(planVal)}</td>
                                    <td className="px-2 py-1.5 text-right tabular-nums bg-amber-50/60">
                                      <input
                                        type="number"
                                        min={0}
                                        value={ov ?? planVal}
                                        onChange={(e) => setSizeEdit(run.id, r.store, sz, e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        className={`w-14 px-1 py-0.5 text-right text-[11.5px] tabular-nums border rounded ${
                                          ov !== undefined && ov !== "" && Number(ov) !== planVal
                                            ? "bg-amber-100 border-amber-400 text-amber-900 font-bold"
                                            : "bg-white border-border"
                                        }`}
                                        data-testid={`alloc-pending-size-${run.id}-${r.store}-${sz}`}
                                      />
                                    </td>
                                  </React.Fragment>
                                );
                              })}
                              <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${
                                actualTotal === buyingTotal ? "text-emerald-700" : actualTotal > buyingTotal ? "text-amber-700" : "text-rose-700"
                              } bg-emerald-50/40`}>
                                {fmtNum(actualTotal)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2">
                    {Object.keys(editsByRun[run.id] || {}).length > 0 && (
                      <button
                        type="button"
                        onClick={() => resetEdits(run.id)}
                        className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700 border border-amber-300 hover:bg-amber-50 px-2.5 py-1.5 rounded-md"
                        data-testid={`alloc-pending-reset-${run.id}`}
                      >
                        <ArrowCounterClockwise size={11} weight="bold" /> Reset to plan
                      </button>
                    )}
                    <span className="text-[11px] text-muted">
                      Variance: <b className={variance === 0 ? "text-emerald-700" : variance > 0 ? "text-amber-700" : "text-rose-700"}>
                        {variance > 0 ? "+" : ""}{variance} units
                      </b>
                    </span>
                    <button
                      type="button"
                      onClick={() => confirmFulfil(run)}
                      disabled={savingId === run.id}
                      className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 rounded-md disabled:opacity-50"
                      data-testid={`alloc-pending-confirm-${run.id}`}
                    >
                      <FloppyDisk size={12} weight="bold" /> {savingId === run.id ? "Confirming…" : "Confirm fulfilment"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AllocationPendingQueue;
