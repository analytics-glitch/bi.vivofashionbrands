import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Database, Clock, CheckCircle } from "@phosphor-icons/react";

const fmtRelative = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (isNaN(mins)) return "—";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const fmtAbsolute = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const DataFreshness = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/data-freshness")
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  return (
    <div className="card-white p-4" data-testid="data-freshness-panel">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-brand-soft grid place-items-center shrink-0">
          <Database size={16} className="text-brand-deep" weight="fill" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="eyebrow">Data Freshness</div>
            <span className="pill-green text-[10px]">
              <CheckCircle size={11} weight="fill" className="inline mr-1" />
              SLA met
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted">Last sale date</div>
              <div className="font-semibold text-[13px] mt-0.5">
                {data.last_sale_date || "—"}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted">Last Odoo extract</div>
              <div className="font-semibold text-[13px] mt-0.5">
                {fmtRelative(data.last_odoo_extract_at)}
              </div>
              <div className="text-[10.5px] text-muted">{fmtAbsolute(data.last_odoo_extract_at)}</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted">Last BigQuery load</div>
              <div className="font-semibold text-[13px] mt-0.5">
                {fmtRelative(data.last_bigquery_load_at)}
              </div>
              <div className="text-[10.5px] text-muted">{fmtAbsolute(data.last_bigquery_load_at)}</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-wider text-muted">
                <Clock size={10} className="inline mr-1" />Next run
              </div>
              <div className="font-semibold text-[13px] mt-0.5">
                {fmtAbsolute(data.next_scheduled_run_at)}
              </div>
              <div className="text-[10.5px] text-muted">{data.etl_cadence} · SLA {data.sla_hours}h</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DataFreshness;
