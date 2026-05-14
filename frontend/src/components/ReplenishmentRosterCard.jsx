import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Users, FloppyDisk } from "@phosphor-icons/react";
import { SectionTitle } from "@/components/common";
import { toast } from "sonner";

/**
 * ReplenishmentRosterCard — shared roster editor.
 *
 * Iter 78 — extracted from Replenishments.jsx so both that page AND
 * the Warehouse→Store IBT section on /ibt can present the same
 * admin-only roster card. The card mutates a single backend doc
 * (`/admin/replenishment-config`) so saving here also affects
 * the Daily Replenishments distribution and vice versa.
 *
 * Props:
 *   isAdmin   bool        — whether to render at all. Falsy hides the card.
 *   onSaved   fn?         — callback fired after a successful save so
 *                            the parent can refresh its own suggestions
 *                            list (the redistribution is server-side).
 *   subtitle  string?     — override the default explainer copy.
 *   testId    string?     — root data-testid (default replen-owner-panel).
 */
const ReplenishmentRosterCard = ({
  isAdmin,
  onSaved,
  subtitle,
  testId = "replen-owner-panel",
}) => {
  const [ownerCount, setOwnerCount] = useState(4);
  const [ownerNames, setOwnerNames] = useState(["", "", "", ""]);
  const [ownerSaving, setOwnerSaving] = useState(false);

  // Bootstrap from server-side config (admin-only fetch).
  useEffect(() => {
    if (!isAdmin) return;
    let cancel = false;
    api.get("/admin/replenishment-config")
      .then(({ data: cfg }) => {
        if (cancel) return;
        const names = (cfg?.owners || []).map(String);
        setOwnerCount(Math.max(1, names.length || 4));
        setOwnerNames(names.length ? names : ["", "", "", ""]);
      })
      .catch(() => { /* fall back to defaults */ });
    return () => { cancel = true; };
  }, [isAdmin]);

  // Resize the names array when count changes.
  useEffect(() => {
    setOwnerNames((prev) => {
      const n = Math.max(1, Math.min(20, ownerCount));
      const out = [...prev];
      while (out.length < n) out.push("");
      while (out.length > n) out.pop();
      return out;
    });
  }, [ownerCount]);

  const saveOwners = async () => {
    setOwnerSaving(true);
    try {
      const cleaned = ownerNames.map((s) => s.trim()).filter(Boolean);
      await api.post("/admin/replenishment-config", { owners: cleaned });
      toast.success(cleaned.length
        ? `Roster saved — ${cleaned.length} ${cleaned.length === 1 ? "person" : "people"}. Redistributing…`
        : "Roster reset to default. Redistributing…");
      if (typeof onSaved === "function") {
        try { await onSaved(); } catch { /* parent handles its own errors */ }
      }
    } catch (e) {
      toast.error("Couldn't save — " + (e?.response?.data?.detail || e.message));
    } finally {
      setOwnerSaving(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="card-white p-5" data-testid={testId}>
      <SectionTitle
        title={
          <span className="inline-flex items-center gap-2">
            <Users size={16} weight="duotone" className="text-brand-deep" />
            Replenishment team roster
          </span>
        }
        subtitle={
          subtitle
          || "How many people are picking today, and who? Save to redistribute lines across your roster — POS sorted ascending so each person owns a contiguous block of stores."
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4 items-start">
        <div>
          <label className="eyebrow block mb-1">Number of pickers</label>
          <input
            type="number"
            min={1}
            max={20}
            value={ownerCount}
            onChange={(e) => setOwnerCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            className="input-pill w-full"
            data-testid="replen-owner-count"
          />
        </div>
        <div>
          <label className="eyebrow block mb-1">Names (one per row)</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {ownerNames.map((name, i) => (
              <input
                key={i}
                type="text"
                value={name}
                placeholder={`Picker ${i + 1}`}
                onChange={(e) => setOwnerNames((prev) => {
                  const next = [...prev];
                  next[i] = e.target.value;
                  return next;
                })}
                className="input-pill w-full"
                data-testid={`replen-owner-name-${i}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={saveOwners}
          disabled={ownerSaving}
          className="inline-flex items-center gap-1.5 text-[12px] font-bold text-white bg-[#1a5c38] hover:bg-[#0f3d24] px-3 py-2 rounded-md disabled:opacity-50"
          data-testid="replen-save-owners"
        >
          <FloppyDisk size={13} weight="bold" /> {ownerSaving ? "Saving…" : "Save & redistribute"}
        </button>
        <span className="text-[11px] text-muted">
          Empty list = use the default roster (Matthew, Teddy, Alvi, Emma).
        </span>
      </div>
    </div>
  );
};

export default ReplenishmentRosterCard;
