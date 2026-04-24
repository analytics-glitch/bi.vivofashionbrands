import React from "react";

/**
 * Business-action variance classifier for product-level stock-to-sales
 * comparisons. Invoked by Inventory, Products, Re-Order, IBT, CEO Report —
 * anywhere "sales share vs stock share" is shown.
 *
 * Mapping (inverted from raw math to call-to-action):
 *   |v| ≤ 2 pp                         → GREEN  (healthy balance)
 *   2 < |v| ≤ 5, v > 0                 → AMBER  (watch — stockout watch)
 *   2 < |v| ≤ 5, v < 0                 → AMBER  (watch — overstock watch)
 *   |v| > 5,     v > 0                 → RED    (stockout risk — re-order)
 *   |v| > 5,     v < 0                 → RED    (overstock risk — markdown / IBT)
 *
 * Thresholds are intentionally simple (pp, symmetric); tune VAR_GREEN /
 * VAR_AMBER if the merchandising team re-calibrates. Icons are rendered
 * alongside color so colorblind readers get the same signal.
 */
export const VAR_GREEN = 2;
export const VAR_AMBER = 5;

export const varianceStyle = (v) => {
  if (v == null || isNaN(v))
    return { cls: "pill-neutral", icon: "", flag: "Unknown", tip: "No variance data" };
  const abs = Math.abs(v);
  if (abs <= VAR_GREEN)
    return { cls: "pill-green", icon: "✅", flag: "Healthy", tip: "Stock and sales in balance." };
  if (abs <= VAR_AMBER) {
    if (v > 0)
      return { cls: "pill-amber", icon: "⚠️", flag: "Monitor (Stockout watch)", tip: "Sales slightly ahead of stock — monitor, plan re-order." };
    return { cls: "pill-amber", icon: "⚠️", flag: "Monitor (Overstock watch)", tip: "Stock slightly ahead of sales — monitor, plan promotions." };
  }
  if (v > 0)
    return { cls: "pill-red", icon: "🔴", flag: "Stockout Risk", tip: "Sales outpacing stock — stockout risk. Review re-order urgently." };
  return { cls: "pill-red", icon: "🔴", flag: "Overstock Risk", tip: "Stock outpacing sales — overstock risk. Review markdowns or IBT." };
};

export const VarianceCell = ({ value, suffix = "%" }) => {
  const { cls, icon, tip, flag } = varianceStyle(value);
  return (
    <span
      className={`${cls} inline-flex items-center gap-1`}
      title={tip}
      data-variance-flag={flag}
    >
      <span aria-hidden="true">{icon}</span>
      {value >= 0 ? "+" : ""}
      {(value || 0).toFixed(2)}
      {suffix}
    </span>
  );
};

export const varianceFlag = (v) => varianceStyle(v).flag;
