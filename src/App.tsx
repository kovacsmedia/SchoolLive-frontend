// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";

import Landing            from "./pages/Landing";
import Login              from "./pages/Login";
import AppShell           from "./pages/AppShell";
import Devices            from "./pages/Devices";
import Messages           from "./pages/Messages";
import BellSchedule       from "./pages/BellSchedule";
import Users              from "./pages/Users";
import Tenants            from "./pages/Tenants";
import VirtualPlayer      from "./pages/VirtualPlayer";
import VirtualPlayerLegacy from "./pages/VirtualPlayerLegacy";

// ─── Védett route helper ──────────────────────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  if (state.status !== "authed")  return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// ─── PLAYER role → automatikusan /player-re irányít ──────────────────────────
function RequireAuthOrPlayer({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  if (state.status === "loading") return null;
  if (state.status !== "authed")  return <Navigate to="/login" replace />;
  const role = (state.user as any)?.role;
  if (role === "PLAYER") return <Navigate to="/player" replace />;
  return <>{children}</>;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Publikus oldalak */}
          <Route path="/"      element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* PLAYER role → virtuális lejátszó (modern) */}
          <Route path="/player" element={
            <RequireAuth>
              <VirtualPlayer />
            </RequireAuth>
          } />

          {/* PLAYER role → legacy lejátszó (Android 4.1+) */}
          <Route path="/player-legacy" element={
            <RequireAuth>
              <VirtualPlayerLegacy />
            </RequireAuth>
          } />

          {/* Védett admin shell */}
          <Route path="/app" element={
            <RequireAuthOrPlayer>
              <AppShell />
            </RequireAuthOrPlayer>
          }>
            {/* Alapértelmezett átirányítás */}
            <Route index element={<Navigate to="/app/devices" replace />} />

            {/* Navigációs oldalak */}
            <Route path="devices"  element={<Devices />} />
            <Route path="messages" element={<Messages />} />
            <Route path="bells"    element={<BellSchedule />} />
            <Route path="users"    element={<Users />} />
            <Route path="tenants"  element={<Tenants />} />
          </Route>

          {/* Ismeretlen URL → főoldal */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}