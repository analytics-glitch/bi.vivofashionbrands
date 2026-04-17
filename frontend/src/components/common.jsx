import React from "react";
import { CircleNotch } from "@phosphor-icons/react";

export const Loading = ({ label = "Loading…" }) => (
  <div
    className="flex items-center gap-2 text-muted text-sm py-10 justify-center"
    data-testid="loading"
  >
    <CircleNotch className="animate-spin" size={18} />
    <span>{label}</span>
  </div>
);

export const ErrorBox = ({ message }) => (
  <div
    className="card p-4 text-sm text-danger border border-danger/40 bg-danger/5"
    data-testid="error-box"
  >
    {message || "Something went wrong."}
  </div>
);

export const Empty = ({ label = "No data for the selected filters." }) => (
  <div className="text-muted text-sm py-10 text-center" data-testid="empty">
    {label}
  </div>
);

export const SectionTitle = ({ title, subtitle, action, testId }) => (
  <div
    className="flex items-start justify-between gap-4 mb-4 flex-wrap"
    data-testid={testId}
  >
    <div>
      <h2 className="font-sans font-bold text-[17px] tracking-tight text-foreground">
        {title}
      </h2>
      {subtitle && <p className="text-muted text-[12.5px] mt-0.5">{subtitle}</p>}
    </div>
    {action}
  </div>
);
