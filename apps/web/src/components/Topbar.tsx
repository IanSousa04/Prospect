import { NavLink } from "react-router-dom";
import "./Topbar.css";

const IconChat = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const IconCatalogo = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="7" height="7" rx="1.5" />
    <rect x="14" y="4" width="7" height="7" rx="1.5" />
    <rect x="3" y="15" width="7" height="7" rx="1.5" />
    <rect x="14" y="15" width="7" height="7" rx="1.5" />
  </svg>
);

const IconClientes = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c0-3.4 2.5-6 5.5-6s5.5 2.6 5.5 6" />
    <circle cx="17" cy="8.5" r="2.3" />
    <path d="M15.8 14.3c2.5.3 4.7 2.7 4.7 5.7" />
  </svg>
);

const IconAnalytics = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20V10M12 20V4M20 20v-7" />
  </svg>
);

const IconIa = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </svg>
);

const IconWhatsapp = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="14" rx="3" />
    <path d="M8 21l3.5-4h1L16 21" />
    <circle cx="9" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export default function Topbar() {
  return (
    <div className="topbar">
      <div className="workspace">
        <div className="workspace-mark">BH</div>
        <div className="workspace-name">Burger House</div>
      </div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          {IconChat}
          Atendimentos
        </NavLink>
        <NavLink to="/catalogo" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          {IconCatalogo}
          Catálogo
        </NavLink>
        <NavLink to="/clientes" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          {IconClientes}
          Clientes
        </NavLink>
        <NavLink to="/analytics" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          {IconAnalytics}
          Analytics
        </NavLink>
        <NavLink to="/configuracoes-ia" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          {IconIa}
          IA
        </NavLink>
        <NavLink to="/whatsapp" className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          {IconWhatsapp}
          WhatsApp
        </NavLink>
      </nav>
      <div style={{ width: 22 }} />
    </div>
  );
}
