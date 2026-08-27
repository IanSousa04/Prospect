// Tipos da Fase 4 (Inteligência Comercial) — ver docs/product/08-roadmap.md §8.1.
// Não há tabela nova: tudo aqui é computado a partir de pedidos/clientes já
// existentes (packages/shared/src/pedidos.ts, types.ts).

import type { Cliente } from "./types.js";

/** Cliente com métricas comerciais computadas a partir dos pedidos reais —
 * nunca armazenadas, sempre calculadas na consulta (GET /clientes). */
export interface ClienteComMetricas extends Cliente {
  total_pedidos: number;
  valor_total_gasto: number;
  ticket_medio: number;
  ultimo_pedido_em: string | null;
  /** null quando o cliente nunca fez pedido. */
  dias_desde_ultimo_pedido: number | null;
  /** true quando o cliente já converteu pelo menos um pedido e está há mais
   * de 30 dias sem novo pedido — candidato a reativação (ver
   * docs/product/08-roadmap.md §8.1, Fase 4). */
  para_reativar: boolean;
}

export interface ProdutoMaisVendido {
  produto_id: string | null;
  nome: string;
  quantidade: number;
  valor_total: number;
}

/** Payload de GET /analytics/comercial — métricas de venda reais, sem
 * projeção nem estimativa (ver docs/product/06-qualidade-analytics.md §6.3). */
export interface AnalyticsComercial {
  pedidos_total: number;
  pedidos_por_status: Record<string, number>;
  valor_vendido: number;
  ticket_medio: number;
  taxa_conversao: number;
  produtos_mais_vendidos: ProdutoMaisVendido[];
  clientes_para_reativar: number;
}
