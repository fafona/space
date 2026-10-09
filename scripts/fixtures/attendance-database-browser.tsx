// Select real existing entry components without changing their implementation.
// Auth/enterprise bootstrap are test transports; attendance runs real handlers/SQL.
if (window.location.pathname === "/owner") {
  void import("./attendance-owner-entry-browser");
} else {
  void import("./attendance-portal-browser");
}
export {};
