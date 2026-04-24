import React from "react";
import { CircleNotch } from "@phosphor-icons/react";

/**
 * Loading state used across all pages. Picks a playful section-aware message
 * and pairs a small spinner with a subtle pulse so the wait feels intentional
 * rather than broken. Falls back to the `label` prop for bespoke strings.
 */
const LOADING_MESSAGES = [
  "Crunching the numbers…",
  "Polishing the receipts…",
  "Counting the stock…",
  "Asking the POS nicely…",
  "Reading between the rows…",
];

export const Loading = ({ label }) => {
  // Rotate playful messages but keep it deterministic per mount so users
  // don't see the string flicker during re-renders.
  const msg = React.useMemo(
    () => label || LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)],
    [label]
  );
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 text-muted text-sm py-10"
      data-testid="loading"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <CircleNotch className="animate-spin text-brand" size={18} />
        <span>{msg}</span>
      </div>
      {/* Skeleton stripes hint that real content is incoming. */}
      <div className="mt-2 w-full max-w-md space-y-2" aria-hidden="true">
        <div className="h-3 rounded bg-panel/80 animate-pulse" />
        <div className="h-3 rounded bg-panel/70 animate-pulse [animation-delay:120ms]" style={{ width: "85%" }} />
        <div className="h-3 rounded bg-panel/60 animate-pulse [animation-delay:240ms]" style={{ width: "65%" }} />
      </div>
    </div>
  );
};

export const ErrorBox = ({ message }) => (
  <div
    className="card-white p-4 text-sm text-danger border border-danger/40"
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
      <h2 className="font-sans font-bold text-[16px] tracking-tight text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="text-muted text-[12.5px] mt-0.5">{subtitle}</p>
      )}
    </div>
    {action}
  </div>
);
