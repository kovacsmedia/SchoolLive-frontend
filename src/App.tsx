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
import Tenants            from "./pages/TenantsPage";
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

// ─── Szerepkör-alapú hozzáférés ───────────────────────────────────────────────
//
// Az OPERATOR (UI-ban "Közreműködő") KIZÁRÓLAG az Üzenetek lapot érheti el –
// eszközöket, csengetési rendet, rádiót, felhasználókat nem. A navigációból
// való elrejtés (AppShell NAV_ITEMS) önmagában NEM elég: a címsorba beírt URL
// azzal még megnyitná az oldalt, ezért a route-ot is őrizni kell.
//
// FONTOS: ez kényelmi/UX-korlát, NEM biztonsági határ – a tényleges
// jogosultság-ellenőrzés a backend route-okon van (ld. requireOperatorSafe a
// devices/bells/radio/users modulokban).
const OPERATOR_HOME = "/app/messages";

function useRole(): string {
  const { state } = useAuth();
  return state.status === "authed" ? ((state.user as any)?.role ?? "") : "";
}

/** Csak a felsorolt szerepköröknek engedi a gyereket, egyébként átirányít. */
function RequireRole({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const { state } = useAuth();
  const role = useRole();
  if (state.status === "loading") return null;
  if (!allow.includes(role)) return <Navigate to={OPERATOR_HOME} replace />;
  return <>{children}</>;
}

/** Az /app kezdőlapja szerepkörtől függ: az OPERATOR-nak nincs eszköz-oldala. */
function AppHome() {
  const role = useRole();
  return <Navigate to={role === "OPERATOR" ? OPERATOR_HOME : "/app/devices"} replace />;
}

const ADMINISH = ["SUPER_ADMIN", "TENANT_ADMIN", "ORG_ADMIN"];
// Eszközök: mindenki, KIVÉVE az OPERATOR-t.
const DEVICE_ROLES = [...ADMINISH, "TEACHER"];

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
            {/* Alapértelmezett átirányítás – szerepkör-függő */}
            <Route index element={<AppHome />} />

            {/* Navigációs oldalak. Az Üzenetek MINDENKINEK elérhető, a többit
                szerepkör őrzi – az OPERATOR csak az Üzeneteket látja. */}
            <Route path="messages" element={<Messages />} />
            <Route path="devices"  element={<RequireRole allow={DEVICE_ROLES}><Devices /></RequireRole>} />
            <Route path="bells"    element={<RequireRole allow={ADMINISH}><BellSchedule /></RequireRole>} />
            <Route path="users"    element={<RequireRole allow={ADMINISH}><Users /></RequireRole>} />
            <Route path="tenants"  element={<RequireRole allow={["SUPER_ADMIN"]}><Tenants /></RequireRole>} />
          </Route>

          {/* Ismeretlen URL → főoldal */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}