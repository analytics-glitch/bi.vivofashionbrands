import React from "react";
import { CohortsTab, OperationsTab } from "./InsightsTabs";

export function CohortsPage() {
  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="cohorts-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">Analytics</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Cohorts</h1>
          <div className="gold-rule mt-4" />
          <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
            Acquisition retention, tier migration over time, and per-channel comparison — all built on
            the live customer cache from the Vivo BI API.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <CohortsTab />
      </div>
    </div>
  );
}

export function OperationsPage() {
  return (
    <div className="p-6 md:p-10 max-w-[1500px] mx-auto" data-testid="operations-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">CRM Operations</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Operations</h1>
          <div className="gold-rule mt-4" />
          <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
            Daily brief, leaderboard, LTV forecast, smart reorder list and upcoming life events —
            everything a store manager needs to run the week.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <OperationsTab />
      </div>
    </div>
  );
}
