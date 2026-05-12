import React from "react";

const TIER_LABELS = {
  vip: "VIP",
  loyal: "Loyal",
  promising: "Promising",
  at_risk: "At-risk",
  churned: "Churned",
  new: "New",
};

export function RfmBadge({ tier, className = "" }) {
  if (!tier) return null;
  const label = TIER_LABELS[tier] || tier;
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-md font-semibold tier-${tier} ${className}`}
      data-testid={`rfm-badge`}
      data-tier={tier}
    >
      {label}
    </span>
  );
}
