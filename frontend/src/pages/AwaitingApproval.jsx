import React, { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Hourglass, SignOut, X } from "@phosphor-icons/react";

/**
 * Awaiting-approval screen — shown to Google OAuth first-time users
 * until an admin approves them in the Users admin page. We poll
 * /auth/me/status every 30s so the dashboard unlocks automatically
 * once the admin clicks Approve.
 */
export default function AwaitingApproval() {
  const { user, logout, checkAuth } = useAuth();
  const isRejected = (user?._restrictionReason || "").includes("rejected");

  useEffect(() => {
    if (isRejected) return;
    const t = setInterval(() => { checkAuth(); }, 30000);
    return () => clearInterval(t);
  }, [checkAuth, isRejected]);

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-gradient-to-br from-amber-50 via-white to-emerald-50" data-testid="awaiting-approval-screen">
      <div className="w-full max-w-md card-white p-7 text-center">
        <div className={`mx-auto size-14 rounded-full grid place-items-center ${isRejected ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700"}`}>
          {isRejected ? <X size={28} weight="bold" /> : <Hourglass size={28} weight="duotone" />}
        </div>
        <h1 className="font-extrabold text-[20px] mt-4 text-[#0f3d24]">
          {isRejected ? "Access not granted" : "Awaiting admin approval"}
        </h1>
        <p className="text-[13px] text-muted mt-2">
          {isRejected ? (
            <>
              Your account request was declined. Please reach out to your
              administrator if you believe this is a mistake.
            </>
          ) : (
            <>
              Hi {user?.name || user?.email}, an admin needs to approve your
              account before you can access the dashboard. We'll unlock it
              automatically the moment that happens.
            </>
          )}
        </p>
        <div className="mt-4 text-[11.5px] text-muted bg-panel border border-border rounded-md px-3 py-2 inline-block">
          Signed in as <span className="font-mono">{user?.email}</span> · default role: <b>store manager</b>
        </div>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => checkAuth()}
            className="text-[12px] font-semibold text-brand-deep border border-brand-deep/30 hover:bg-brand-deep/5 px-3 py-1.5 rounded-md"
            data-testid="awaiting-approval-recheck"
          >
            Check again
          </button>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-rose-700 border border-rose-300 hover:bg-rose-50 px-3 py-1.5 rounded-md"
            data-testid="awaiting-approval-logout"
          >
            <SignOut size={12} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
