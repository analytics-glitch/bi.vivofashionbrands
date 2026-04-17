import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Overview from "@/pages/Overview";
import Locations from "@/pages/Locations";
import Inventory from "@/pages/Inventory";
import SOR from "@/pages/SOR";
import CEOReport from "@/pages/CEOReport";
import { FiltersProvider } from "@/lib/filters";

const Shell = ({ children }) => (
  <div
    className="flex min-h-screen bg-background text-foreground"
    data-testid="app-shell"
  >
    <Sidebar />
    <main className="flex-1 min-w-0 px-5 md:px-8 lg:px-12 py-8 max-w-[1600px] mx-auto w-full">
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
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/sor" element={<SOR />} />
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
