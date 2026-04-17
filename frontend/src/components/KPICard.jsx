import React from "react";

export const KPICard = ({
  label,
  value,
  delta,
  sub,
  icon: Icon,
  tone = "default",
  testId,
}) => {
  const toneClasses =
    tone === "primary"
      ? "bg-primary text-primary-foreground border-primary/20"
      : tone === "dark"
      ? "bg-secondary text-secondary-foreground border-secondary/20"
      : "card-surface";
  const labelColor =
    tone === "primary" || tone === "dark"
      ? "text-white/70"
      : "text-muted-foreground";

  return (
    <div
      className={`${toneClasses} p-5 hover-lift fade-in`}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`eyebrow ${labelColor}`}>{label}</div>
        {Icon && (
          <Icon
            size={20}
            weight="duotone"
            className={
              tone === "primary" || tone === "dark"
                ? "text-white/80"
                : "text-primary"
            }
          />
        )}
      </div>
      <div className="mt-5 kpi-number text-[34px] md:text-[40px]" data-testid={`${testId}-value`}>
        {value}
      </div>
      {(delta || sub) && (
        <div
          className={`mt-2 text-[12px] font-medium ${labelColor}`}
          data-testid={`${testId}-sub`}
        >
          {delta && (
            <span
              className={
                (tone === "primary" || tone === "dark"
                  ? "text-white "
                  : "text-secondary ") + " mr-2"
              }
            >
              {delta}
            </span>
          )}
          {sub}
        </div>
      )}
    </div>
  );
};

export default KPICard;
