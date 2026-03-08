// src/auth/RequireAuth.tsx

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function RequireAuth() {
  const { state } = useAuth();
  const loc = useLocation();

  if (state.status === "loading") return <div>Loading session…</div>;
  if (state.status === "guest")   return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  // PLAYER role → kizárólag a /player oldalra mehet
  const role = (state.user as any)?.role ?? "";
  if (role === "PLAYER" && !loc.pathname.startsWith("/player")) {
    return <Navigate to="/player" replace />;
  }

  // Nem PLAYER role → nem mehet a /player oldalra
  if (role !== "PLAYER" && loc.pathname.startsWith("/player")) {
    return <Navigate to="/app/devices" replace />;
  }

  return <Outlet />;
}