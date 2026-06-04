/**
 * Iter 91q — Marketing page rebuilt.
 *
 * Hosts the Marketing Action Tracker (moved from Range Mgmt) plus a
 * "Send Weekly Report Now" admin button for ad-hoc dispatches.
 * Automated Monday-morning email goes to marketing@vivofashiongroup.com
 * with William + Stephen on CC.
 */
import React, { useState } from "react";
import { useFilters } from "@/lib/filters";
import { SectionTitle } from "@/components/common";
import { api } from "@/lib/api";
import MarketingActionTracker from "@/components/range-mgmt/MarketingActionTracker";
import { Megaphone, EnvelopeSimple } from "@phosphor-icons/react";

export default function Marketing() {
  const { countries, channels } = useFilters();
  const [refreshToken, setRefreshToken] = useState(0);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const sendNow = async () => {
    if (!window.confirm("Send the weekly marketing action report now to marketing@vivofashiongroup.com (cc William + Stephen)?")) return;
    setSending(true);
    setFeedback(null);
    try {
      const { data } = await api.post("/marketing/weekly-report/send", {});
      if (data?.ok) {
        setFeedback({ tone: "ok", msg: data.message || "Report queued for delivery." });
      } else {
        setFeedback({ tone: "warn", msg: data?.message || "Could not send — check the Resend API key." });
      }
    } catch (e) {
      setFeedback({ tone: "err", msg: e?.response?.data?.detail || e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="marketing-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <SectionTitle icon={Megaphone}>Marketing</SectionTitle>
          <p className="text-[12px] text-muted mt-1 max-w-[680px]">
            Action tracker for under-performing styles (≥ 4 weeks post-launch, lifetime SOR &lt; 40%). Log an action to start
            tracking SOR progression — every entry snapshots the SOR at start so we can measure which marketing levers actually
            move the needle.
          </p>
          <p className="text-[11px] text-muted mt-2 max-w-[680px]">
            <strong>Weekly digest</strong>: this report ships every <strong>Monday 8:00 AM Africa/Nairobi</strong> to
            <code className="ml-1 text-[10.5px]">marketing@vivofashiongroup.com</code> with William &amp; Stephen on CC. Sender:
            <code className="ml-1 text-[10.5px]">analytics@vivofashiongroup.com</code>.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={sendNow}
            disabled={sending}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-orange-600 text-white text-[12px] font-semibold hover:bg-orange-700 disabled:opacity-50"
            data-testid="send-marketing-report-btn"
          >
            <EnvelopeSimple size={14} weight="bold" />
            {sending ? "Sending…" : "Send Weekly Report Now"}
          </button>
          {feedback && (
            <span
              className={`text-[11px] font-semibold ${
                feedback.tone === "ok" ? "text-emerald-700" :
                feedback.tone === "warn" ? "text-amber-700" : "text-rose-700"
              }`}
              data-testid="send-marketing-feedback"
            >
              {feedback.msg}
            </span>
          )}
        </div>
      </div>

      {/* Relocated from Range Mgmt — same component, full functionality. */}
      <MarketingActionTracker
        countries={countries}
        channels={channels}
        refreshToken={refreshToken}
        showChannelColumns
        onSaved={() => setRefreshToken((x) => x + 1)}
      />
    </div>
  );
}
