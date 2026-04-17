import React from "react";
import { CircleNotch } from "@phosphor-icons/react";

export const Loading = ({ label = "Loading data…" }) => (
  <div className="flex items-center gap-2 text-muted-foreground text-sm py-10 justify-center" data-testid="loading">
    <CircleNotch className="animate-spin" size={18} />
    <span>{label}</span>
  </div>
);

export const ErrorBox = ({ message }) => (
  <div
    className="card-surface p-4 text-sm text-destructive border-destructive/30 bg-destructive/5"
    data-testid="error-box"
  >
    {message || "Something went wrong."}
  </div>
);

export const Empty = ({ label = "No data for the selected filters." }) => (
  <div className="text-muted-foreground text-sm py-10 text-center" data-testid="empty">
    {label}
  </div>
);

export const SectionTitle = ({ title, subtitle, action, testId }) => (
  <div className="flex items-end justify-between gap-4 mb-4" data-testid={testId}>
    <div>
      <h2 className="font-display font-bold text-xl tracking-tight">{title}</h2>
      {subtitle && (
        <p className="text-muted-foreground text-sm mt-0.5">{subtitle}</p>
      )}
    </div>
    {action}
  </div>
);
