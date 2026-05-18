import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, formatDate, formatKES, formatNumber } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, MessageCircle, Plus, Trash2, BookImage, Phone, Mail, MapPin, Calendar, ShieldCheck, Save, Smartphone, AtSign, X, Sparkles, AlertTriangle, Wand2, RefreshCw, ChevronRight } from "lucide-react";
import { RfmBadge } from "@/components/RfmBadge";
import { useAuth } from "@/contexts/AuthContext";

const FIT_OPTIONS = ["Fitted", "Regular", "Relaxed"];
const FABRIC_OPTIONS = ["Cotton", "Wool", "Linen", "Silk", "Synthetic", "Denim"];
const OCCASION_OPTIONS = ["Work", "Evening", "Casual", "Formal", "Travel"];

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [messages, setMessages] = useState([]);
  const [prefs, setPrefs] = useState({ sizes: { top: "", bottom: "", shoes: "" }, fits: [], fabrics: [], occasions: [], brands: [], dob: "", key_dates: [], colour_palette: [], style_avoids: [], preferred_store: "", preferred_channel: "" });
  const [wishlist, setWishlist] = useState([]);
  const [wishOpen, setWishOpen] = useState(false);
  const [wishProduct, setWishProduct] = useState("");
  const [wishNote, setWishNote] = useState("");
  const [lookalikes, setLookalikes] = useState(null);
  const [consent, setConsent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [socialHandles, setSocialHandles] = useState([]);
  const [socialFeedback, setSocialFeedback] = useState([]);
  const [nba, setNba] = useState(null);
  const [nbaLoading, setNbaLoading] = useState(false);
  const [churn, setChurn] = useState(null);
  const [brief, setBrief] = useState(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [assignment, setAssignment] = useState({ assignee_user_id: null, assignee_name: null });
  const [users, setUsers] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetConfirm, setForgetConfirm] = useState("");

  // dialog states
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [msgOpen, setMsgOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [channel, setChannel] = useState("whatsapp");
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftVariants, setDraftVariants] = useState([]);
  const [draftIntent, setDraftIntent] = useState("checkin");
  const [moments, setMoments] = useState([]);
  const [momentForm, setMomentForm] = useState({ type: "birthday", date: "", title: "", remind_days_before: 7 });
  const [recording, setRecording] = useState(false);
  const [recorder, setRecorder] = useState(null);
  const [voiceUploading, setVoiceUploading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [p, n, t, m, pr, c, tpl, social, wl, cr, tl, asg, us, mom] = await Promise.all([
        api.get(`/bi/customer/${id}`),
        api.get(`/notes`, { params: { customer_id: id } }),
        api.get(`/tasks`, { params: { customer_id: id } }),
        api.get(`/messages`, { params: { customer_id: id } }),
        api.get(`/preferences/${id}`),
        api.get(`/consent/${id}`),
        api.get(`/templates`),
        api.get(`/social/timeline/${id}`),
        api.get(`/insights/wishlists/${id}`),
        api.get(`/customers/${id}/churn-reasoning`).catch(() => ({ data: null })),
        api.get(`/customers/${id}/timeline`).catch(() => ({ data: { events: [] } })),
        api.get(`/customers/${id}/assignment`).catch(() => ({ data: {} })),
        api.get(`/users`).catch(() => ({ data: [] })),
        api.get(`/customers/${id}/moments`).catch(() => ({ data: [] })),
      ]);
      setProfile(p.data?.profile);
      setProducts(p.data?.products || []);
      setNotes(n.data || []);
      setTasks(t.data || []);
      setMessages(m.data || []);
      setMoments(mom.data || []);
      setPrefs({
        sizes: pr.data?.sizes || {},
        fits: pr.data?.fits || [],
        fabrics: pr.data?.fabrics || [],
        occasions: pr.data?.occasions || [],
        brands: pr.data?.brands || [],
        dob: pr.data?.dob || "",
        key_dates: pr.data?.key_dates || [],
        colour_palette: pr.data?.colour_palette || [],
        style_avoids: pr.data?.style_avoids || [],
        preferred_store: pr.data?.preferred_store || "",
        preferred_channel: pr.data?.preferred_channel || "",
      });
      setConsent(c.data || []);
      setTemplates(tpl.data || []);
      setSocialHandles(social.data?.handles || []);
      setSocialFeedback(social.data?.items || []);
      setWishlist(wl.data || []);
      setChurn(cr.data);
      setTimeline(tl.data?.events || []);
      setAssignment(asg.data || {});
      setUsers(us.data || []);
    } finally {
      setLoading(false);
    }
  };

  const loadNba = async () => {
    setNbaLoading(true);
    try {
      const r = await api.get(`/customers/${id}/nba`);
      setNba(r.data);
    } catch {
      /* ignore */
    } finally {
      setNbaLoading(false);
    }
  };

  const useNbaScript = () => {
    if (!nba?.script) return;
    setMsgOpen(true);
    setTplId("");
    setChannel("whatsapp");
    setMsgBody(nba.script);
  };

  const forgetCustomer = async () => {
    if (forgetConfirm !== profile?.customer_name) {
      toast.error("Type the customer's full name to confirm");
      return;
    }
    try {
      await api.post(`/customers/${id}/forget`);
      toast.success("Customer forgotten");
      setForgetOpen(false);
      navigate("/customers");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not forget");
    }
  };

  useEffect(() => {
    reload();
    loadNba();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addNote = async () => {
    if (!noteBody.trim()) return;
    await api.post("/notes", { customer_id: id, customer_name: profile?.customer_name, body: noteBody });
    setNoteBody("");
    setNoteOpen(false);
    toast.success("Note saved");
    reload();
  };

  const addTask = async () => {
    if (!taskTitle.trim()) return;
    await api.post("/tasks", { customer_id: id, customer_name: profile?.customer_name, title: taskTitle, due_date: taskDue || null });
    setTaskTitle("");
    setTaskDue("");
    setTaskOpen(false);
    toast.success("Follow-up created");
    reload();
  };

  const completeTask = async (taskId) => {
    await api.post(`/tasks/${taskId}/complete`);
    toast.success("Marked done");
    reload();
  };

  const deleteNote = async (noteId) => {
    await api.delete(`/notes/${noteId}`);
    reload();
  };

  const togglePref = (key, val) => {
    setPrefs((p) => {
      const arr = p[key] || [];
      const next = arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
      return { ...p, [key]: next };
    });
  };

  const savePrefs = async () => {
    await api.put(`/preferences/${id}`, prefs);
    toast.success("Preferences saved");
  };

  const captureConsent = async (channelKey, optIn) => {
    await api.post(`/consent`, { customer_id: id, channel: channelKey, opted_in: optIn, method: "in_store" });
    toast.success(optIn ? `Opt-in captured for ${channelKey}` : `Opt-out captured for ${channelKey}`);
    reload();
  };

  const openMessage = (tpl) => {
    setMsgOpen(true);
    if (tpl) {
      setTplId(tpl.template_id);
      setChannel(tpl.channel);
      setMsgBody(
        tpl.body
          .replaceAll("{customer_name}", profile?.customer_name?.split(" ")[0] || "")
          .replaceAll("{associate_name}", "")
      );
    } else {
      setTplId("");
      setMsgBody("");
    }
  };

  const sendMessage = async () => {
    if (!msgBody.trim()) return;
    try {
      await api.post(`/messages`, {
        customer_id: id,
        customer_name: profile?.customer_name,
        customer_phone: profile?.phone,
        channel,
        template_id: tplId || null,
        template_name: templates.find((t) => t.template_id === tplId)?.name,
        body: msgBody,
      });
      toast.success("Message logged (mock provider)");
      setMsgOpen(false);
      setMsgBody("");
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to send");
    }
  };

  if (loading && !profile) {
    return <div className="p-10 text-[var(--vivo-muted)]">Loading customer…</div>;
  }
  if (!profile) {
    return (
      <div className="p-10">
        <Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="mr-2 h-4 w-4"/>Back</Button>
        <div className="vivo-card p-10 mt-6 text-center">
          <div className="font-display text-2xl">Customer not found</div>
          <p className="text-sm text-[var(--vivo-muted)] mt-2">No purchase history found in BI for id {id}.</p>
        </div>
      </div>
    );
  }

  const initials = (profile.customer_name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto" data-testid="customer-profile-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 -ml-3 text-[var(--vivo-muted)]" data-testid="profile-back">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back
      </Button>

      {/* Hero */}
      <Card className="vivo-card p-8 rounded-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="h-20 w-20 rounded-full bg-[var(--vivo-navy)] text-white flex items-center justify-center text-2xl font-display">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="eyebrow">Customer · {profile.customer_id}</div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <h1 className="font-display text-3xl md:text-4xl" data-testid="profile-name">{profile.customer_name}</h1>
              {profile.rfm_tier && <RfmBadge tier={profile.rfm_tier} />}
              <button
                onClick={() => setAssignOpen(true)}
                className={`text-xs px-2.5 py-1 rounded-sm border ${assignment.assignee_user_id ? "border-[var(--vivo-navy)] text-[var(--vivo-navy)] bg-white" : "border-dashed border-[var(--vivo-muted)] text-[var(--vivo-muted)]"}`}
                data-testid="assignment-chip"
                title="Click to assign or reassign"
              >
                {assignment.assignee_user_id ? <>Assigned: <strong className="font-semibold">{assignment.assignee_name}</strong></> : "Unassigned · claim"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--vivo-muted)]">
              {profile.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5"/>{profile.phone}</span>}
              {profile.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5"/>{profile.email}</span>}
              {profile.customer_country && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>{profile.customer_country}</span>}
              {prefs?.preferred_store && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>Home store: {prefs.preferred_store}</span>}
              {prefs?.dob && <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5"/>DOB {formatDate(prefs.dob)}</span>}
              <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5"/>Customer since {formatDate(profile.first_purchase_date)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => openMessage()} data-testid="action-send-message" className="h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm">
              <MessageCircle className="mr-2 h-4 w-4" /> Send message
            </Button>
            <Button onClick={() => navigate(`/lookbooks/new?customer_id=${id}&customer_name=${encodeURIComponent(profile.customer_name || "")}`)} data-testid="action-create-lookbook" variant="outline" className="h-12 rounded-sm border-[var(--vivo-navy)] text-[var(--vivo-navy)] hover:bg-[var(--vivo-bg)]">
              <BookImage className="mr-2 h-4 w-4" /> New lookbook
            </Button>
            <Button
              onClick={async () => {
                setBriefOpen(true);
                if (brief) return;
                setBriefLoading(true);
                try {
                  const r = await api.get(`/customers/${id}/brief`);
                  setBrief(r.data);
                } catch { /* ignore */ }
                setBriefLoading(false);
              }}
              data-testid="action-ai-brief"
              className="h-12 rounded-sm bg-[var(--vivo-gold)] hover:bg-[var(--vivo-gold)]/90 text-[var(--vivo-navy)] font-semibold"
            >
              <Wand2 className="mr-2 h-4 w-4" /> AI brief
            </Button>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Lifetime" value={formatKES(profile.total_sales)} testid="profile-lifetime-spend" />
          <Stat label="Orders" value={formatNumber(profile.total_orders)} />
          <Stat label="Avg basket" value={formatKES(profile.avg_basket)} />
          <Stat label="Last purchase" value={formatDate(profile.last_purchase_date)} />
        </div>
      </Card>

      {/* AI Next-Best-Action */}
      <Card className="vivo-card mt-6 p-6 rounded-xl border-l-4 border-l-[var(--vivo-gold)]" data-testid="nba-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-[var(--vivo-gold)]" />
              <div className="eyebrow">AI · Next best action</div>
              {nba?.urgency && (
                <span data-testid="nba-urgency" className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-semibold ${
                  nba.urgency === "high" ? "bg-red-50 text-red-700 border border-red-200" :
                  nba.urgency === "medium" ? "bg-amber-50 text-amber-800 border border-amber-200" :
                  "bg-zinc-50 text-zinc-600 border border-zinc-200"
                }`}>{nba.urgency}</span>
              )}
            </div>
            <div className="font-display text-xl capitalize" data-testid="nba-action">{nbaLoading ? "Thinking…" : (nba?.action || "—")}</div>
            <p className="text-sm text-[var(--vivo-muted)] mt-1" data-testid="nba-why">{nba?.why || (nbaLoading ? "" : "No suggestion yet.")}</p>
            {nba?.script && (
              <div className="mt-3 bg-[var(--vivo-bg-soft)] border border-[var(--vivo-border)] p-3 rounded-md text-sm leading-relaxed" data-testid="nba-script">
                "{nba.script}"
              </div>
            )}
          </div>
          {nba?.script && (
            <Button onClick={useNbaScript} className="rounded-md bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white h-11" data-testid="nba-use-script">
              <MessageCircle className="mr-2 h-4 w-4" /> Use this script
            </Button>
          )}
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="timeline_all" className="mt-8">
        <TabsList className="bg-transparent border-b border-[var(--vivo-border)] w-full justify-start rounded-none h-auto p-0 gap-6">
          {[
            ["timeline_all", "Timeline", "profile-tab-timeline-all"],
            ["purchases", "Purchases", "profile-tab-purchases"],
            ["preferences", "Preferences", "profile-tab-preferences"],
            ["wishlist", "Wishlist", "profile-tab-wishlist"],
            ["notes", "Notes", "profile-tab-notes"],
            ["tasks", "Follow-ups", "profile-tab-tasks"],
            ["timeline", "Messages", "profile-tab-timeline"],
            ["social", "Social", "profile-tab-social"],
            ["lookalikes", "Look-alikes", "profile-tab-lookalikes"],
            ["consent", "Consent", "profile-tab-consent"],
          ].map(([v, l, t]) => (
            <TabsTrigger
              key={v}
              value={v}
              data-testid={t}
              className="relative h-12 px-1 rounded-none data-[state=active]:bg-transparent data-[state=active]:text-[var(--vivo-navy)] data-[state=active]:shadow-none data-[state=active]:font-semibold data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-[2px] data-[state=active]:after:bg-[var(--vivo-gold)] text-[var(--vivo-muted)]"
            >
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="timeline_all" className="mt-6" data-testid="timeline-all-tab">
          {churn && churn.risk_band && (
            <Card className={`p-4 rounded-sm mb-4 border-l-4 ${churn.risk_band === "high" ? "border-l-red-500 bg-red-50" : churn.risk_band === "medium" ? "border-l-amber-500 bg-amber-50" : "border-l-emerald-500 bg-emerald-50"}`} data-testid="churn-reasoning-card">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">AI risk reasoning</div>
                  <div className="font-display text-lg mt-0.5">
                    Risk score <span className="font-mono-num">{churn.risk_score}</span> · <span className="uppercase tracking-wider text-xs font-bold">{churn.risk_band}</span>
                  </div>
                </div>
                <div className="text-xs text-[var(--vivo-muted)]">
                  {churn.days_since_last_purchase !== null && <>{churn.days_since_last_purchase}d since last purchase</>}
                  {churn.avg_cadence_days && <> · typical cadence {churn.avg_cadence_days}d</>}
                </div>
              </div>
              {(churn.reasons || []).length > 0 && (
                <ul className="mt-2 text-sm list-disc pl-5 space-y-0.5">
                  {churn.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </Card>
          )}
          <Card className="vivo-card divide-y divide-[var(--vivo-border)] rounded-sm" data-testid="timeline-events">
            {timeline.length === 0 && <div className="p-6 text-sm text-[var(--vivo-muted)]">No activity yet.</div>}
            {timeline.map((e, i) => {
              const dot = {
                purchase: "bg-[var(--vivo-navy)]",
                message: "bg-[var(--vivo-orange,#ED7C2A)]",
                note: "bg-[var(--vivo-gold)]",
                task: "bg-emerald-600",
                social: "bg-fuchsia-600",
              }[e.kind] || "bg-zinc-400";
              return (
                <div key={i} className="p-4 flex gap-3" data-testid={`timeline-event-${e.kind}`}>
                  <div className="flex flex-col items-center mt-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-sm truncate">{e.label}</div>
                      <div className="text-xs text-[var(--vivo-muted)] shrink-0">{formatDate(e.ts)}</div>
                    </div>
                    {e.detail && <div className="text-sm text-[var(--vivo-muted)] mt-1 whitespace-pre-wrap line-clamp-3">{e.detail}</div>}
                  </div>
                </div>
              );
            })}
          </Card>
        </TabsContent>

        <TabsContent value="purchases" className="mt-6">
          <div className="vivo-card divide-y divide-[var(--vivo-border)]">
            {products.length === 0 && <div className="p-6 text-sm text-[var(--vivo-muted)]">No purchase history.</div>}
            {products.slice(0, 25).map((p, i) => (
              <div key={i} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.product_title || p.style_name}</div>
                  <div className="text-xs text-[var(--vivo-muted)] mt-1">
                    {p.last_purchase_date ? formatDate(p.last_purchase_date) : ""} {p.size ? `· Size ${p.size}` : ""} {p.color ? `· ${p.color}` : ""} {p.subcategory ? `· ${p.subcategory}` : ""}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-mono-num">{formatKES(p.total_sales || p.unit_price_kes)}</div>
                  <div className="text-xs text-[var(--vivo-muted)]">{p.quantity ? `${p.quantity} unit${p.quantity > 1 ? "s" : ""}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="preferences" className="mt-6 space-y-6">
          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-4">Sizes</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {["top", "bottom", "shoes"].map((k) => (
                <div key={k}>
                  <Label className="capitalize text-xs text-[var(--vivo-muted)]">{k}</Label>
                  <Input
                    value={prefs.sizes?.[k] || ""}
                    onChange={(e) => setPrefs((p) => ({ ...p, sizes: { ...p.sizes, [k]: e.target.value } }))}
                    placeholder="e.g. M, 32, UK 7"
                    className="h-12 mt-1 rounded-sm"
                    data-testid={`pref-size-${k}`}
                  />
                </div>
              ))}
            </div>
          </Card>

          <PrefChips title="Fit" options={FIT_OPTIONS} values={prefs.fits} onToggle={(v) => togglePref("fits", v)} testidPrefix="pref-fit" />
          <PrefChips title="Fabric" options={FABRIC_OPTIONS} values={prefs.fabrics} onToggle={(v) => togglePref("fabrics", v)} testidPrefix="pref-fabric" />
          <PrefChips title="Occasion" options={OCCASION_OPTIONS} values={prefs.occasions} onToggle={(v) => togglePref("occasions", v)} testidPrefix="pref-occasion" />

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-2">Brand affinities</h3>
            <p className="text-xs text-[var(--vivo-muted)] mb-3">Comma-separated: e.g. Vivo Lulu, Safari, Essence</p>
            <Input
              value={(prefs.brands || []).join(", ")}
              onChange={(e) => setPrefs((p) => ({ ...p, brands: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
              className="h-12 rounded-sm"
              data-testid="pref-brands"
            />
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-2">Life events</h3>
            <p className="text-xs text-[var(--vivo-muted)] mb-3">Birthday + key dates we'll surface 30 days ahead in Operations.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-[var(--vivo-muted)]">Date of birth</Label>
                <Input
                  type="date"
                  value={prefs.dob || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, dob: e.target.value }))}
                  className="h-12 mt-1 rounded-sm"
                  data-testid="pref-dob"
                />
              </div>
              <div>
                <Label className="text-xs text-[var(--vivo-muted)]">Wedding / kids' birthdays</Label>
                <Input
                  placeholder='e.g. Anniversary 06-12, Kid 03-22'
                  value={(prefs.key_dates || []).map((d) => `${d.label || ""} ${d.date_md || d.date || ""}`.trim()).join(", ")}
                  onChange={(e) => {
                    const parsed = e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .map((s) => {
                        const m = s.match(/^(.+?)\s+(\d{2}-\d{2}|\d{4}-\d{2}-\d{2})$/);
                        if (!m) return null;
                        return m[2].length === 5
                          ? { label: m[1], date_md: m[2] }
                          : { label: m[1], date: m[2] };
                      })
                      .filter(Boolean);
                    setPrefs((p) => ({ ...p, key_dates: parsed }));
                  }}
                  className="h-12 mt-1 rounded-sm"
                  data-testid="pref-key-dates"
                />
              </div>
            </div>
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-2">Colour palette</h3>
            <p className="text-xs text-[var(--vivo-muted)] mb-3">Comma-separated. Drives "new arrival in your colours" outreach.</p>
            <Input
              value={(prefs.colour_palette || []).join(", ")}
              onChange={(e) => setPrefs((p) => ({ ...p, colour_palette: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
              placeholder="mustard, navy, ivory, terracotta"
              className="h-12 rounded-sm"
              data-testid="pref-colour-palette"
            />
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-2">Style avoids</h3>
            <p className="text-xs text-[var(--vivo-muted)] mb-3">Things this customer does not want. Prevents wrong recommendations.</p>
            <Input
              value={(prefs.style_avoids || []).join(", ")}
              onChange={(e) => setPrefs((p) => ({ ...p, style_avoids: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
              placeholder="short hemlines, polyester, fluorescent colours"
              className="h-12 rounded-sm"
              data-testid="pref-style-avoids"
            />
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-2">Preferred store & channel</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-[var(--vivo-muted)]">Home store</Label>
                <Input
                  value={prefs.preferred_store || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, preferred_store: e.target.value }))}
                  placeholder="Vivo Sarit / Vivo Junction / Online…"
                  className="h-12 mt-1 rounded-sm"
                  data-testid="pref-preferred-store"
                />
              </div>
              <div>
                <Label className="text-xs text-[var(--vivo-muted)]">Preferred channel</Label>
                <Input
                  value={prefs.preferred_channel || ""}
                  onChange={(e) => setPrefs((p) => ({ ...p, preferred_channel: e.target.value }))}
                  placeholder="whatsapp / sms / email / in-store"
                  className="h-12 mt-1 rounded-sm"
                  data-testid="pref-preferred-channel"
                />
              </div>
            </div>
          </Card>

          <Button onClick={savePrefs} className="h-12 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="pref-save">
            <Save className="mr-2 h-4 w-4" /> Save preferences
          </Button>
        </TabsContent>

        <TabsContent value="wishlist" className="mt-6 space-y-4" data-testid="profile-wishlist-tab">
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--vivo-muted)]">Set-aside items, expires 30 days from creation by default.</p>
            <Button onClick={() => setWishOpen(true)} className="h-11 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="add-wishlist-button">
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          </div>
          <Card className="vivo-card rounded-sm divide-y divide-[var(--vivo-border)]">
            {wishlist.length === 0 && <div className="p-6 text-sm text-[var(--vivo-muted)]">No wishlist items yet.</div>}
            {wishlist.map((w) => (
              <div key={w.wishlist_id} className="p-4 flex items-start justify-between gap-4" data-testid={`wishlist-item-${w.wishlist_id}`}>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${w.fulfilled ? "line-through text-[var(--vivo-muted)]" : ""}`}>{w.product_title}</div>
                  {w.note && <div className="text-sm text-[var(--vivo-muted)] mt-1">{w.note}</div>}
                  <div className="text-xs text-[var(--vivo-muted)] mt-1">
                    Added {formatDate(w.created_at)} by {w.created_by_name} · expires {formatDate(w.expires_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!w.fulfilled && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-sm"
                      onClick={async () => {
                        await api.post(`/insights/wishlists/${w.wishlist_id}/fulfill`);
                        toast.success("Marked fulfilled");
                        reload();
                      }}
                      data-testid={`wishlist-fulfill-${w.wishlist_id}`}
                    >
                      Fulfilled
                    </Button>
                  )}
                  <button
                    onClick={async () => {
                      if (!confirm("Remove this wishlist item?")) return;
                      await api.delete(`/insights/wishlists/${w.wishlist_id}`);
                      toast.success("Removed");
                      reload();
                    }}
                    className="text-[var(--vivo-muted)] hover:text-red-600 p-2"
                    data-testid={`wishlist-delete-${w.wishlist_id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="notes" className="mt-6">
          {/* Customer Moments */}
          <Card className="vivo-card p-5 rounded-sm mb-5" data-testid="moments-card">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--vivo-gold)]" />
                <div className="eyebrow">Moments</div>
              </div>
              <span className="text-[10px] text-[var(--vivo-muted)]">Birthdays · anniversaries · life events — auto-creates a reminder task before each</span>
            </div>
            {moments.length === 0 && (
              <div className="text-xs text-[var(--vivo-muted)] mb-3">No moments logged yet.</div>
            )}
            {moments.length > 0 && (
              <ul className="space-y-2 mb-4" data-testid="moments-list">
                {moments.map((m) => (
                  <li key={m.moment_id} className="flex items-center justify-between gap-3 border-b border-[var(--vivo-border)] pb-2 last:border-0">
                    <div className="text-sm">
                      <span className="font-medium">{m.title}</span>
                      <span className="text-xs text-[var(--vivo-muted)] ml-2">{m.type} · {(m.date || "").slice(-5)}{m.recurring_annual ? " (yearly)" : ""}</span>
                    </div>
                    <button
                      onClick={async () => {
                        try { await api.delete(`/customers/${id}/moments/${m.moment_id}`); setMoments(moments.filter(x => x.moment_id !== m.moment_id)); }
                        catch { toast.error("Could not remove"); }
                      }}
                      className="text-xs text-[var(--vivo-muted)] hover:text-red-600"
                      data-testid={`moment-delete-${m.moment_id}`}
                    ><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
              <div>
                <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Type</Label>
                <select
                  className="mt-1 w-full h-9 px-2 rounded-sm border border-[var(--vivo-border)] bg-white text-sm"
                  value={momentForm.type}
                  onChange={(e) => setMomentForm({ ...momentForm, type: e.target.value })}
                  data-testid="moment-type"
                >
                  <option value="birthday">Birthday</option>
                  <option value="anniversary">Anniversary</option>
                  <option value="graduation">Graduation</option>
                  <option value="wedding">Wedding</option>
                  <option value="baby">Baby</option>
                  <option value="promotion">Promotion</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Date</Label>
                <Input type="date" value={momentForm.date} onChange={(e) => setMomentForm({ ...momentForm, date: e.target.value })} className="mt-1 rounded-sm h-9" data-testid="moment-date" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)]">Title (optional)</Label>
                <Input value={momentForm.title} onChange={(e) => setMomentForm({ ...momentForm, title: e.target.value })} className="mt-1 rounded-sm h-9" placeholder="e.g. 50th birthday" data-testid="moment-title" />
              </div>
              <Button
                onClick={async () => {
                  if (!momentForm.date) { toast.error("Date required"); return; }
                  try {
                    const r = await api.post(`/customers/${id}/moments`, { ...momentForm, recurring_annual: momentForm.type !== "custom" });
                    setMoments([...moments, r.data]);
                    setMomentForm({ type: "birthday", date: "", title: "", remind_days_before: 7 });
                    toast.success("Moment added · reminder will fire " + r.data.remind_days_before + " days before");
                  } catch { toast.error("Could not save"); }
                }}
                className="h-9 rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white"
                data-testid="moment-save"
              >
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </div>
          </Card>

          <div className="flex justify-end mb-4 gap-2">
            <Button
              onClick={async () => {
                if (recording && recorder) {
                  recorder.stop();
                  return;
                }
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                  const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
                  const chunks = [];
                  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
                  mr.onstop = async () => {
                    stream.getTracks().forEach(t => t.stop());
                    setRecording(false);
                    setRecorder(null);
                    if (!chunks.length) return;
                    const blob = new Blob(chunks, { type: "audio/webm" });
                    const fd = new FormData();
                    fd.append("audio", blob, `voice-${Date.now()}.webm`);
                    setVoiceUploading(true);
                    try {
                      const r = await api.post(`/customers/${id}/voice-note`, fd, { headers: { "Content-Type": "multipart/form-data" } });
                      toast.success("Voice note saved + auto-tagged");
                      setNotes([r.data, ...notes]);
                    } catch (e) {
                      toast.error("Voice upload failed: " + (e?.response?.data?.detail || e.message));
                    }
                    setVoiceUploading(false);
                  };
                  mr.start();
                  setRecorder(mr);
                  setRecording(true);
                  toast.info("Recording… click again to stop", { duration: 3000 });
                } catch (e) {
                  toast.error("Mic permission denied or unsupported");
                }
              }}
              disabled={voiceUploading}
              variant="outline"
              className={`h-11 rounded-sm ${recording ? "bg-red-600 text-white border-red-600 hover:bg-red-700" : "border-[var(--vivo-gold)] text-[var(--vivo-navy)]"}`}
              data-testid="voice-record-button"
              title={recording ? "Tap to stop & save" : "Dictate a voice note — Whisper transcribes + AI tags"}
            >
              <span className={`mr-2 inline-block w-2.5 h-2.5 rounded-full ${recording ? "bg-white animate-pulse" : "bg-red-500"}`} />
              {voiceUploading ? "Transcribing…" : recording ? "Stop & save" : "Voice note"}
            </Button>
            <Button onClick={() => setNoteOpen(true)} className="h-11 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="add-note-button">
              <Plus className="mr-2 h-4 w-4" /> Add note
            </Button>
          </div>
          {notes.length === 0 ? (
            <div className="vivo-card p-10 text-center text-sm text-[var(--vivo-muted)]">No notes yet.</div>
          ) : (
            <div className="space-y-4" data-testid="notes-list">
              {notes.map((n) => (
                <Card key={n.note_id} className="vivo-card p-5 rounded-sm">
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-[var(--vivo-muted)] flex items-center gap-2">
                        {n.source === "voice" && <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] bg-[var(--vivo-gold)]/10 text-[var(--vivo-navy)] px-1.5 py-0.5 rounded-sm font-semibold">🎤 voice</span>}
                        {n.author_name} · {formatDate(n.created_at)}
                      </div>
                      <p className="mt-2 text-base leading-relaxed">{n.body}</p>
                      {n.tags && (n.tags.interests?.length || n.tags.size_notes?.length || n.tags.follow_up) && (
                        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
                          {(n.tags.interests || []).map((t, i) => (
                            <span key={`i${i}`} className="bg-[var(--vivo-bg)] border border-[var(--vivo-border)] px-1.5 py-0.5 rounded-sm">💚 {t}</span>
                          ))}
                          {(n.tags.size_notes || []).map((t, i) => (
                            <span key={`s${i}`} className="bg-amber-50 border border-amber-200 text-amber-800 px-1.5 py-0.5 rounded-sm">📏 {t}</span>
                          ))}
                          {n.tags.follow_up && (
                            <span className="bg-[var(--vivo-navy)] text-white px-1.5 py-0.5 rounded-sm">→ {n.tags.follow_up}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => deleteNote(n.note_id)} aria-label="Delete note">
                      <Trash2 className="h-4 w-4 text-[var(--vivo-muted)]" />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-6">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setTaskOpen(true)} className="h-11 bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="add-task-button">
              <Plus className="mr-2 h-4 w-4" /> New follow-up
            </Button>
          </div>
          {tasks.length === 0 ? (
            <div className="vivo-card p-10 text-center text-sm text-[var(--vivo-muted)]">No follow-ups.</div>
          ) : (
            <div className="space-y-3" data-testid="tasks-list-profile">
              {tasks.map((t) => (
                <Card key={t.task_id} className="vivo-card p-4 rounded-sm flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${t.completed ? "line-through text-[var(--vivo-muted)]" : ""}`}>{t.title}</div>
                    <div className="text-xs text-[var(--vivo-muted)]">Due {formatDate(t.due_date)} · {t.assignee_name}</div>
                  </div>
                  {!t.completed ? (
                    <Button onClick={() => completeTask(t.task_id)} variant="outline" className="rounded-sm">Mark done</Button>
                  ) : (
                    <Badge variant="secondary" className="rounded-sm">Done {formatDate(t.completed_at)}</Badge>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-6">
          {messages.length === 0 ? (
            <div className="vivo-card p-10 text-center text-sm text-[var(--vivo-muted)]">No messages yet.</div>
          ) : (
            <div className="space-y-3" data-testid="messages-list">
              {messages.map((m) => (
                <Card key={m.message_id} className="vivo-card p-5 rounded-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs text-[var(--vivo-muted)] uppercase tracking-wider">
                      {m.channel} · {m.sender_name} · {formatDate(m.sent_at)}
                    </div>
                    <Badge variant="outline" className="rounded-sm text-[10px]"><Smartphone className="h-3 w-3 mr-1"/>{m.delivery_status}</Badge>
                  </div>
                  <p className="text-base leading-relaxed whitespace-pre-wrap">{m.body}</p>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="social" className="mt-6 space-y-4" data-testid="profile-social-tab">
          <Card className="vivo-card p-6 rounded-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AtSign className="h-5 w-5 text-[var(--vivo-gold)]" />
                <h3 className="font-display text-lg">Social handles</h3>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  const platform = window.prompt("Platform (instagram, facebook, tiktok, x, whatsapp):", "instagram");
                  if (!platform) return;
                  const handle = window.prompt(`@handle on ${platform}:`, "");
                  if (!handle) return;
                  await api.post(`/social/handles/${id}`, { platform: platform.toLowerCase(), handle });
                  toast.success("Handle linked");
                  reload();
                }}
                className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white"
                data-testid="social-add-handle"
              >
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
            </div>
            {socialHandles.length === 0 ? (
              <div className="text-sm text-[var(--vivo-muted)]">No handles linked yet. Adding one auto-matches existing public feedback to this customer.</div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2" data-testid="social-handles-list">
                {socialHandles.map((h) => (
                  <li key={`${h.platform}-${h.handle}`} className="border border-[var(--vivo-border)] p-3 rounded-sm flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--vivo-muted)]">{h.platform}</div>
                      <div className="font-medium">{h.handle}</div>
                    </div>
                    <button
                      onClick={async () => {
                        await api.delete(`/social/handles/${id}/${h.platform}`);
                        toast.success("Handle removed");
                        reload();
                      }}
                      className="text-[var(--vivo-muted)] hover:text-red-600"
                      aria-label="Remove handle"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="vivo-card p-6 rounded-sm">
            <h3 className="font-display text-lg mb-3">Social timeline</h3>
            <div className="vivo-divider mb-4" />
            {socialFeedback.length === 0 ? (
              <div className="text-sm text-[var(--vivo-muted)]">No social activity matched to this customer yet.</div>
            ) : (
              <ul className="divide-y divide-[var(--vivo-border)]" data-testid="social-feedback-list">
                {socialFeedback.map((f) => (
                  <li key={f.feedback_id} className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-wider text-[var(--vivo-muted)]">{f.platform} · {f.type} · {formatDate(f.posted_at)}</div>
                      {f.sentiment && (
                        <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 border rounded-sm ${
                          f.sentiment === "positive" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          f.sentiment === "negative" ? "bg-red-50 text-red-700 border-red-200" :
                          "bg-zinc-50 text-zinc-600 border-zinc-200"
                        }`}>{f.sentiment}</span>
                      )}
                    </div>
                    <p className="text-sm mt-1">{f.body}</p>
                    {f.themes?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {f.themes.map((t) => <Badge key={t} variant="outline" className="rounded-sm text-[10px]">{t}</Badge>)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="lookalikes" className="mt-6" data-testid="profile-lookalikes-tab">
          <Card className="vivo-card p-6 rounded-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-lg">Look-alike customers</h3>
                <p className="text-sm text-[var(--vivo-muted)]">Customers with the same RFM tier, similar spend bracket and matching size signature.</p>
              </div>
              <Button
                variant="outline"
                className="rounded-sm h-10"
                data-testid="lookalikes-load"
                onClick={async () => {
                  try {
                    const r = await api.get(`/insights/lookalikes/${id}?limit=10`);
                    setLookalikes(r.data);
                    toast.success(`${r.data.matches.length} match${r.data.matches.length === 1 ? "" : "es"}`);
                  } catch (e) {
                    toast.error(e?.response?.data?.detail || "Failed");
                  }
                }}
              >
                {lookalikes ? "Refresh" : "Find look-alikes"}
              </Button>
            </div>
            {!lookalikes ? (
              <div className="text-sm text-[var(--vivo-muted)]">Click "Find look-alikes" to compute.</div>
            ) : (
              <ul className="divide-y divide-[var(--vivo-border)]">
                {lookalikes.matches.map((m) => (
                  <li key={m.customer_id} className="py-3 flex items-center justify-between gap-3">
                    <Link to={`/customers/${m.customer_id}`} className="flex-1 min-w-0 hover:text-[var(--vivo-navy)]">
                      <div className="font-medium truncate flex items-center gap-2">{m.customer_name} <RfmBadge tier={m.rfm_tier} /></div>
                      <div className="text-xs text-[var(--vivo-muted)] mt-0.5">{m.city || "—"} · {formatKES(m.lifetime_spend_kes)}</div>
                    </Link>
                    <div className="text-right shrink-0">
                      <div className="font-mono-num text-sm">{m.match_score}</div>
                      <div className="text-[10px] uppercase tracking-wider text-[var(--vivo-muted)]">match</div>
                    </div>
                  </li>
                ))}
                {lookalikes.matches.length === 0 && <li className="py-3 text-sm text-[var(--vivo-muted)]">No look-alikes found.</li>}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="consent" className="mt-6 space-y-4">
          <Card className="vivo-card p-6 rounded-sm">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck className="h-5 w-5 text-[var(--vivo-gold)]" />
              <h3 className="font-display text-lg">Kenya DPA consent</h3>
            </div>
            <p className="text-sm text-[var(--vivo-muted)] mb-4">Capture explicit consent before sending marketing messages.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {["whatsapp", "sms"].map((ch) => (
                <div key={ch} className="border border-[var(--vivo-border)] p-4 rounded-sm flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-[var(--vivo-muted)]">{ch}</div>
                    <div className="text-sm mt-1">{(() => {
                      const last = consent.find((c) => c.channel === ch);
                      if (!last) return "No record yet";
                      return last.opted_in ? `Opted in ${formatDate(last.timestamp)}` : `Opted out ${formatDate(last.timestamp)}`;
                    })()}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => captureConsent(ch, true)} className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)]" data-testid={`consent-in-${ch}`}>Opt in</Button>
                    <Button size="sm" variant="outline" onClick={() => captureConsent(ch, false)} className="rounded-sm" data-testid={`consent-out-${ch}`}>Opt out</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {consent.length > 0 && (
            <Card className="vivo-card p-6 rounded-sm">
              <h4 className="font-display text-base mb-3">History</h4>
              <ul className="space-y-2 text-sm">
                {consent.map((c) => (
                  <li key={c.consent_id} className="flex justify-between border-b border-[var(--vivo-border)] py-2 last:border-0">
                    <span>{c.channel} · {c.opted_in ? "Opted in" : "Opted out"}</span>
                    <span className="text-[var(--vivo-muted)]">{c.captured_by_name} · {formatDate(c.timestamp)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {user?.role === "manager" && (
            <Card className="vivo-card p-6 rounded-sm border-l-4 border-l-red-600 bg-red-50/40" data-testid="forget-danger-zone">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <h3 className="font-display text-lg text-red-700">Right to be forgotten</h3>
              </div>
              <p className="text-sm text-[var(--vivo-muted)] mb-4">
                Anonymizes all Vivo CRM records for this customer (notes, messages, tasks, lookbooks,
                preferences, social handles). BI/BigQuery upstream data is not touched —
                that lives in your warehouse.
              </p>
              <Button
                variant="outline"
                onClick={() => { setForgetOpen(true); setForgetConfirm(""); }}
                className="rounded-md border-red-600 text-red-700 hover:bg-red-50"
                data-testid="forget-customer-button"
              >
                Forget this customer…
              </Button>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Note dialog */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="rounded-sm">
          <DialogHeader><DialogTitle className="font-display">Add a note</DialogTitle></DialogHeader>
          <Textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder="What did you learn about this customer today?" rows={5} data-testid="note-body" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button onClick={addNote} className="bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="note-save">Save note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Task dialog */}
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="rounded-sm">
          <DialogHeader><DialogTitle className="font-display">New follow-up</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Task</Label>
              <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Call when new arrivals in size M land" className="h-12 mt-1" data-testid="task-title" />
            </div>
            <div>
              <Label>Due date</Label>
              <Input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="h-12 mt-1" data-testid="task-due" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTaskOpen(false)}>Cancel</Button>
            <Button onClick={addTask} className="bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="task-save">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wishlist dialog */}
      <Dialog open={wishOpen} onOpenChange={setWishOpen}>
        <DialogContent className="rounded-sm">
          <DialogHeader><DialogTitle className="font-display">Add to wishlist</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Product</Label>
              <Input value={wishProduct} onChange={(e) => setWishProduct(e.target.value)} placeholder="e.g. Vivo Lulu Cotton Tent Mini Dress in Mustard, size M" className="h-12 mt-1 rounded-sm" data-testid="wishlist-product" />
            </div>
            <div>
              <Label>Note (optional)</Label>
              <Textarea rows={3} value={wishNote} onChange={(e) => setWishNote(e.target.value)} placeholder="ETA, size, store..." data-testid="wishlist-note" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWishOpen(false)}>Cancel</Button>
            <Button
              className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white"
              data-testid="wishlist-save"
              onClick={async () => {
                if (!wishProduct.trim()) return;
                try {
                  await api.post("/insights/wishlists", {
                    customer_id: id,
                    customer_name: profile?.customer_name,
                    product_title: wishProduct.trim(),
                    note: wishNote.trim() || null,
                  });
                  toast.success("Added to wishlist");
                  setWishOpen(false);
                  setWishProduct("");
                  setWishNote("");
                  reload();
                } catch (e) {
                  toast.error(e?.response?.data?.detail || "Failed");
                }
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Assignment dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="rounded-sm max-w-md">
          <DialogHeader><DialogTitle className="font-display">Assign customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-[var(--vivo-muted)]">
              Pick the associate who owns this relationship. Only the assigned associate (or a manager) can change it later.
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto" data-testid="assignment-list">
              {users.map((u) => (
                <button
                  key={u.user_id}
                  onClick={async () => {
                    await api.put(`/customers/${id}/assignment`, { assignee_user_id: u.user_id, assignee_name: u.name });
                    setAssignment({ assignee_user_id: u.user_id, assignee_name: u.name });
                    setAssignOpen(false);
                    toast.success(`Assigned to ${u.name}`);
                  }}
                  className={`w-full text-left px-3 py-2 border rounded-sm hover:bg-[var(--vivo-bg)] ${assignment.assignee_user_id === u.user_id ? "border-[var(--vivo-navy)] bg-[var(--vivo-bg)]" : "border-[var(--vivo-border)]"}`}
                  data-testid={`assign-pick-${u.user_id}`}
                >
                  <div className="font-medium text-sm">{u.name}</div>
                  <div className="text-xs text-[var(--vivo-muted)] uppercase tracking-wider">{u.role}</div>
                </button>
              ))}
            </div>
            {assignment.assignee_user_id && (
              <Button
                variant="outline"
                onClick={async () => {
                  await api.put(`/customers/${id}/assignment`, { assignee_user_id: null });
                  setAssignment({ assignee_user_id: null, assignee_name: null });
                  setAssignOpen(false);
                  toast.success("Unassigned");
                }}
                className="rounded-sm w-full text-red-700 border-red-200 hover:bg-red-50"
                data-testid="assign-clear"
              >
                Remove assignment
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>


      {/* Message dialog */}
      <Dialog open={msgOpen} onOpenChange={setMsgOpen}>
        <DialogContent className="rounded-sm max-w-xl">
          <DialogHeader><DialogTitle className="font-display">Send a personal message</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Channel</Label>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger className="h-12 mt-1 rounded-sm" data-testid="msg-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Template</Label>
                <Select value={tplId} onValueChange={(v) => {
                  setTplId(v);
                  const t = templates.find((x) => x.template_id === v);
                  if (t) {
                    setChannel(t.channel);
                    setMsgBody(
                      t.body.replaceAll("{customer_name}", profile?.customer_name?.split(" ")[0] || "")
                    );
                  }
                }}>
                  <SelectTrigger className="h-12 mt-1 rounded-sm" data-testid="msg-template-select"><SelectValue placeholder="Choose template" /></SelectTrigger>
                  <SelectContent>
                    {templates.filter((t) => t.channel === channel).map((t) => (
                      <SelectItem key={t.template_id} value={t.template_id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Message</Label>
              <Textarea rows={5} value={msgBody} onChange={(e) => setMsgBody(e.target.value)} className="mt-1" data-testid="msg-body" />
              <p className="text-xs text-[var(--vivo-muted)] mt-2">Logs locally · BSP wires in via env once approved. Or hand off to WhatsApp app below.</p>
            </div>

            {/* AI Co-pilot */}
            <div className="border border-[var(--vivo-gold)] rounded-sm p-3 bg-[var(--vivo-bg)]" data-testid="copilot-section">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-[var(--vivo-gold)]" />
                  <span className="text-sm font-semibold">AI Co-pilot</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={draftIntent}
                    onChange={(e) => setDraftIntent(e.target.value)}
                    className="text-xs h-8 px-2 rounded-sm border border-[var(--vivo-border)] bg-white"
                    data-testid="draft-intent"
                  >
                    <option value="checkin">Casual check-in</option>
                    <option value="winback">Win-back</option>
                    <option value="birthday">Birthday</option>
                    <option value="new_arrivals">New arrivals</option>
                    <option value="thank_you">Thank you</option>
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={draftLoading}
                    onClick={async () => {
                      setDraftLoading(true);
                      setDraftVariants([]);
                      try {
                        const r = await api.post(`/customers/${id}/draft-message`, { intent: draftIntent, tone: "warm" });
                        setDraftVariants(r.data.variants || []);
                      } catch { toast.error("Draft failed"); }
                      setDraftLoading(false);
                    }}
                    className="rounded-sm bg-[var(--vivo-gold)] hover:bg-[var(--vivo-gold)]/90 text-[var(--vivo-navy)] font-semibold h-8"
                    data-testid="draft-go"
                  >
                    {draftLoading ? "Drafting…" : "Draft 3 options"}
                  </Button>
                </div>
              </div>
              {draftVariants.length > 0 && (
                <div className="mt-3 space-y-2" data-testid="draft-variants">
                  {draftVariants.map((v, i) => (
                    <button
                      type="button"
                      key={i}
                      onClick={() => setMsgBody(v.text)}
                      className="block w-full text-left p-3 bg-white rounded-sm border border-[var(--vivo-border)] hover:border-[var(--vivo-gold)] transition"
                      data-testid={`draft-variant-${i}`}
                    >
                      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--vivo-muted)] mb-1">{v.label}</div>
                      <div className="text-sm leading-relaxed italic">"{v.text}"</div>
                    </button>
                  ))}
                  <p className="text-[11px] text-[var(--vivo-muted)] italic">Click a variant to load it into the message field.</p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setMsgOpen(false)}>Cancel</Button>
            {profile?.phone && (
              <Button
                variant="outline"
                onClick={() => {
                  const digits = String(profile.phone || "").replace(/[^\d]/g, "");
                  const number = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
                  const url = `https://wa.me/${number}?text=${encodeURIComponent(msgBody)}`;
                  // Log the outreach locally so it counts toward today's goal even if sent via wa.me
                  sendMessage();
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
                className="rounded-sm"
                data-testid="msg-send-wa"
              >
                Open in WhatsApp →
              </Button>
            )}
            <Button onClick={sendMessage} className="bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white rounded-sm" data-testid="msg-send">Log send</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Forget customer dialog */}
      <Dialog open={forgetOpen} onOpenChange={setForgetOpen}>
        <DialogContent className="rounded-md max-w-md">
          <DialogHeader><DialogTitle className="font-display text-red-700">Forget this customer?</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm leading-relaxed">
              This will anonymize all Vivo CRM records for <strong>{profile.customer_name}</strong>.
              The action is logged in the audit trail and cannot be undone here.
            </p>
            <p className="text-sm">
              Type the customer's full name to confirm:
            </p>
            <Input
              value={forgetConfirm}
              onChange={(e) => setForgetConfirm(e.target.value)}
              placeholder={profile.customer_name}
              className="h-11 rounded-md"
              data-testid="forget-confirm-input"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForgetOpen(false)}>Cancel</Button>
            <Button
              onClick={forgetCustomer}
              disabled={forgetConfirm !== profile.customer_name}
              className="bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-40"
              data-testid="forget-confirm-button"
            >
              Forget customer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Brief dialog */}
      <Dialog open={briefOpen} onOpenChange={setBriefOpen}>
        <DialogContent className="max-w-2xl rounded-sm" data-testid="ai-brief-dialog">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-[var(--vivo-gold)]" />
              AI brief · {profile?.customer_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            {briefLoading && (
              <div className="space-y-3 animate-pulse">
                <div className="h-3 w-full bg-[var(--vivo-border)] rounded" />
                <div className="h-3 w-5/6 bg-[var(--vivo-border)] rounded" />
                <div className="h-3 w-4/6 bg-[var(--vivo-border)] rounded" />
                <div className="h-3 w-3/4 bg-[var(--vivo-border)] rounded mt-4" />
                <div className="text-xs text-[var(--vivo-muted)] mt-2">Claude is reading her profile, last 10 messages, recent notes & purchases…</div>
              </div>
            )}
            {!briefLoading && brief && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="eyebrow">Summary</span>
                    {brief.urgency && (
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm font-semibold ${
                        brief.urgency === "high" ? "bg-red-50 text-red-700 border border-red-200" :
                        brief.urgency === "medium" ? "bg-amber-50 text-amber-800 border border-amber-200" :
                        "bg-emerald-50 text-emerald-800 border border-emerald-200"
                      }`} data-testid="ai-brief-urgency">{brief.urgency}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      setBriefLoading(true);
                      setBrief(null);
                      try {
                        const r = await api.get(`/customers/${id}/brief`, { params: { refresh: true } });
                        setBrief(r.data);
                      } catch { /* ignore */ }
                      setBriefLoading(false);
                    }}
                    className="text-xs text-[var(--vivo-navy)] hover:underline inline-flex items-center gap-1"
                    data-testid="ai-brief-refresh"
                    title="Force-refresh (bypasses 24h cache)"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--vivo-text)]" data-testid="ai-brief-summary">{brief.summary}</p>

                {brief.flags?.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-sm p-3" data-testid="ai-brief-flags">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-amber-700 mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Watch for
                    </div>
                    <ul className="space-y-1">
                      {brief.flags.map((f, i) => (
                        <li key={i} className="text-xs text-amber-900 flex gap-2"><span>•</span><span>{f}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                {brief.talking_points?.length > 0 && (
                  <div>
                    <div className="eyebrow mb-2">Talking points</div>
                    <ul className="space-y-2" data-testid="ai-brief-talking-points">
                      {brief.talking_points.map((tp, i) => (
                        <li key={i} className="flex gap-2 text-sm"><ChevronRight className="h-4 w-4 text-[var(--vivo-gold)] shrink-0 mt-0.5" /><span>{tp}</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                {brief.opener && (
                  <div className="bg-[var(--vivo-bg)] border border-[var(--vivo-border)] rounded-sm p-4" data-testid="ai-brief-opener">
                    <div className="flex items-center justify-between mb-2">
                      <div className="eyebrow">Ready-to-send opener</div>
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(brief.opener); toast.success("Opener copied"); }}
                        className="text-xs text-[var(--vivo-navy)] hover:underline"
                        data-testid="ai-brief-copy"
                      >Copy</button>
                    </div>
                    <p className="text-sm leading-relaxed italic">"{brief.opener}"</p>
                  </div>
                )}

                {brief.recommended_action && (
                  <div className="border-l-2 border-[var(--vivo-gold)] pl-3 py-1">
                    <div className="eyebrow">Recommended action</div>
                    <p className="text-sm mt-1 font-medium" data-testid="ai-brief-action">{brief.recommended_action}</p>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBriefOpen(false)} data-testid="ai-brief-close">Close</Button>
            {brief?.opener && (
              <Button
                onClick={() => {
                  setBriefOpen(false);
                  setMsgBody(brief.opener);
                  setMsgOpen(true);
                }}
                className="rounded-sm bg-[var(--vivo-navy)] hover:bg-[var(--vivo-navy-700)] text-white"
                data-testid="ai-brief-use-opener"
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Use this opener
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, testid }) {
  return (
    <div data-testid={testid}>
      <div className="eyebrow">{label}</div>
      <div className="font-display text-2xl mt-1 font-mono-num">{value}</div>
    </div>
  );
}

function PrefChips({ title, options, values, onToggle, testidPrefix }) {
  return (
    <Card className="vivo-card p-6 rounded-sm">
      <h3 className="font-display text-lg mb-4">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = values.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              data-testid={`${testidPrefix}-${o.toLowerCase()}`}
              className={`h-10 px-4 rounded-sm border text-sm transition-colors ${
                active
                  ? "bg-[var(--vivo-navy)] text-white border-[var(--vivo-navy)]"
                  : "bg-white text-[var(--vivo-text)] border-[var(--vivo-border)] hover:border-[var(--vivo-navy)]"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
