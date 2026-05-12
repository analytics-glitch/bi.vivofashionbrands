import React, { useEffect, useState } from "react";
import { api, formatDate } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { ClipboardList, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function FollowUps() {
  const [tasks, setTasks] = useState([]);
  const [tab, setTab] = useState("open"); // open | overdue | done

  const load = async () => {
    try {
      const r = await api.get("/tasks", { params: { mine: true } });
      setTasks(r.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const filter = (t) => {
    if (tab === "open") return !t.completed;
    if (tab === "overdue") return !t.completed && t.due_date && t.due_date < today;
    if (tab === "done") return t.completed;
    return true;
  };
  const filtered = tasks.filter(filter);

  const complete = async (task_id) => {
    await api.post(`/tasks/${task_id}/complete`);
    toast.success("Completed");
    load();
  };

  return (
    <div className="p-6 md:p-10 max-w-[1200px] mx-auto" data-testid="followups-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="eyebrow">My queue</div>
          <h1 className="font-display text-4xl md:text-5xl mt-2 tracking-tight">Follow-ups</h1>
          <div className="gold-rule mt-4" />
          <p className="text-sm text-[var(--vivo-muted)] mt-3 max-w-2xl">
            Every customer task assigned to you — open, overdue, and recently completed.
          </p>
        </div>
      </div>

      <div className="flex bg-white border border-[var(--vivo-border)] rounded-sm overflow-hidden mt-6 w-fit">
        {[
          ["open", "Open", tasks.filter((t) => !t.completed).length],
          ["overdue", "Overdue", tasks.filter((t) => !t.completed && t.due_date && t.due_date < today).length],
          ["done", "Done", tasks.filter((t) => t.completed).length],
        ].map(([k, label, count]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`h-10 px-5 text-sm uppercase tracking-wider ${tab === k ? "bg-[var(--vivo-navy)] text-white" : "text-[var(--vivo-muted)]"}`}
            data-testid={`followups-tab-${k}`}
          >
            {label} <span className="font-mono-num ml-1.5 opacity-80">{count}</span>
          </button>
        ))}
      </div>

      <Card className="vivo-card rounded-sm mt-6 divide-y divide-[var(--vivo-border)]" data-testid="followups-list">
        {filtered.length === 0 && (
          <div className="p-6 text-sm text-[var(--vivo-muted)]">No follow-ups here.</div>
        )}
        {filtered.map((t) => {
          const overdue = !t.completed && t.due_date && t.due_date < today;
          return (
            <div key={t.task_id} className="p-4 flex items-start justify-between gap-3" data-testid={`followups-item-${t.task_id}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link to={`/customers/${t.customer_id}`} className="font-medium hover:text-[var(--vivo-navy)]">
                    {t.customer_name || t.customer_id}
                  </Link>
                  {overdue && <Badge variant="outline" className="rounded-sm bg-red-50 text-red-700 border-red-200"><AlertCircle className="h-3 w-3 mr-1" /> overdue</Badge>}
                  {t.auto_generated && <Badge variant="outline" className="rounded-sm text-[var(--vivo-muted)]">{t.auto_theme || "auto"}</Badge>}
                </div>
                <div className="text-sm mt-1">{t.title}</div>
                {t.notes && <div className="text-xs text-[var(--vivo-muted)] mt-1 line-clamp-2 whitespace-pre-wrap">{t.notes}</div>}
                <div className="text-xs text-[var(--vivo-muted)] mt-1.5">
                  {t.due_date ? `Due ${formatDate(t.due_date)}` : "No due date"} · created {formatDate(t.created_at)}
                </div>
              </div>
              {!t.completed && (
                <Button
                  onClick={() => complete(t.task_id)}
                  variant="outline"
                  size="sm"
                  className="rounded-sm shrink-0"
                  data-testid={`followups-complete-${t.task_id}`}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Mark done
                </Button>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
