import React from "react";

/**
 * Shared label for every SOR column header with an ⓘ tooltip explaining
 * the definition:
 *   SOR = units_sold_period ÷ (units_sold_period + current_stock)
 *
 * Use as a React node in SortableTable's `label` or as a plain JSX child
 * inside a <th>.
 */
export const SORHeader = ({ children = "SOR" }) => (
  <span
    className="inline-flex items-center gap-1"
    title={
      "Sell-Out Rate (SOR) = units_sold_in_period ÷ (units_sold_in_period + current_stock)\n\n" +
      "High SOR (>60%) → stock is selling faster than it's being replenished (consider re-order).\n" +
      "Low SOR (<30%) → stock is sitting (consider promotion, markdown or transfer)."
    }
  >
    {children}{" "}
    <span className="text-muted cursor-help text-[10px]" aria-hidden="true">ⓘ</span>
  </span>
);

export default SORHeader;
