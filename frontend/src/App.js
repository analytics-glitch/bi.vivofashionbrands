import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AuthCallback from "@/pages/AuthCallback";
import Login from "@/pages/Login";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import CustomerSearch from "@/pages/CustomerSearch";
import CustomerProfile from "@/pages/CustomerProfile";
import LookbookBuilder from "@/pages/LookbookBuilder";
import PublicLookbook from "@/pages/PublicLookbook";
import ManagerDashboard from "@/pages/ManagerDashboard";
import Templates from "@/pages/Templates";
import AuditLog from "@/pages/AuditLog";
import Lookbooks from "@/pages/Lookbooks";
import Inbox from "@/pages/Inbox";
import Overview from "@/pages/Overview";
import FollowUps from "@/pages/FollowUps";
import DataQuality from "@/pages/DataQuality";
import Training from "@/pages/Training";
import { CohortsPage, OperationsPage } from "@/pages/InsightsPages";

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-[var(--vivo-muted)]">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/customers" element={<CustomerSearch />} />
        <Route path="/customers/:id" element={<CustomerProfile />} />
        <Route path="/lookbooks" element={<Lookbooks />} />
        <Route path="/lookbooks/new" element={<LookbookBuilder />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route path="/overview" element={user.role === "manager" ? <Overview /> : <Navigate to="/dashboard" replace />} />
        <Route path="/cohorts" element={user.role === "manager" ? <CohortsPage /> : <Navigate to="/dashboard" replace />} />
        <Route path="/operations" element={user.role === "manager" ? <OperationsPage /> : <Navigate to="/dashboard" replace />} />
        <Route path="/data-quality" element={user.role === "manager" ? <DataQuality /> : <Navigate to="/dashboard" replace />} />
        <Route path="/training" element={user.role === "manager" ? <Training /> : <Navigate to="/dashboard" replace />} />
        <Route path="/manager" element={user.role === "manager" ? <ManagerDashboard /> : <Navigate to="/dashboard" replace />} />
        <Route path="/templates" element={user.role === "manager" ? <Templates /> : <Navigate to="/dashboard" replace />} />
        <Route path="/audit" element={user.role === "manager" ? <AuditLog /> : <Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

function AppRouter() {
  const location = useLocation();
  // Synchronous auth-callback detection — must run before ProtectedRoutes
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/share/:token" element={<PublicLookbook />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Toaster position="top-right" richColors />
          <AppRouter />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
