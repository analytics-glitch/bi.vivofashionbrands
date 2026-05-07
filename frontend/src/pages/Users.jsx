import React, { useCallback, useEffect, useState } from "react";
import { api, fmtDate } from "@/lib/api";
import { SectionTitle, Loading, ErrorBox } from "@/components/common";
import { UserPlus, Trash, ShieldCheck, Eye, X } from "@phosphor-icons/react";
import SortableTable from "@/components/SortableTable";
import { useAuth } from "@/lib/auth";

const Users = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "viewer" });
  const [formErr, setFormErr] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get("/admin/users")
      .then((r) => setUsers(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const createUser = async (e) => {
    e.preventDefault();
    setFormErr(null);
    try {
      await api.post("/admin/users", form);
      setForm({ email: "", name: "", password: "", role: "viewer" });
      setCreating(false);
      load();
    } catch (err) {
      setFormErr(err?.response?.data?.detail || err.message);
    }
  };

  const updateRole = async (u, role) => {
    try {
      await api.patch(`/admin/users/${u.user_id}`, { role });
      load();
    } catch (e) { alert(e?.response?.data?.detail || e.message); }
  };

  const toggleActive = async (u) => {
    try {
      await api.patch(`/admin/users/${u.user_id}`, { active: !u.active });
      load();
    } catch (e) { alert(e?.response?.data?.detail || e.message); }
  };

  const deleteUser = async (u) => {
    if (!confirm(`Delete user ${u.email}?`)) return;
    try {
      await api.delete(`/admin/users/${u.user_id}`);
      load();
    } catch (e) { alert(e?.response?.data?.detail || e.message); }
  };

  const setStatus = async (u, status) => {
    try {
      await api.patch(`/admin/users/${u.user_id}`, { status });
      load();
    } catch (e) { alert(e?.response?.data?.detail || e.message); }
  };

  // Pending users — newest first. Surfaces as a banner above the
  // standard users table so the admin can approve/reject in one click.
  const pendingUsers = users.filter((u) => (u.status || "active") === "pending");

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Admin · Users</div>
          <h1 className="font-extrabold tracking-tight mt-1 leading-[1.15] line-clamp-2 text-[clamp(18px,2.2vw,26px)]">Users</h1>
          <p className="text-muted text-[13px] mt-0.5">
            Manage who can access the dashboard. Google sign-in auto-creates viewer accounts for whitelisted domains.
          </p>
        </div>
        <button
          data-testid="add-user-btn"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand text-white font-semibold text-[13px] hover:bg-brand-deep"
          onClick={() => setCreating(!creating)}
        >
          <UserPlus size={14} weight="bold" />
          {creating ? "Cancel" : "Add email/password user"}
        </button>
      </div>

      {creating && (
        <form onSubmit={createUser} className="card-white p-5 grid grid-cols-1 sm:grid-cols-5 gap-3" data-testid="create-user-form">
          <input className="col-span-2 px-3 py-2 rounded-lg border border-border text-[13px]" placeholder="Email" type="email" required
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="create-user-email" />
          <input className="px-3 py-2 rounded-lg border border-border text-[13px]" placeholder="Name" required
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="create-user-name" />
          <input className="px-3 py-2 rounded-lg border border-border text-[13px]" placeholder="Password (min 8)" type="password" required minLength={8}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="create-user-password" />
          <select className="px-3 py-2 rounded-lg border border-border text-[13px]" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="create-user-role">
            <option value="viewer">Viewer — PII masked</option>
            <option value="store_manager">Store Manager — names visible</option>
            <option value="analyst">Analyst — full PII (logged)</option>
            <option value="exec">Exec — full PII (logged)</option>
            <option value="admin">Admin — full access</option>
          </select>
          {formErr && <div className="col-span-full text-danger text-[12px]">{formErr}</div>}
          <button type="submit" className="col-span-full sm:col-span-1 py-2 rounded-lg bg-brand text-white font-semibold text-[13px]" data-testid="create-user-submit">Create</button>
        </form>
      )}

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

      {!loading && !error && pendingUsers.length > 0 && (
        <div className="card-white p-4 border-l-4 border-l-amber-400 bg-amber-50/50" data-testid="pending-approvals-card">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10.5px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
              {pendingUsers.length} pending
            </span>
            <h3 className="font-extrabold text-[14px] text-[#7c2d12]">New sign-ups awaiting approval</h3>
          </div>
          <p className="text-[12px] text-muted mb-3">
            These users signed in via Google for the first time. Default role is <b>store manager</b> — adjust below before approving if needed.
          </p>
          <ul className="space-y-2">
            {pendingUsers.map((u) => (
              <li
                key={u.user_id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white rounded-md border border-amber-200 px-3 py-2"
                data-testid={`pending-user-${u.email}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[12.5px] truncate">{u.name || u.email}</div>
                  <div className="text-[11px] text-muted truncate">{u.email}</div>
                </div>
                <select
                  className="px-2 py-1 rounded-md border border-border text-[11.5px]"
                  value={u.role}
                  onChange={(e) => updateRole(u, e.target.value)}
                  data-testid={`pending-role-${u.email}`}
                >
                  <option value="viewer">Viewer</option>
                  <option value="store_manager">Store Manager</option>
                  <option value="analyst">Analyst</option>
                  <option value="exec">Exec</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => setStatus(u, "active")}
                  className="text-[11.5px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-md"
                  data-testid={`pending-approve-${u.email}`}
                >
                  Approve
                </button>
                <button
                  onClick={() => setStatus(u, "rejected")}
                  className="text-[11.5px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 px-2.5 py-1 rounded-md"
                  data-testid={`pending-reject-${u.email}`}
                >
                  Reject
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && !error && (
        <div className="card-white p-5" data-testid="users-table-wrap">
          <SectionTitle title={`${users.length} users`} subtitle="Admins can manage all users; viewers are read-only" />
          <SortableTable
            testId="users-table"
            exportName="users.csv"
            initialSort={{ key: "created_at", dir: "desc" }}
            columns={[
              { key: "email", label: "Email", align: "left", render: (r) => (<span className="font-mono text-[12px]">{r.email}</span>) },
              { key: "name", label: "Name", align: "left", render: (r) => r.name || "—" },
              {
                key: "role",
                label: "Role",
                align: "left",
                render: (r) => {
                  const cls = r.role === "admin" ? "pill-green"
                    : r.role === "exec" ? "pill-green"
                    : r.role === "analyst" ? "pill-amber"
                    : r.role === "store_manager" ? "pill-amber"
                    : "pill-neutral";
                  const icon = (r.role === "admin" || r.role === "exec") ? <ShieldCheck size={11} /> : <Eye size={11} />;
                  return (
                    <span className={`${cls} inline-flex items-center gap-1`}>
                      {icon}{r.role}
                    </span>
                  );
                },
              },
              {
                key: "auth_method",
                label: "Method",
                align: "left",
                render: (r) => <span className="pill-neutral">{r.auth_method || "—"}</span>,
              },
              { key: "active", label: "Status", align: "left", render: (r) => (
                <span className={r.active ? "pill-green" : "pill-red"}>{r.active ? "active" : "disabled"}</span>
              ) },
              {
                key: "last_login_at",
                label: "Last Login",
                align: "left",
                render: (r) => r.last_login_at ? fmtDate(r.last_login_at) : "—",
              },
              {
                key: "actions",
                label: "",
                align: "right",
                sortable: false,
                render: (r) => (
                  <div className="flex justify-end gap-1">
                    <select
                      className="text-[11px] px-1.5 py-1 rounded border border-border"
                      value={r.role}
                      onChange={(e) => updateRole(r, e.target.value)}
                      data-testid={`role-select-${r.user_id}`}
                      disabled={r.user_id === user.user_id}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="store_manager">Store Manager</option>
                      <option value="analyst">Analyst</option>
                      <option value="exec">Exec</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className={`text-[11px] px-1.5 py-1 rounded border ${r.active ? "border-amber text-amber" : "border-brand text-brand"}`}
                      onClick={() => toggleActive(r)}
                      disabled={r.user_id === user.user_id}
                      data-testid={`toggle-active-${r.user_id}`}
                    >
                      {r.active ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="text-[11px] px-1.5 py-1 rounded border border-danger text-danger disabled:opacity-40"
                      onClick={() => deleteUser(r)}
                      disabled={r.user_id === user.user_id}
                      data-testid={`delete-user-${r.user_id}`}
                    >
                      <Trash size={11} />
                    </button>
                  </div>
                ),
              },
            ]}
            rows={users}
          />
        </div>
      )}
    </div>
  );
};

export default Users;
