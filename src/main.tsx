import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import AppShell from "./pages/AppShell";
import Devices from "./pages/Devices";
import Messages from "./pages/Messages";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="/app/devices" replace />} />
          <Route path="devices" element={<Devices />} />
          <Route path="messages" element={<Messages />} />
        </Route>

        <Route path="*" element={<div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>404</h1>
        <p>Ismeretlen útvonal.</p>
        </div>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);