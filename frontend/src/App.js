import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TopNav from "@/components/Sidebar";
import FilterBar from "@/components/FilterBar";
import Overview from "@/pages/Overview";
import Locations from "@/pages/Locations";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import Customers from "@/pages/Customers";
import Footfall from "@/pages/Footfall";
import CEOReport from "@/pages/CEOReport";
import ReOrder from "@/pages/ReOrder";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Users from "@/pages/Users";
import ActivityLogs from "@/pages/ActivityLogs";
import { FiltersProvider } from "@/lib/filters";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import ChatWidget from "@/components/ChatWidget";

const Shell = ({ children }) => (
  <div className="min-h-screen bg-background text-foreground" data-testid="app-shell">
    <TopNav />
    <FilterBar />
    <main className="px-3 sm:px-5 lg:px-10 pt-[160px] sm:pt-[140px] pb-6 max-w-[1600px] mx-auto w-full">
      {children}
    </main>
    <ChatWidget />
  </div>
);

const ProtectedShell = ({ children, adminOnly = false }) => (
  <ProtectedRoute adminOnly={adminOnly}>
    <Shell>{children}</Shell>
  </ProtectedRoute>
);

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <FiltersProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/" element={<ProtectedShell><Overview /></ProtectedShell>} />
              <Route path="/locations" element={<ProtectedShell><Locations /></ProtectedShell>} />
              <Route path="/products" element={<ProtectedShell><Products /></ProtectedShell>} />
              <Route path="/inventory" element={<ProtectedShell><Inventory /></ProtectedShell>} />
              <Route path="/customers" element={<ProtectedShell><Customers /></ProtectedShell>} />
              <Route path="/footfall" element={<ProtectedShell><Footfall /></ProtectedShell>} />
              <Route path="/ceo-report" element={<ProtectedShell><CEOReport /></ProtectedShell>} />
              <Route path="/re-order" element={<ProtectedShell><ReOrder /></ProtectedShell>} />
              <Route path="/admin/users" element={<ProtectedShell adminOnly><Users /></ProtectedShell>} />
              <Route path="/admin/activity-logs" element={<ProtectedShell adminOnly><ActivityLogs /></ProtectedShell>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </FiltersProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
