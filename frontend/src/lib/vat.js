// VAT rates per country. Default/inherited from CFO-confirmed spec.
//   Kenya = 16%, Uganda = 18%, Rwanda = 18%. All KPIs from upstream are
//   EXCLUSIVE of VAT (net-of-VAT). Toggle switches between excl / incl.
export const VAT_RATES = {
  Kenya: 0.16,
  Uganda: 0.18,
  Rwanda: 0.18,
  // Online & cross-border default to KE rate (business rule: online store
  // invoices under the Kenyan entity).
  Online: 0.16,
  Other: 0.16,
};

// Human-readable suffix shown below every money tile.
export const vatSuffix = (mode) => (mode === "incl" ? "incl. VAT" : "excl. VAT");

/**
 * Compute the group-weighted effective VAT rate given the active country
 * mix. `countryMix` is a list of `{country, total_sales}` rows. Returns a
 * decimal (e.g. 0.163 for a Kenya/Uganda mix).
 */
export function effectiveVatRate(countryMix) {
  if (!Array.isArray(countryMix) || countryMix.length === 0) return VAT_RATES.Kenya;
  let total = 0;
  let weighted = 0;
  for (const r of countryMix) {
    const amt = Number(r.total_sales || 0);
    const rate = VAT_RATES[r.country] ?? VAT_RATES.Other;
    total += amt;
    weighted += amt * rate;
  }
  return total > 0 ? weighted / total : VAT_RATES.Kenya;
}

/**
 * Adjust a monetary value. `mode` is "excl" (default) or "incl".
 * - "excl" returns the value unchanged.
 * - "incl" multiplies by (1 + effective rate).
 * `countryMix` is required for correct per-country aggregation; otherwise
 * the caller can pass a single-country rate via `singleRate`.
 */
export function applyVat(value, mode, { countryMix = null, singleRate = null } = {}) {
  if (mode !== "incl") return Number(value || 0);
  const rate = singleRate != null ? Number(singleRate) : effectiveVatRate(countryMix);
  return Number(value || 0) * (1 + rate);
}

/**
 * Build a per-country set of VAT-adjusted totals without blending.
 * Use this on any chart/table that shows per-country / per-subcategory
 * rows so each row uses its own country rate.
 */
export function applyVatPerRow(rows, mode, { countryKey = "country" } = {}) {
  if (mode !== "incl") return rows;
  return rows.map((r) => {
    const country = r[countryKey];
    const rate = VAT_RATES[country] ?? VAT_RATES.Other;
    const out = { ...r };
    for (const k of ["total_sales", "gross_sales", "net_sales", "total_returns", "avg_basket_size", "avg_selling_price"]) {
      if (typeof r[k] === "number") out[k] = r[k] * (1 + rate);
    }
    return out;
  });
}

export const VAT_GLOSSARY = {
  title: "VAT (Value-Added Tax)",
  default: "Net of VAT (CFO-confirmed).",
  rates: "Kenya 16% · Uganda 18% · Rwanda 18%.",
  computation: "incl. VAT = excl. VAT × (1 + rate). Aggregations use the per-country rate on a per-row basis — not a single blended rate.",
};
