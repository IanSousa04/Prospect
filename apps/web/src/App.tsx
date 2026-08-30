import { Navigate, Route, Routes } from "react-router-dom";
import Kanban from "./pages/Kanban.js";
import Atendimento from "./pages/Atendimento.js";
import Catalogo from "./pages/Catalogo.js";
import ProdutoEditor from "./pages/ProdutoEditor.js";
import Conhecimento from "./pages/Conhecimento.js";
import Clientes from "./pages/Clientes.js";
import Analytics from "./pages/Analytics.js";
import ConfiguracoesIa from "./pages/ConfiguracoesIa.js";
import WhatsApp from "./pages/WhatsApp.js";
import Login from "./pages/Login.js";
import PedidoPublico from "./publico/PedidoPublico.js";
import { useSession } from "./lib/useSession.js";
import { ToastProvider } from "./components/Toast.js";

export default function App() {
  const { session, carregando } = useSession();

  // A página pública é resolvida ANTES do gate de sessão do painel: quem
  // acessa `/p/<loja>` é o cliente final, que nunca vai ter login de painel —
  // sem esta rota antes, ele cairia na tela de e-mail e senha do atendente.
  // O `carregando` do painel também não pode segurar esta rota: o cliente não
  // deve esperar uma verificação de sessão que não é dele.
  const rotaPublica = (
    <Route path="/p/:slug" element={<PedidoPublico />} />
  );

  if (carregando) {
    return (
      <Routes>
        {rotaPublica}
        <Route path="*" element={<div style={{ padding: 24, color: "var(--text-3)" }}>Carregando…</div>} />
      </Routes>
    );
  }

  if (!session) {
    return (
      <Routes>
        {rotaPublica}
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <ToastProvider>
      <Routes>
        {rotaPublica}
        <Route path="/" element={<Kanban />} />
        <Route path="/atendimentos/:id" element={<Atendimento />} />
        <Route path="/catalogo" element={<Catalogo />} />
        <Route path="/catalogo/produtos/:id" element={<ProdutoEditor />} />
        <Route path="/conhecimento" element={<Conhecimento />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/configuracoes-ia" element={<ConfiguracoesIa />} />
        <Route path="/whatsapp" element={<WhatsApp />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}
