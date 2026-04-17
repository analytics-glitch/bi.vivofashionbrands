import React from "react";
import { fmtDelta } from "@/lib/api";

const DeltaRow = ({ label, delta, higherIsBetter = true }) => {
  if (delta === null || delta === undefined) {
    return (
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted">{label}</span>
        <span className="delta-flat">— n/a</span>
      </div>
    );
  }
  const isPositive = delta > 0.05;
  const isNegative = delta < -0.05;
  const good = higherIsBetter ? isPositive : isNegative;
  const bad = higherIsBetter ? isNegative : isPositive;
  const cls = good ? "delta-up" : bad ? "delta-down" : "delta-flat";
  const arrow = isPositive ? "▲" : isNegative ? "▼" : "◆";
  return (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="text-muted">{label}</span>
      <span className={cls}>
        {arrow} {fmtDelta(Math.abs(delta) * (delta < 0 ? -1 : 1))}
      </span>
    </div>
  );
};

export const KPICard = ({
  label,
  value,
  sub,
  icon: Icon,
  testId,
  accent = false,
  deltaMoM = null,
  deltaYoY = null,
  higherIsBetter = true,
  showDeltas = true,
}) => {
  return (
    <div
      className={`${accent ? "card-accent" : "card"} p-5 hover-lift fade-in`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="eyebrow">{label}</div>
        {Icon && (
          <Icon
            size={18}
            weight="duotone"
            className={accent ? "text-brand-deep" : "text-muted"}
          />
        )}
      </div>
      <div
        className="mt-3 kpi-value text-[24px] md:text-[28px] truncate"
        title={typeof value === "string" ? value : undefined}
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-[11px] text-muted" data-testid={`${testId}-sub`}>
          {sub}
        </div>
      )}
      {showDeltas && (
        <div
          className="mt-3 pt-3 border-t border-border space-y-1"
          data-testid={`${testId}-deltas`}
        >
          <DeltaRow label="vs last month" delta={deltaMoM} higherIsBetter={higherIsBetter} />
          <DeltaRow label="vs last year" delta={deltaYoY} higherIsBetter={higherIsBetter} />
        </div>
      )}
    </div>
  );
};

export const HighlightCard = ({ label, name, amount, icon: Icon, testId }) => (
  <div className="card-accent p-5 hover-lift fade-in" data-testid={testId}>
    <div className="flex items-start justify-between gap-4">
      <div className="eyebrow text-brand-deep">{label}</div>
      {Icon && <Icon size={18} weight="duotone" className="text-brand-deep" />}
    </div>
    <div
      className="mt-3 kpi-value text-[20px] md:text-[22px] truncate"
      title={name}
      data-testid={`${testId}-name`}
    >
      {name || "—"}
    </div>
    <div
      className="mt-1.5 text-[13px] font-bold text-brand-deep"
      data-testid={`${testId}-amount`}
    >
      {amount}
    </div>
  </div>
);

export default KPICard;
