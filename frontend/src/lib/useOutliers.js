/**
 * useOutliers — reusable data-quality outlier detector.
 *
 * The kernel we shipped for Footfall (2σ bands over the group mean +
 * structural belts-and-braces caps) generalised into a tiny hook so any
 * table on the platform can self-check.
 *
 * A "flag" is an object the row carries forward: { kind, reason, severity }
 *   kind     — "hi" | "lo"            (high-side or low-side outlier)
 *   reason   — plain-language string  (tooltip-ready)
 *   severity — "warn" | "severe"      (warn = just outside band · severe = hard-cap hit)
 *
 * Usage:
 *   const { enriched, stats, count } = useOutliers(rows, {
 *     valueKey: "conversion_rate",
 *     filter:   (r) => r.physical !== false && (r.total_footfall || 0) >= 200,
 *     hardHi:   { at: 50, reason: "Unusually high CR (≥50%) — counter miscalibration?" },
 *     hardLo:   { at: 1,  reason: "Unusually low CR (<1%) — counter may be over-counting?" },
 *     label:    "CR",   // used in auto-generated reasons ("Above 2σ of group avg …")
 *     valueFmt: (v) => `${v.toFixed(1)}%`,
 *     sigmas:   2,      // optional — defaults to 2
 *     minSample: 4,     // optional — group below this → no flags (signal too noisy)
 *   });
 *
 * Design choices:
 *   - Runs on already-fetched frontend rows (no new API). Our biggest
 *     pages have ≤ 60 rows — a single-pass mean/sd is ≈ microseconds.
 *   - Hard caps override band logic (a 500% CR is always a hard-hi,
 *     even if the group sd is somehow also 500%).
 *   - `filter` is the caller's responsibility: only physical stores for
 *     conversion, only populated rows for returns, etc. Keeps the hook
 *     dumb and the callers explicit.
 *   - Skipped rows (failing `filter`) still get returned in `enriched`
 *     but with `outlier=null`, so the hook is a drop-in replacement.
 */
import { useMemo } from "react";

const defaultNum = (r, key) => {
  const v = r?.[key];
  return typeof v === "number" && isFinite(v) ? v : 0;
};

export const useOutliers = (rows, opts = {}) => {
  const {
    valueKey,
    valueGet,             // alternative to valueKey — custom getter
    filter = () => true,  // include in sample?
    hardHi = null,        // { at: number, reason: string }
    hardLo = null,        // { at: number, reason: string }
    label = "value",
    valueFmt = (v) => `${Number(v).toFixed(1)}`,
    sigmas = 2,
    minSample = 4,
    outputKey = "outlier",
  } = opts;

  return useMemo(() => {
    const get = valueGet || ((r) => defaultNum(r, valueKey));
    const all = Array.isArray(rows) ? rows : [];
    const sample = all.filter(filter);
    const vals = sample.map(get).filter((v) => isFinite(v));

    let mean = 0, sd = 0, hiCut = Infinity, loCut = -Infinity;
    if (vals.length >= minSample) {
      mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      sd = Math.sqrt(variance);
      if (sd > 0) {
        hiCut = mean + sigmas * sd;
        loCut = mean - sigmas * sd;
      }
    }

    const sampleIds = new Set(sample);  // quick membership check by object ref
    const enriched = all.map((r) => {
      // Rows outside the filter never flag — by design.
      if (!sampleIds.has(r)) return { ...r, [outputKey]: null };
      const v = get(r);
      let flag = null;

      // Hard caps first — they're structural judgements, not statistical.
      if (hardHi && v >= hardHi.at) {
        flag = { kind: "hi", severity: "severe", reason: hardHi.reason };
      } else if (hardLo && v > 0 && v < hardLo.at) {
        flag = { kind: "lo", severity: "severe", reason: hardLo.reason };
      } else if (v > hiCut) {
        flag = {
          kind: "hi", severity: "warn",
          reason: `Above ${sigmas}σ of group avg (${valueFmt(mean)}) — verify the ${label} source.`,
        };
      } else if (v > 0 && v < loCut) {
        flag = {
          kind: "lo", severity: "warn",
          reason: `Below ${sigmas}σ of group avg (${valueFmt(mean)}) — verify the ${label} source.`,
        };
      }

      return { ...r, [outputKey]: flag };
    });

    const count = enriched.filter((r) => r[outputKey]).length;
    return {
      enriched,
      stats: { mean, sd, hiCut, loCut, sampleSize: vals.length },
      count,
    };
  }, [rows, valueKey, valueGet, filter, hardHi, hardLo, label, valueFmt, sigmas, minSample, outputKey]);
};

export default useOutliers;
