import { useEffect, useState } from "react";
import type { AnalyticsComercial } from "@prospect/shared";
import { api } from "../lib/api.js";
import Topbar from "../components/Topbar.js";
import "./Analytics.css";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

const STATUS_LABEL: Record<string, string> = {
  aberto: "Aberto",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  pronto: "Pronto",
  saiu_para_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

export default function Analytics() {
  const [dados, setDados] = useState<AnalyticsComercial | null>(null);

  useEffect(() => {
    api.analyticsComercial().then(setDados);
  }, []);

  if (!dados) {
    return <div className="empty-state">Carregando analytics…</div>;
  }

  const maiorContagem = Math.max(1, ...Object.values(dados.pedidos_por_status));
  const maiorQtdProduto = Math.max(1, ...dados.produtos_mais_vendidos.map((p) => p.quantidade));

  return (
    <div className="analytics-page">
      <Topbar />

      <div className="page-header">
        <p className="page-title">Analytics</p>
        <p className="page-sub">Métricas comerciais calculadas a partir dos pedidos reais</p>
      </div>

      <div className="analytics-scroll">
        <div className="cards-grid">
          <div className="stat-card">
            <div className="stat-label">Valor vendido</div>
            <div className="stat-value accent">{currency.format(dados.valor_vendido)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Ticket médio</div>
            <div className="stat-value">{currency.format(dados.ticket_medio)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pedidos totais</div>
            <div className="stat-value">{dados.pedidos_total}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Taxa de conversão</div>
            <div className="stat-value">{percent.format(dados.taxa_conversao)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Clientes p/ reativar</div>
            <div className="stat-value amber">{dados.clientes_para_reativar}</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">Pedidos por status</div>
          {Object.entries(dados.pedidos_por_status).map(([status, count]) => (
            <div className="status-bar-row" key={status}>
              <div className="status-bar-label">{STATUS_LABEL[status] ?? status}</div>
              <div className="status-bar-track">
                <div className="status-bar-fill" style={{ width: `${(count / maiorContagem) * 100}%` }} />
              </div>
              <div className="status-bar-count">{count}</div>
            </div>
          ))}
          {Object.keys(dados.pedidos_por_status).length === 0 && (
            <div className="empty-state">Nenhum pedido registrado ainda.</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Produtos mais vendidos</div>
          {dados.produtos_mais_vendidos.map((p, i) => (
            <div className="produto-rank-row" key={p.produto_id ?? p.nome}>
              <div className="produto-rank-nome">
                <span className="produto-rank-pos">#{i + 1}</span>
                {p.nome}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 80, height: 6, background: "var(--bg-card)", borderRadius: 3 }}>
                  <div
                    style={{
                      width: `${(p.quantidade / maiorQtdProduto) * 100}%`,
                      height: "100%",
                      background: "var(--ia)",
                      borderRadius: 3,
                    }}
                  />
                </div>
                <span className="produto-rank-qtd">{p.quantidade}x</span>
                <span className="mono">{currency.format(p.valor_total)}</span>
              </div>
            </div>
          ))}
          {dados.produtos_mais_vendidos.length === 0 && (
            <div className="empty-state">Nenhuma venda confirmada ainda.</div>
          )}
        </div>
      </div>
    </div>
  );
}
