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
import { FiltersProvider } from "@/lib/filters";

const Shell = ({ children }) => (
  <div className="min-h-screen bg-background text-foreground" data-testid="app-shell">
    <TopNav />
    <FilterBar />
    <main className="px-6 lg:px-10 py-6 max-w-[1600px] mx-auto w-full">
      {children}
    </main>
  </div>
);

function App() {
  return (
    <div className="App">
      <FiltersProvider>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/locations" element={<Locations />} />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/footfall" element={<Footfall />} />
              <Route path="/ceo-report" element={<CEOReport />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        </BrowserRouter>
      </FiltersProvider>
    </div>
  );
}

export default App;
