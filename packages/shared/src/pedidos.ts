// Tipos espelham 1:1 o schema de supabase/migrations/0008_fase3_pedidos.sql.
// Qualquer mudança de schema deve atualizar este arquivo na mesma alteração.

export type StatusPedido = "aberto" | "em_preparacao" | "pronto" | "entregue" | "cancelado";

export type OrigemPedido = "painel" | "ia" | "integracao_externa";

export const TIPOS_ENTREGA = ["entrega", "retirada"] as const;
export type TipoEntrega = (typeof TIPOS_ENTREGA)[number];

export const FORMAS_PAGAMENTO = ["dinheiro", "cartao_credito", "cartao_debito", "pix", "outro"] as const;
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number];

export type StatusPagamento = "pendente" | "pago" | "parcial" | "estornado";

export interface EnderecoEntrega {
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  referencia?: string;
}

export interface Pedido {
  id: string;
  empresa_id: string;
  cliente_id: string;
  atendimento_id: string | null;

  /** Número sequencial POR EMPRESA (migração 0025) — é o número que a cozinha
   * e o cliente falam em voz alta. Atribuído por trigger no insert; nunca
   * global, pra não vazar volume de negócio entre tenants. */
  numero: number;

  status: StatusPedido;
  origem: OrigemPedido;

  tipo_entrega: TipoEntrega;
  endereco_json: EnderecoEntrega | null;
  taxa_entrega: number;

  forma_pagamento: FormaPagamento | null;
  status_pagamento: StatusPagamento;

  subtotal: number;
  desconto: number;
  total: number;

  observacoes: string | null;

  /** Preenchido quando um humano arquiva um pedido `entregue`/`cancelado`
   * pra sair da visão ativa do board (tarefa 0066) — não afeta `status`. */
  arquivado_em: string | null;

  criado_em: string;
  atualizado_em: string;
}

export interface ItemPedidoOpcao {
  id: string;
  empresa_id: string;
  item_pedido_id: string;
  opcao_id: string | null;
  nome_opcao: string;
  preco_adicional: number;
}

export interface ItemPedido {
  id: string;
  empresa_id: string;
  pedido_id: string;
  produto_id: string | null;
  nome_produto: string;
  quantidade: number;
  preco_unitario: number;
  observacoes: string | null;
  ordem: number;
}

export interface ItemPedidoComOpcoes extends ItemPedido {
  opcoes: ItemPedidoOpcao[];
}

export interface PedidoDetalhado extends Pedido {
  itens: ItemPedidoComOpcoes[];
}

/** Só o que o card do Kanban precisa pra montar o resumo do pedido — evita
 * trafegar `itens_pedido` inteiro (preço, opções, observações) numa query que
 * carrega o board inteiro de uma vez. */
export interface ItemResumo {
  nome_produto: string;
  quantidade: number;
  ordem: number;
}

export interface PedidoComResumo extends Pedido {
  itens: ItemResumo[];
}

/** Estados que ainda podem ser alterados pelo humano no painel — pedidos
 * entregues/cancelados são somente leitura (ver docs/product/08-roadmap.md). */
export const STATUS_PEDIDO_EDITAVEIS: StatusPedido[] = ["aberto", "em_preparacao", "pronto"];
