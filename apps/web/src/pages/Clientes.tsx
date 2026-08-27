import { useEffect, useMemo, useState } from "react";
import type { ClienteComMetricas } from "@prospect/shared";
import { api } from "../lib/api.js";
import Topbar from "../components/Topbar.js";
import "./Clientes.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function Clientes() {
  const [clientes, setClientes] = useState<ClienteComMetricas[]>([]);
  const [filtro, setFiltro] = useState<"todos" | "reativar">("todos");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    api
      .listarClientes()
      .then(setClientes)
      .finally(() => setCarregando(false));
  }, []);

  const filtrados = useMemo(
    () => (filtro === "reativar" ? clientes.filter((c) => c.para_reativar) : clientes),
    [clientes, filtro],
  );
  const totalParaReativar = useMemo(() => clientes.filter((c) => c.para_reativar).length, [clientes]);

  if (carregando) {
    return <div className="empty-state">Carregando clientes…</div>;
  }

  return (
    <div className="clientes-page">
      <Topbar />

      <div className="page-header">
        <div>
          <p className="page-title">Clientes</p>
          <p className="page-sub">{clientes.length} clientes cadastrados</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div className={`chip ${filtro === "todos" ? "active" : ""}`} onClick={() => setFiltro("todos")}>
            Todos <span className="mono">{clientes.length}</span>
          </div>
          <div className={`chip ${filtro === "reativar" ? "active" : ""}`} onClick={() => setFiltro("reativar")}>
            Para reativar <span className="mono">{totalParaReativar}</span>
          </div>
        </div>
      </div>

      <div className="clientes-scroll">
        <table className="clientes-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Pedidos</th>
              <th>Valor gasto</th>
              <th>Ticket médio</th>
              <th>Último pedido</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="cliente-nome">{c.nome ?? "Sem nome"}</div>
                  <div className="cliente-fone">{c.telefone}</div>
                </td>
                <td className="mono">{c.total_pedidos}</td>
                <td className="mono">{currency.format(c.valor_total_gasto)}</td>
                <td className="mono">{currency.format(c.ticket_medio)}</td>
                <td>
                  {c.dias_desde_ultimo_pedido === null ? (
                    <span style={{ color: "var(--text-3)" }}>Nunca comprou</span>
                  ) : (
                    <>
                      {c.dias_desde_ultimo_pedido === 0 ? "hoje" : `há ${c.dias_desde_ultimo_pedido} dias`}
                      {c.para_reativar && <span className="reativar-badge" style={{ marginLeft: 8 }}>Reativar</span>}
                    </>
                  )}
                </td>
                <td>
                  {c.tags.map((t) => (
                    <span className="tag-pill-sm" key={t}>
                      {t.replaceAll("_", " ")}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtrados.length === 0 && <div className="empty-state">Nenhum cliente encontrado.</div>}
      </div>
    </div>
  );
}
