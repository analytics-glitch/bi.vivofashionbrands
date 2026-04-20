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

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow">Admin · Users</div>
          <h1 className="font-extrabold text-[22px] sm:text-[28px] tracking-tight mt-1">Users</h1>
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
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          {formErr && <div className="col-span-full text-danger text-[12px]">{formErr}</div>}
          <button type="submit" className="col-span-full sm:col-span-1 py-2 rounded-lg bg-brand text-white font-semibold text-[13px]" data-testid="create-user-submit">Create</button>
        </form>
      )}

      {loading && <Loading />}
      {error && <ErrorBox message={error} />}

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
                render: (r) => (
                  <span className={`pill-${r.role === "admin" ? "green" : "neutral"} inline-flex items-center gap-1`}>
                    {r.role === "admin" ? <ShieldCheck size={11} /> : <Eye size={11} />}{r.role}
                  </span>
                ),
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
