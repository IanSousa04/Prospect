// Tipos espelham 1:1 o schema de supabase/migrations/0008_fase3_pedidos.sql.
// Qualquer mudança de schema deve atualizar este arquivo na mesma alteração.

export type StatusPedido =
  | "aberto"
  | "confirmado"
  | "em_preparo"
  | "pronto"
  | "saiu_para_entrega"
  | "entregue"
  | "cancelado";

export type OrigemPedido = "painel" | "ia" | "integracao_externa";
export type TipoEntrega = "entrega" | "retirada";
export type FormaPagamento = "dinheiro" | "cartao_credito" | "cartao_debito" | "pix" | "outro";
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

/** Estados que ainda podem ser alterados pelo humano no painel — pedidos
 * entregues/cancelados são somente leitura (ver docs/product/08-roadmap.md). */
export const STATUS_PEDIDO_EDITAVEIS: StatusPedido[] = [
  "aberto",
  "confirmado",
  "em_preparo",
  "pronto",
  "saiu_para_entrega",
];
