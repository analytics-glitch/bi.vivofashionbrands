/**
 * Role → allowed page IDs mapping. Mirrors `auth.py::ROLE_PAGES` so the
 * frontend can hide nav items and gate routes without a round-trip on every
 * navigation. The backend remains the source of truth — when /auth/me
 * returns an `allowed_pages` array we honour that; otherwise we fall back
 * to this static map.
 *
 * Page IDs match the `id` field on `tabs` in `components/Sidebar.jsx`. Admin-
 * only pages use the `admin-` prefix.
 */

const VIEWER = ["overview", "locations", "footfall", "customers", "customer-details", "feedback"];
// Store managers see ONLY: Locations (retail), Exports (inventory only),
// IBT, Feedback. Per-page filters enforced inside the page components.
const STORE_MANAGER = ["locations", "ibt", "exports", "feedback", "replenishments"];
const ANALYST = [...VIEWER, "inventory", "re-order", "ibt", "products", "pricing", "data-quality", "allocations", "replenishments"];
const EXEC = [...ANALYST, "ceo-report", "targets", "exports"];
const ADMIN = [...EXEC, "admin-users", "admin-activity-logs", "admin-feedback"];

export const ROLE_PAGES = {
  viewer: VIEWER,
  store_manager: STORE_MANAGER,
  analyst: ANALYST,
  exec: EXEC,
  admin: ADMIN,
};

/**
 * Returns true when the given role / user is allowed to see `pageId`. The
 * `user` arg is the object returned by /auth/me; if it carries an
 * `allowed_pages` array we honour that override.
 */
export const canAccessPage = (user, pageId) => {
  if (!user) return false;
  if (Array.isArray(user.allowed_pages)) return user.allowed_pages.includes(pageId);
  const role = (user.role || "viewer").toLowerCase();
  const pages = ROLE_PAGES[role] || ROLE_PAGES.viewer;
  return pages.includes(pageId);
};

/**
 * The first page a freshly-redirected user can land on. Always picked from
 * their allowed set so we never bounce them straight back to "no access".
 */
export const homePageFor = (user) => {
  if (!user) return "/login";
  if (canAccessPage(user, "overview")) return "/";
  const role = (user.role || "viewer").toLowerCase();
  const pages = (Array.isArray(user.allowed_pages) ? user.allowed_pages : ROLE_PAGES[role]) || ["overview"];
  const first = pages[0] || "overview";
  // Map page id → route. Mirrors App.js routes.
  const routeMap = {
    "overview": "/",
    "locations": "/locations",
    "footfall": "/footfall",
    "customers": "/customers",
    "customer-details": "/customer-details",
    "products": "/products",
    "inventory": "/inventory",
    "re-order": "/re-order",
    "ibt": "/ibt",
    "pricing": "/pricing",
    "ceo-report": "/ceo-report",
    "targets": "/targets",
    "data-quality": "/data-quality",
    "exports": "/exports",
    "feedback": "/feedback",
    "allocations": "/allocations",
    "replenishments": "/replenishments",
    "admin-users": "/admin/users",
    "admin-activity-logs": "/admin/activity-logs",
    "admin-feedback": "/admin/feedback",
  };
  return routeMap[first] || "/";
};
