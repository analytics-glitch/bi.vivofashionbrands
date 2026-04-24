import React from "react";
import { Info } from "@phosphor-icons/react";
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
  // NEW — docs/formula tooltips on top right (ⓘ icon). Hover shows the
  // formula verbatim; the whole card also carries the formula as a native
  // tooltip (`title`) so users can read it anywhere.
  formula = null,
  // NEW — small muted suffix UNDER the value, e.g. "excl. VAT".
  suffix = null,
  // NEW — optional previous-period value (formatted string). When supplied,
  // appears below the delta as muted context e.g. "vs KES 2,187,340 last month".
  // Auto-hides on < sm screens.
  prevValue = null,
}) => {
  const titleTip = formula || (typeof value === "string" ? value : undefined);
  return (
    <div
      className={`${accent ? "card-accent" : "card-white"} ${small ? "p-3 sm:p-4" : "p-3.5 sm:p-5"} hover-lift fade-in`}
      data-testid={testId}
      title={titleTip}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="eyebrow flex items-center gap-1">
          <span>{label}</span>
          {formula && (
            <Info
              size={11}
              weight="bold"
              className={`${accent ? "text-white/60" : "text-muted"} cursor-help`}
              data-testid={`${testId}-info`}
            />
          )}
        </div>
        {Icon && (
          <Icon
            size={15}
            weight="duotone"
            className={accent ? "text-white/70" : "text-muted"}
          />
        )}
      </div>
      <div
        className={`mt-3 kpi-value num ${small ? "text-[16px] sm:text-[20px]" : "text-[18px] sm:text-[22px] md:text-[28px]"} break-words leading-tight`}
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      {suffix && (
        <div
          className={`mt-0.5 text-[10.5px] font-medium tracking-wide ${accent ? "text-white/55" : "text-muted/70"}`}
          data-testid={`${testId}-suffix`}
        >
          {suffix}
        </div>
      )}
      {sub && (
        <div
          className={`mt-1 text-[11px] ${accent ? "text-white/60" : "text-muted"}`}
        >
          {sub}
        </div>
      )}
      {showDelta && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <DeltaBadge
            delta={delta}
            higherIsBetter={higherIsBetter}
            label={deltaLabel}
            accent={accent}
          />
          {prevValue != null && delta != null && (
            <span
              className={`text-[11px] ${accent ? "text-white/55" : "text-muted/80"} hidden sm:inline`}
              data-testid={`${testId}-prev`}
            >
              vs {prevValue}
            </span>
          )}
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
