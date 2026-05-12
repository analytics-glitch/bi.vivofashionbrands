import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Overview page loading skeleton — mirrors the real layout (KPI grid +
 * country summary cards + chart row + table) so users see structure
 * immediately instead of a blank screen with a spinner. Perceived load
 * time drops sharply even though network time is unchanged.
 */
const KPIBlock = () => (
  <div className="rounded-2xl border border-border bg-white p-4">
    <Skeleton className="h-3 w-20 mb-3" />
    <Skeleton className="h-7 w-32 mb-2" />
    <Skeleton className="h-3 w-24" />
  </div>
);

const CountryCardBlock = () => (
  <div className="rounded-2xl border border-border bg-white p-4">
    <div className="flex items-center justify-between mb-3">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-3 w-8" />
    </div>
    <Skeleton className="h-7 w-28 mb-2" />
    <Skeleton className="h-3 w-32" />
  </div>
);

const ChartBlock = () => (
  <div className="rounded-2xl border border-border bg-white p-4">
    <Skeleton className="h-4 w-32 mb-4" />
    <Skeleton className="h-[220px] w-full" />
  </div>
);

const TableBlock = () => (
  <div className="rounded-2xl border border-border bg-white p-4">
    <Skeleton className="h-4 w-40 mb-4" />
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="grid grid-cols-4 gap-3">
          <Skeleton className="h-4 col-span-2" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ))}
    </div>
  </div>
);

export default function OverviewSkeleton() {
  return (
    <div className="space-y-5" data-testid="overview-skeleton">
      {/* KPI strip — 6 cards mirrors the real layout */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <KPIBlock key={i} />)}
      </div>
      {/* Country summary row — 4 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <CountryCardBlock key={i} />)}
      </div>
      {/* Chart row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartBlock />
        <ChartBlock />
      </div>
      {/* Table */}
      <TableBlock />
    </div>
  );
}
