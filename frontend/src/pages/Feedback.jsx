import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Loading, ErrorBox, Empty } from "@/components/common";
import { ChatCircleDots, PaperPlaneRight, CheckCircle, Clock } from "@phosphor-icons/react";

const CATEGORIES = [
  { key: "bug",     label: "Bug / something broken" },
  { key: "feature", label: "Feature request" },
  { key: "data",    label: "Data issue" },
  { key: "general", label: "General feedback" },
];

/**
 * Feedback page — any logged-in user submits dashboard feedback.
 * Once submitted, it goes to the admin inbox at /admin/feedback. The
 * user sees their own past submissions below the form so they can
 * track resolution status.
 */
const Feedback = () => {
  const [category, setCategory] = useState("general");
  const [page, setPage] = useState(window.location.pathname);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [mine, setMine] = useState([]);
  const [loadingMine, setLoadingMine] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get("/feedback/mine")
      .then((r) => { if (!cancelled) setMine(r.data || []); })
      .catch(() => { if (!cancelled) setMine([]); })
      .finally(() => { if (!cancelled) setLoadingMine(false); });
    return () => { cancelled = true; };
  }, [success]);

  const submit = async (e) => {
    e.preventDefault();
    if (message.trim().length < 4) {
      setError("Please write at least a few words.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/feedback", { category, page: page || null, message: message.trim() });
      setSuccess(true);
      setMessage("");
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="feedback-page">
      <div>
        <div className="eyebrow">Dashboard · Feedback</div>
        <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">
          Send feedback
        </h1>
        <p className="text-muted text-[13px] mt-1 max-w-2xl">
          Spotted a bug, a missing feature, or a data discrepancy? Drop us a
          note. The team gets every submission and will mark it resolved
          once actioned.
        </p>
      </div>

      <form onSubmit={submit} className="card-white p-5 space-y-4" data-testid="feedback-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="eyebrow block mb-1">Category</label>
            <select
              className="input-pill w-full"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              data-testid="feedback-category"
            >
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="eyebrow block mb-1">Page (optional)</label>
            <input
              className="input-pill w-full"
              value={page}
              onChange={(e) => setPage(e.target.value)}
              placeholder="/ibt"
              data-testid="feedback-page"
            />
          </div>
        </div>
        <div>
          <label className="eyebrow block mb-1">Message</label>
          <textarea
            className="w-full border border-border rounded-lg px-3 py-2 text-[13px] focus:border-brand outline-none min-h-[140px]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe the issue or idea — include the page, what you expected, what you saw, and any steps to reproduce."
            data-testid="feedback-message"
          />
        </div>
        {error && <ErrorBox message={error} />}
        {success && (
          <div
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800 inline-flex items-center gap-2"
            data-testid="feedback-success"
          >
            <CheckCircle size={14} weight="fill" /> Thanks! We've logged your feedback.
          </div>
        )}
        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-3.5 py-2 rounded-md disabled:opacity-50"
            data-testid="feedback-submit"
          >
            <PaperPlaneRight size={14} weight="bold" /> {submitting ? "Submitting…" : "Submit feedback"}
          </button>
        </div>
      </form>

      <div className="card-white p-5">
        <h2 className="font-bold text-[13px] mb-3 inline-flex items-center gap-2">
          <ChatCircleDots size={14} weight="duotone" className="text-brand" /> Your past submissions
        </h2>
        {loadingMine ? (
          <Loading label="Loading your past feedback…" />
        ) : mine.length === 0 ? (
          <Empty label="You haven't submitted any feedback yet." />
        ) : (
          <ul className="space-y-2.5" data-testid="feedback-mine">
            {mine.map((f) => (
              <li key={f.id} className="border border-border rounded-lg p-3 flex flex-col sm:flex-row sm:items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
                      {f.category}
                    </span>
                    {f.page && <span className="text-[11px] text-muted">{f.page}</span>}
                    <span className="text-[10.5px] text-muted">
                      {new Date(f.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-[13px] text-foreground whitespace-pre-wrap break-words">
                    {f.message}
                  </div>
                  {f.admin_note && (
                    <div className="mt-2 text-[12px] bg-blue-50 border border-blue-200 text-blue-800 px-2 py-1.5 rounded">
                      Admin note: {f.admin_note}
                    </div>
                  )}
                </div>
                <div>
                  {f.resolved ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      <CheckCircle size={11} weight="fill" /> Resolved
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      <Clock size={11} weight="fill" /> Open
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Feedback;
