import React from "react";
import { fmtDelta } from "@/lib/api";

const DeltaBadge = ({ delta, higherIsBetter = true, label, accent = false }) => {
  if (delta === null || delta === undefined) {
    return (
      <span className="text-[11.5px] delta-flat" data-testid="delta-na">
        {label && <span className="text-muted mr-1">{label}</span>}— n/a
      </span>
    );
  }
  const pos = delta > 0.05;
  const neg = delta < -0.05;
  const good = higherIsBetter ? pos : neg;
  const bad = higherIsBetter ? neg : pos;
  const cls = good ? "delta-up" : bad ? "delta-down" : "delta-flat";
  const arrow = pos ? "▲" : neg ? "▼" : "◆";
  const onAccent = accent
    ? pos
      ? "text-brand-strong"
      : neg
      ? "text-[#ffb4b4]"
      : "text-white/80"
    : "";
  return (
    <span className={`text-[11.5px] font-semibold ${accent ? onAccent : cls}`}>
      {label && (
        <span className={`${accent ? "text-white/60" : "text-muted"} mr-1 font-normal`}>
          {label}
        </span>
      )}
      {arrow} {fmtDelta(Math.abs(delta) * (delta < 0 ? -1 : 1))}
    </span>
  );
};

export const KPICard = ({
  label,
  value,
  sub,
  icon: Icon,
  testId,
  accent = false,
  small = false,
  delta = null,
  deltaLabel = null,
  higherIsBetter = true,
  showDelta = true,
}) => {
  return (
    <div
      className={`${accent ? "card-accent" : "card-white"} ${small ? "p-4" : "p-5"} hover-lift fade-in`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="eyebrow">{label}</div>
        {Icon && (
          <Icon
            size={15}
            weight="duotone"
            className={accent ? "text-white/70" : "text-muted"}
          />
        )}
      </div>
      <div
        className={`mt-3 kpi-value num ${small ? "text-[20px]" : "text-[24px] md:text-[28px]"} truncate`}
        title={typeof value === "string" ? value : undefined}
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      {sub && (
        <div
          className={`mt-1 text-[11px] ${accent ? "text-white/60" : "text-muted"}`}
        >
          {sub}
        </div>
      )}
      {showDelta && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <DeltaBadge
            delta={delta}
            higherIsBetter={higherIsBetter}
            label={deltaLabel}
            accent={accent}
          />
        </div>
      )}
    </div>
  );
};

export const HighlightCard = ({ label, name, amount, icon: Icon, testId }) => (
  <div
    className="card-accent p-5 hover-lift fade-in flex items-center gap-4"
    data-testid={testId}
  >
    <div className="w-10 h-10 rounded-xl bg-white/15 grid place-items-center">
      {Icon && <Icon size={20} weight="duotone" className="text-white" />}
    </div>
    <div className="min-w-0 flex-1">
      <div className="eyebrow text-white/60">{label}</div>
      <div
        className="mt-0.5 font-bold text-[18px] text-white truncate"
        title={name}
        data-testid={`${testId}-name`}
      >
        {name || "—"}
      </div>
      <div className="text-[12.5px] font-semibold text-brand-strong">
        {amount}
      </div>
    </div>
  </div>
);

export default KPICard;
