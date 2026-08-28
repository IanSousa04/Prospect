import { Navigate, Route, Routes } from "react-router-dom";
import Kanban from "./pages/Kanban.js";
import Atendimento from "./pages/Atendimento.js";
import Catalogo from "./pages/Catalogo.js";
import ProdutoEditor from "./pages/ProdutoEditor.js";
import Clientes from "./pages/Clientes.js";
import Analytics from "./pages/Analytics.js";
import ConfiguracoesIa from "./pages/ConfiguracoesIa.js";
import WhatsApp from "./pages/WhatsApp.js";
import Login from "./pages/Login.js";
import { useSession } from "./lib/useSession.js";

export default function App() {
  const { session, carregando } = useSession();

  if (carregando) {
    return <div style={{ padding: 24, color: "var(--text-3)" }}>Carregando…</div>;
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Kanban />} />
      <Route path="/atendimentos/:id" element={<Atendimento />} />
      <Route path="/catalogo" element={<Catalogo />} />
      <Route path="/catalogo/produtos/:id" element={<ProdutoEditor />} />
      <Route path="/clientes" element={<Clientes />} />
      <Route path="/analytics" element={<Analytics />} />
      <Route path="/configuracoes-ia" element={<ConfiguracoesIa />} />
      <Route path="/whatsapp" element={<WhatsApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
