import React, { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { fmtKESMobile, COUNTRY_FLAGS } from "@/lib/api";
import { X, DownloadSimple, CircleNotch, Clock } from "@phosphor-icons/react";
import { toast } from "sonner";

/**
 * Targets — Mobile snapshot.
 *
 * Single-screen, shareable quarterly performance card built for one
 * screenshot (or one PNG export) sent into the CEO/leadership chat.
 *
 * Layout (top → bottom):
 *   1. Header: quarter label + "X days remaining"
 *   2. Green hero card: group projected achievement % + KES achieved +
 *      target + projected landing
 *   3. 2×2 country tile grid (Kenya · Rwanda · Uganda · Online) — each
 *      tile shows a Progress towards target % with 3 labelled rows:
 *      Achieved to date · Target · Projected landing.
 *   4. Footer: "X days left in Qn" pill
 *
 * No "KEY MESSAGE" prose section (per CEO feedback — repeats what's in
 * the tiles). The top performer is auto-highlighted with an orange
 * border + "top performer" pill.
 */

// Tile colours per CEO mock: orange accent border for the top performer,
// neutral border for the rest. Keep the green hero accent fixed.
const Tile = ({ label, flag, pct, achieved, target, projected, isTop }) => (
  <div
    className={`rounded-2xl p-3 border-2 ${
      isTop ? "border-brand bg-brand/5" : "border-border bg-white"
    }`}
    data-testid={`tgt-snap-tile-${label.toLowerCase()}`}
  >
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-deep">
      <span>{flag}</span>
      <span>{label}</span>
    </div>
    <div className="font-extrabold text-[28px] leading-tight mt-0.5 text-foreground tabular-nums">
      {pct.toFixed(0)}%
    </div>
    {isTop ? (
      <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-brand text-white text-[9.5px] font-bold uppercase tracking-wider">
        ★ top performer
      </div>
    ) : (
      <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 text-[9.5px] font-bold uppercase tracking-wider">
        proj.
      </div>
    )}
    <div className="mt-2 space-y-1 text-[10.5px] leading-tight">
      <div className="flex items-baseline justify-between gap-1 whitespace-nowrap">
        <span className="text-muted">Achieved:</span>
        <span className="font-bold tabular-nums">{fmtKESMobile(achieved)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-1 whitespace-nowrap">
        <span className="text-muted">Target:</span>
        <span className="font-bold tabular-nums">{fmtKESMobile(target)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-1 whitespace-nowrap">
        <span className="text-muted">Projected:</span>
        <span className="font-bold tabular-nums">{fmtKESMobile(projected)}</span>
      </div>
    </div>
    {/* Progress bar — visualises pct of target. Caps at 100 % visually
        but the headline number still shows the true projected %. */}
    <div className="mt-2 h-1.5 rounded-full bg-border/60 overflow-hidden">
      <div
        className={`h-full rounded-full ${isTop ? "bg-brand" : "bg-orange-400"}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  </div>
);

const Ring = ({ pct }) => {
  // Pure-CSS conic-gradient progress ring — html2canvas-friendly,
  // no SVG masking quirks. Caps the visual at 100 % so over-achievers
  // still render a complete circle.
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative w-20 h-20 shrink-0">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(#ffffff ${clamped}%, rgba(255,255,255,0.25) ${clamped}% 100%)`,
        }}
      />
      <div className="absolute inset-[6px] rounded-full bg-[#1a5c38] flex flex-col items-center justify-center">
        <div className="text-[18px] font-extrabold text-white leading-none tabular-nums">
          {pct.toFixed(0)}%
        </div>
        <div className="text-[8px] font-bold uppercase tracking-wider text-white/80 leading-none mt-1">
          proj.
        </div>
      </div>
    </div>
  );
};

const TargetsSnapshot = ({ quarterLabel, daysLeft, rows, overall, onClose }) => {
  const captureRef = useRef(null);
  const [saving, setSaving] = useState(false);

  // Top performer = highest projected/target ratio (matches the CEO mock).
  const ratioOf = (r) => (r.target > 0 ? (r.projected || 0) / r.target : 0);
  const topRow = [...(rows || [])].sort((a, b) => ratioOf(b) - ratioOf(a))[0];
  const topLabel = topRow?.label;

  const overallRatio = overall?.target
    ? ((overall.projected || 0) / overall.target) * 100
    : 0;
  const overallAchievedPct = overall?.target
    ? ((overall.achieved || 0) / overall.target) * 100
    : 0;

  const onSaveImage = async () => {
    if (!captureRef.current || saving) return;
    setSaving(true);
    try {
      const canvas = await html2canvas(captureRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `vivo-targets-${quarterLabel}-snapshot.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("Snapshot saved — ready to share", { duration: 3000 });
    } catch (e) {
      toast.error("Couldn't save snapshot — " + (e?.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-background"
      data-testid="targets-snapshot"
    >
      <div className="mx-auto w-full max-w-[440px] px-3 pt-2 pb-4">
        {/* Toolbar — html2canvas-ignored so it doesn't appear in the export */}
        <div className="flex items-center justify-end gap-1.5 mb-2" data-html2canvas-ignore="true">
          <button
            type="button"
            onClick={onSaveImage}
            disabled={saving}
            data-testid="targets-snapshot-save"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10.5px] font-bold border border-brand bg-brand text-white hover:bg-brand/90 disabled:opacity-60 disabled:cursor-wait"
            title="Save this snapshot as a PNG to share"
          >
            {saving
              ? <CircleNotch size={12} weight="bold" className="animate-spin" />
              : <DownloadSimple size={12} weight="bold" />}
            {saving ? "Saving…" : "Save image"}
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="targets-snapshot-close"
            className="p-1.5 rounded-full border border-border hover:bg-panel"
            aria-label="Exit snapshot"
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        {/* Capture area — everything below is what gets exported. */}
        <div
          ref={captureRef}
          data-snapshot-capture
          className="rounded-2xl bg-[#f5f1ea] p-4 border border-border"
        >
          {/* Title — single heading row; the quarter is part of the title
              so we omit the top pill + days-remaining + subtitle per
              May 2026 CEO feedback. */}
          <h1 className="font-serif font-extrabold text-[26px] leading-[1.05] text-foreground tracking-tight">
            {quarterLabel} Performance Update
          </h1>

          {/* Hero card */}
          <div className="mt-4 rounded-2xl bg-[#1a5c38] p-4 text-white">
            <div className="flex items-center gap-3">
              <Ring pct={overallRatio} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">
                  Group Achieved
                </div>
                <div className="font-extrabold text-[24px] leading-none mt-1 tabular-nums whitespace-nowrap">
                  {fmtKESMobile(overall?.achieved)}
                </div>
                <div className="text-[10.5px] text-white/85 mt-1.5 tabular-nums">
                  {overallAchievedPct.toFixed(1)}% of quarterly target
                </div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/20 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[9.5px] font-semibold text-white/75 uppercase tracking-wider">Target</div>
                <div className="text-[14px] font-bold tabular-nums whitespace-nowrap">{fmtKESMobile(overall?.target)}</div>
              </div>
              <div className="text-right">
                <div className="text-[9.5px] font-semibold text-white/75 uppercase tracking-wider">Projected landing</div>
                <div className="text-[14px] font-bold tabular-nums whitespace-nowrap">{fmtKESMobile(overall?.projected)}</div>
              </div>
            </div>
          </div>

          {/* 2x2 country grid */}
          <div className="grid grid-cols-2 gap-2.5 mt-3">
            {(rows || []).map((r) => (
              <Tile
                key={r.label}
                label={r.label}
                flag={COUNTRY_FLAGS?.[r.label] || (r.label === "Online" ? "🌐" : "")}
                pct={r.target > 0 ? (r.projected / r.target) * 100 : 0}
                achieved={r.achieved}
                target={r.target}
                projected={r.projected}
                isTop={r.label === topLabel}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between gap-2 text-[10.5px] text-muted">
            <span>All figures in KES · {quarterLabel} in progress</span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-100 text-orange-900 font-bold">
              <Clock size={11} weight="bold" />
              {daysLeft} days left in {quarterLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TargetsSnapshot;
