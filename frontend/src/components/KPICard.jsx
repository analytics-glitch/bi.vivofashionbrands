import React from "react";

export const KPICard = ({ label, value, sub, icon: Icon, testId, accent = false }) => {
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
            className={accent ? "text-brand-strong" : "text-muted"}
          />
        )}
      </div>
      <div
        className="mt-4 kpi-value text-[26px] md:text-[30px] truncate"
        title={typeof value === "string" ? value : undefined}
        data-testid={`${testId}-value`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1.5 text-[12px] text-muted" data-testid={`${testId}-sub`}>
          {sub}
        </div>
      )}
    </div>
  );
};

export const HighlightCard = ({ label, name, amount, icon: Icon, testId }) => (
  <div className="card-accent p-5 hover-lift fade-in" data-testid={testId}>
    <div className="flex items-start justify-between gap-4">
      <div className="eyebrow text-brand-strong/90">{label}</div>
      {Icon && <Icon size={18} weight="duotone" className="text-brand-strong" />}
    </div>
    <div
      className="mt-3 kpi-value text-[20px] md:text-[22px] truncate"
      title={name}
      data-testid={`${testId}-name`}
    >
      {name || "—"}
    </div>
    <div className="mt-1.5 text-[13px] font-semibold text-brand-strong" data-testid={`${testId}-amount`}>
      {amount}
    </div>
  </div>
);

export default KPICard;
