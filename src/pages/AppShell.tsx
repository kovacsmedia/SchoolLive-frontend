import { Link, Outlet } from "react-router-dom";

export default function AppShell() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "system-ui" }}>
      <aside style={{ width: 240, borderRight: "1px solid #ddd", padding: 16 }}>
        <h3>SchoolLive</h3>
        <nav style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <Link to="/app/devices">Eszközök</Link>
          <Link to="/app/messages">Üzenetek</Link>
          {/* később role alapján */}
        </nav>
      </aside>

      <main style={{ flex: 1, padding: 24 }}>
        <Outlet />
      </main>
    </div>
  );
}