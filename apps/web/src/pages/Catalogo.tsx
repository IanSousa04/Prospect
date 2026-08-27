import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Categoria, Produto, StatusProduto } from "@prospect/shared";
import { api } from "../lib/api.js";
import Topbar from "../components/Topbar.js";
import "./Catalogo.css";

type ProdutoComCategoria = Produto & { categoria: Pick<Categoria, "id" | "nome"> | null };

const STATUS_DOT: Record<StatusProduto, string> = {
  ativo: "var(--blue)",
  rascunho: "var(--amber)",
  arquivado: "var(--gray)",
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const IconSearch = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
const IconPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function Catalogo() {
  const [produtos, setProdutos] = useState<ProdutoComCategoria[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"todos" | StatusProduto>("todos");
  const [carregando, setCarregando] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listarProdutos()
      .then(setProdutos)
      .finally(() => setCarregando(false));
  }, []);

  const filtrados = useMemo(() => {
    return produtos.filter((p) => {
      if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
      if (busca.trim() && !p.nome.toLowerCase().includes(busca.trim().toLowerCase())) return false;
      return true;
    });
  }, [produtos, busca, filtroStatus]);

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, { nome: string; itens: ProdutoComCategoria[] }>();
    for (const p of filtrados) {
      const chave = p.categoria?.id ?? "sem-categoria";
      const nome = p.categoria?.nome ?? "Sem categoria";
      if (!grupos.has(chave)) grupos.set(chave, { nome, itens: [] });
      grupos.get(chave)!.itens.push(p);
    }
    return Array.from(grupos.values());
  }, [filtrados]);

  if (carregando) {
    return <div className="empty-state">Carregando catálogo…</div>;
  }

  return (
    <div className="catalogo-page">
      <Topbar />

      <div className="page-header">
        <div>
          <p className="page-title">Catálogo</p>
          <p className="page-sub">{produtos.length} produtos cadastrados</p>
        </div>
        <div className="toolbar">
          <div className="search-box">
            {IconSearch}
            <input placeholder="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          {(["todos", "ativo", "rascunho", "arquivado"] as const).map((s) => (
            <div
              key={s}
              className={`chip ${filtroStatus === s ? "active" : ""}`}
              onClick={() => setFiltroStatus(s)}
            >
              {s === "todos" ? "Todos" : s.charAt(0).toUpperCase() + s.slice(1)}
            </div>
          ))}
          <button className="btn-primary" onClick={() => navigate("/catalogo/produtos/novo")}>
            {IconPlus}
            Novo produto
          </button>
        </div>
      </div>

      <div className="catalogo-scroll">
        {porCategoria.length === 0 && <div className="empty-state">Nenhum produto encontrado.</div>}

        {porCategoria.map((grupo) => (
          <div className="categoria-grupo" key={grupo.nome}>
            <div className="categoria-titulo">
              {grupo.nome}
              <span className="categoria-count">{grupo.itens.length}</span>
            </div>
            <div className="produtos-grid">
              {grupo.itens.map((p) => (
                <button
                  key={p.id}
                  className="produto-card"
                  onClick={() => navigate(`/catalogo/produtos/${p.id}`)}
                >
                  <div className="produto-top">
                    <div>
                      <div className="produto-nome">{p.nome}</div>
                      {p.tipo === "combo" && <div className="produto-tipo-combo">Combo</div>}
                    </div>
                    <div className="status-dot" style={{ background: STATUS_DOT[p.status] }} />
                  </div>
                  <div className="produto-desc">{p.descricao_comercial || p.descricao || "Sem descrição"}</div>
                  <div className="produto-bottom">
                    <div className="produto-preco">
                      {p.preco_promocional && (
                        <span className="produto-preco-promo">{currency.format(p.preco)}</span>
                      )}
                      {currency.format(p.preco_promocional ?? p.preco)}
                    </div>
                    {!p.disponivel && <div className="produto-indisponivel">Indisponível</div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
