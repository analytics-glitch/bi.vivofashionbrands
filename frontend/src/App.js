import React, { useEffect, useRef } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TopNav from "@/components/Sidebar";
import FilterBar from "@/components/FilterBar";
import Overview from "@/pages/Overview";
import Locations from "@/pages/Locations";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import Exports from "@/pages/Exports";
import Customers from "@/pages/Customers";
import Footfall from "@/pages/Footfall";
import CEOReport from "@/pages/CEOReport";
import ReOrder from "@/pages/ReOrder";
import IBT from "@/pages/IBT";
import Pricing from "@/pages/Pricing";
import DataQuality from "@/pages/DataQuality";
import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import Users from "@/pages/Users";
import ActivityLogs from "@/pages/ActivityLogs";
import { FiltersProvider } from "@/lib/filters";
import { AuthProvider } from "@/lib/auth";
import ProtectedRoute from "@/components/ProtectedRoute";
import ChatWidget from "@/components/ChatWidget";
import GlobalSearch from "@/components/GlobalSearch";
import { Toaster } from "@/components/ui/sonner";

const Shell = ({ children }) => {
  const navRef = useRef(null);
  // Expose the actual rendered navbar+filter-bar height as a CSS variable so
  // sticky table headers across the app can `top: var(--app-navbar-h)`
  // and never slide under the navbar. Recalculates on resize and on
  // route-change-induced reflows.
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--app-navbar-h", `${Math.round(h)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => { ro.disconnect(); window.removeEventListener("resize", apply); };
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="app-shell">
      <div ref={navRef} className="sticky top-0 z-40">
        <TopNav />
        <FilterBar />
      </div>
      <main className="px-3 sm:px-5 lg:px-10 pt-4 pb-6 max-w-[1600px] mx-auto w-full">
        {children}
      </main>
      <ChatWidget />
      <GlobalSearch />
    </div>
  );
};

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
              <Route path="/exports" element={<ProtectedShell><Exports /></ProtectedShell>} />
              <Route path="/customers" element={<ProtectedShell><Customers /></ProtectedShell>} />
              <Route path="/footfall" element={<ProtectedShell><Footfall /></ProtectedShell>} />
              <Route path="/ceo-report" element={<ProtectedShell><CEOReport /></ProtectedShell>} />
              <Route path="/re-order" element={<ProtectedShell><ReOrder /></ProtectedShell>} />
              <Route path="/ibt" element={<ProtectedShell><IBT /></ProtectedShell>} />
              <Route path="/pricing" element={<ProtectedShell><Pricing /></ProtectedShell>} />
              <Route path="/data-quality" element={<ProtectedShell><DataQuality /></ProtectedShell>} />
              <Route path="/admin/users" element={<ProtectedShell adminOnly><Users /></ProtectedShell>} />
              <Route path="/admin/activity-logs" element={<ProtectedShell adminOnly><ActivityLogs /></ProtectedShell>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </FiltersProvider>
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </div>
  );
}

export default App;
