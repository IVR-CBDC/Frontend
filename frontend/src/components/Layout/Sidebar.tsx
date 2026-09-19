import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Дашборд", exact: true },
  { to: "/deals/new", label: "Новая сделка" },
];

export function Sidebar() {
  return (
    <aside
      style={{
        background: "var(--ink-900)",
        color: "white",
        padding: "24px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>Alfa Global</div>
        <div className="mono" style={{ fontSize: 11.5, color: "#9fb3cf", marginTop: 2 }}>
          CBDC HUB · юр. лицо
        </div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            style={({ isActive }) => ({
              padding: "9px 12px",
              borderRadius: 3,
              fontSize: 13.5,
              color: isActive ? "white" : "#b7c4d9",
              background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
              borderLeft: isActive ? "2px solid var(--cyan-500)" : "2px solid transparent",
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ marginTop: "auto", fontSize: 11.5, color: "#7c8fac", lineHeight: 1.6 }}>
        Сопровождение внешнеэкономических сделок от начала до завершения.
      </div>
    </aside>
  );
}
