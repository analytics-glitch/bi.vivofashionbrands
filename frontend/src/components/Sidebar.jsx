import React from "react";
import { NavLink } from "react-router-dom";
import {
  ChartPieSlice,
  MapPin,
  Package,
  Tag,
  Users,
  FileText,
  Footprints,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { useFilters } from "@/lib/filters";

const tabs = [
  { to: "/", label: "Overview", icon: ChartPieSlice, id: "overview" },
  { to: "/locations", label: "Locations", icon: MapPin, id: "locations" },
  { to: "/footfall", label: "Footfall", icon: Footprints, id: "footfall" },
  { to: "/products", label: "Products", icon: Tag, id: "products" },
  { to: "/inventory", label: "Inventory", icon: Package, id: "inventory" },
  { to: "/customers", label: "Customers", icon: Users, id: "customers" },
  { to: "/ceo-report", label: "CEO Report", icon: FileText, id: "ceo-report" },
];

const relativeTime = (d) => {
  if (!d) return "—";
  const diff = Math.floor((new Date() - d) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
};

const TopNav = () => {
  const { lastUpdated, refresh } = useFilters();
  // Force the relative-time label to re-render every 30s.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <nav
      className="sticky-nav px-6 lg:px-10 py-3 flex items-center justify-between gap-6 no-print"
      data-testid="top-nav"
    >
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-brand text-white grid place-items-center font-extrabold text-[15px] shadow-sm">
          V
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-bold tracking-tight text-foreground">
            Vivo Fashion Group
          </div>
          <div className="text-[10.5px] text-muted uppercase tracking-wider">
            BI · East Africa
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.id}
            to={t.to}
            end={t.to === "/"}
            data-testid={`nav-${t.id}`}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-brand text-white shadow-sm"
                  : "text-foreground/70 hover:bg-panel hover:text-foreground"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <t.icon size={15} weight={isActive ? "fill" : "regular"} />
                <span>{t.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>

      <div className="flex items-center gap-2 text-[11.5px] text-muted">
        <span className="hidden md:inline" data-testid="last-updated">
          Updated {relativeTime(lastUpdated)}
        </span>
        <button
          type="button"
          onClick={refresh}
          data-testid="refresh-data-btn"
          className="p-1.5 rounded-lg hover:bg-panel text-foreground/70 hover:text-brand transition-colors"
          title="Refresh data from API"
        >
          <ArrowClockwise size={15} weight="bold" />
        </button>
      </div>
    </nav>
  );
};

export default TopNav;
