import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { canAccessPage, homePageFor } from "@/lib/permissions";
import AwaitingApproval from "@/pages/AwaitingApproval";

/**
 * Gate that wraps every authenticated route. Four layers:
 *   1. Session check — bounce to /login if no user.
 *   2. Pending/rejected status — render AwaitingApproval screen.
 *   3. `adminOnly` legacy flag — admin-only routes.
 *   4. `pageId` — role-based page access via `lib/permissions.js`. When the
 *      current user can't access the page, we redirect to their home page
 *      (the first page their role CAN access) so they never land on a
 *      flashing 403 dead-end.
 */
export const ProtectedRoute = ({ children, adminOnly = false, pageId }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading || user === null) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-muted text-[13px] animate-pulse" data-testid="auth-checking">Checking session…</div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Pending / rejected accounts get the awaiting-approval screen on
  // every protected route. Logout button + 30 s status poll lives in
  // that component.
  if (user._restricted) {
    return <AwaitingApproval />;
  }
  if (adminOnly && user.role !== "admin") {
    return <Navigate to={homePageFor(user)} replace />;
  }
  if (pageId && !canAccessPage(user, pageId)) {
    return <Navigate to={homePageFor(user)} replace />;
  }
  return children;
};

export default ProtectedRoute;
