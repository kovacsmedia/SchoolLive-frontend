import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function RequireAuth() {
  const { state } = useAuth();
  const loc = useLocation();

  if (state.status === "loading") return <div>Loading session…</div>;
  if (state.status === "guest") return <Navigate to="/login" replace state={{ from: loc.pathname }} />;

  return <Outlet />;
}