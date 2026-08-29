import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AppShell from "./pages/AppShell";
import Devices from "./pages/Devices";
import Messages from "./pages/Messages";
import Users from "./pages/Users";
import TenantsPage from "./pages/TenantsPage";
import BellSchedule from "./pages/BellSchedule";
import SchoolRadio from "./pages/SchoolRadio";
import VirtualPlayer from "./pages/VirtualPlayer";
import "./index.css";
import "./i18n";

import { AuthProvider } from "./auth/AuthContext";
import RequireAuth from "./auth/RequireAuth";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* 🔒 PROTECTED ZÓNA */}
          <Route element={<RequireAuth />}>
            {/* PLAYER role → /player */}
            <Route path="/player" element={<VirtualPlayer />} />

            {/* Admin/user szerepkörök → /app */}
            <Route path="/app" element={<AppShell />}>
              <Route index element={<Navigate to="/app/devices" replace />} />
              <Route path="devices"  element={<Devices />} />
              <Route path="messages" element={<Messages />} />
              <Route path="radio"    element={<SchoolRadio />} />
              <Route path="bells"    element={<BellSchedule />} />
              <Route path="users"    element={<Users />} />
              <Route path="tenants"  element={<TenantsPage />} />
            </Route>
          </Route>

          {/* 404 */}
          <Route
            path="*"
            element={
              <div style={{ padding: 24, fontFamily: "system-ui" }}>
                <h1>404</h1>
                <p>Ismeretlen útvonal.</p>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);