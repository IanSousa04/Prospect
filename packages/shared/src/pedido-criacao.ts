// Criação real de um pedido em `pedidos`/`itens_pedido` — fonte única
// compartilhada entre `POST /pedidos` (painel humano, apps/api) e a tool
// `criar_pedido` da IA (apps/ai-orchestrator, tarefa 0055). Mesma razão de
// `montarItensComSnapshot` estar em `packages/pedidos-core`: os dois
// caminhos não podem divergir na lógica de "como um pedido nasce".
import type { SupabaseClient } from "@supabase/supabase-js";
import { montarItensComSnapshot, type ItemPedidoInput } from "@prospect/pedidos-core";
import type { EnderecoEntrega, FormaPagamento, OrigemPedido, Pedido, TipoEntrega } from "./pedidos.js";

export interface CriarPedidoParams {
  empresaId: string;
  clienteId: string;
  atendimentoId: string | null;
  origem: OrigemPedido;
  tipoEntrega: TipoEntrega;
  enderecoJson: EnderecoEntrega | null;
  taxaEntrega: number;
  formaPagamento: FormaPagamento | null;
  observacoes: string | null;
  itens: ItemPedidoInput[];
}

export type CriarPedidoResultado = { ok: true; pedido: Pedido } | { ok: false; erro: string };

export type MotivoBloqueioCriarPedido = "empresa_exige_confirmacao_humana" | "valor_acima_do_limite_sem_handoff";

/** Gate de risco real pra `criar_pedido` (tarefa 0055, CLAUDE.md regra 6:
 * ação irreversível com impacto financeiro exige confiança alta + baixo
 * risco + permissão explícita — confiança alta sozinha não basta). Função
 * pura, testável sem banco — os dois campos vêm de `ia_permissoes`
 * (existiam desde a migration 0010 mas nunca eram lidos em código
 * nenhum). Ausência de configuração = permissivo (mesmo padrão de
 * `comportamento_json`) — só limite/exigência EXPLICITAMENTE configurados
 * pela empresa bloqueiam a criação automática. */
export function avaliarRiscoCriarPedido(
  permissao: { exige_confirmacao_humana: boolean | null; valor_maximo_sem_handoff: number | null } | undefined,
  total: number,
): { bloqueado: false } | { bloqueado: true; motivo: MotivoBloqueioCriarPedido } {
  if (permissao?.exige_confirmacao_humana === true) {
    return { bloqueado: true, motivo: "empresa_exige_confirmacao_humana" };
  }
  if (permissao?.valor_maximo_sem_handoff != null && total > permissao.valor_maximo_sem_handoff) {
    return { bloqueado: true, motivo: "valor_acima_do_limite_sem_handoff" };
  }
  return { bloqueado: false };
}

export async function criarPedidoComItens(
  supabase: SupabaseClient,
  params: CriarPedidoParams,
): Promise<CriarPedidoResultado> {
  const montagem = await montarItensComSnapshot(supabase, params.itens, params.empresaId);
  if (!montagem.ok) return { ok: false, erro: montagem.erro };

  const total = Math.round((montagem.subtotal + params.taxaEntrega) * 100) / 100;

  const { data: pedido, error: pedidoError } = await supabase
    .from("pedidos")
    .insert({
      empresa_id: params.empresaId,
      cliente_id: params.clienteId,
      atendimento_id: params.atendimentoId,
      origem: params.origem,
      tipo_entrega: params.tipoEntrega,
      endereco_json: params.enderecoJson,
      taxa_entrega: params.taxaEntrega,
      forma_pagamento: params.formaPagamento,
      observacoes: params.observacoes,
      subtotal: montagem.subtotal,
      total,
    })
    .select()
    .single();

  if (pedidoError || !pedido) return { ok: false, erro: "erro_ao_criar_pedido" };

  for (const [ordem, item] of montagem.itens.entries()) {
    const { data: itemCriado, error: itemError } = await supabase
      .from("itens_pedido")
      .insert({
        empresa_id: params.empresaId,
        pedido_id: pedido.id,
        produto_id: item.produto_id,
        nome_produto: item.nome_produto,
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        observacoes: item.observacoes,
        ordem,
      })
      .select("id")
      .single();

    if (itemError || !itemCriado) return { ok: false, erro: "erro_ao_salvar_item_pedido" };

    if (item.opcoes.length > 0) {
      await supabase.from("itens_pedido_opcoes").insert(
        item.opcoes.map((o) => ({
          empresa_id: params.empresaId,
          item_pedido_id: itemCriado.id,
          opcao_id: o.opcao_id,
          nome_opcao: o.nome_opcao,
          preco_adicional: o.preco_adicional,
        })),
      );
    }
  }

  return { ok: true, pedido: pedido as Pedido };
}
