// Carrinho em construção (`ia_sessoes.estado_json.pedido`) — o Order Context
// que a IA monta na conversa e que um humano edita pelo painel (tarefa 0063).
// Desde a tarefa 0043 tem um terceiro consumidor: o próprio cliente, pela
// página pública de pedido.
//
// Este módulo existe justamente porque agora são três caminhos mexendo no
// MESMO estado. A lógica de "como um item entra no carrinho" (revalidar
// preço no catálogo real, mesclar linha equivalente, invalidar confirmação
// anterior) não pode ter uma segunda implementação no caminho público —
// seria uma segunda fonte de verdade de dado comercial (CLAUDE.md regra 1) e
// um estado paralelo ao que a IA enxerga (regra 8).
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AguardandoConfirmacao,
  EnderecoEntrega,
  FluxoPedidoConfig,
  FormaPagamento,
  ItemCarrinho,
  OrderContext,
  ResumoPedidoIa,
  TipoEntrega,
  UltimoPedidoCriado,
} from "@prospect/shared";
import {
  FLUXO_PEDIDO_CONFIG_PADRAO,
  FluxoPedidoConfigSchema,
  FORMAS_PAGAMENTO,
  TIPOS_ENTREGA,
  aplicarMutacaoCarrinho,
  encontrarLinhaEquivalente,
  pedidoVazio,
  resumoPedidoIa,
} from "@prospect/shared";
import { montarItensComSnapshot } from "@prospect/pedidos-core";
import { randomUUID } from "node:crypto";

export interface EstadoSessaoIa {
  pedido: OrderContext;
  aguardando_confirmacao: AguardandoConfirmacao | null;
  ultimo_pedido_criado: UltimoPedidoCriado | null;
}

/** Erro de carrinho como CÓDIGO, nunca como frase pronta: quem traduz pra
 * texto é cada interface (o painel fala com um atendente, a página pública
 * fala com o cliente final, e as duas mensagens são diferentes). */
export type ResultadoCarrinho =
  | { ok: true; resumo: ResumoPedidoIa }
  | { ok: false; erro: string; extra?: Record<string, unknown> };

/** Lê de uma vez tudo que as interfaces precisam de `ia_sessoes.estado_json`
 * — carrinho, confirmação pendente e ponteiro do pedido já criado. Uma query
 * só: os três campos vivem na mesma linha e sempre são lidos juntos (a etapa
 * do checkout, `estado_checkout`, é derivada dos três). */
export async function carregarEstadoIa(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
): Promise<EstadoSessaoIa> {
  const { data } = await supabase
    .from("ia_sessoes")
    .select("estado_json")
    .eq("empresa_id", empresaId)
    .eq("atendimento_id", atendimentoId)
    .maybeSingle();

  const estado = (data?.estado_json as {
    pedido?: OrderContext;
    aguardando_confirmacao?: AguardandoConfirmacao;
    ultimo_pedido_criado?: UltimoPedidoCriado;
  } | null) ?? {};

  return {
    pedido: estado.pedido ?? pedidoVazio(),
    aguardando_confirmacao: estado.aguardando_confirmacao ?? null,
    ultimo_pedido_criado: estado.ultimo_pedido_criado ?? null,
  };
}

export async function carregarPedidoIa(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
): Promise<OrderContext> {
  return (await carregarEstadoIa(supabase, empresaId, atendimentoId)).pedido;
}

/** Motor de etapas configurável (tasks/0056/0077/0078) — toda interface
 * precisa refletir exatamente as mesmas etapas/opções que a IA usa
 * (CLAUDE.md regra 8: mesmo estado, nunca um cálculo paralelo), então
 * `informacoesPendentes`/`aplicarMutacaoCarrinho` sempre usam a config real
 * da empresa, nunca o default silencioso. */
export async function carregarFluxoPedidoConfig(
  supabase: SupabaseClient,
  empresaId: string,
): Promise<FluxoPedidoConfig> {
  const { data } = await supabase
    .from("ia_configuracoes")
    .select("fluxo_pedido_json")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const parseado = FluxoPedidoConfigSchema.safeParse(data?.fluxo_pedido_json ?? {});
  return parseado.success ? parseado.data : FLUXO_PEDIDO_CONFIG_PADRAO;
}

export async function salvarPedidoIa(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  pedido: OrderContext,
): Promise<void> {
  const { data } = await supabase
    .from("ia_sessoes")
    .select("estado_json")
    .eq("empresa_id", empresaId)
    .eq("atendimento_id", atendimentoId)
    .maybeSingle();

  const estadoAtual = (data?.estado_json as Record<string, unknown> | null) ?? {};

  // Qualquer edição de carrinho fora da conversa (humano no painel, cliente
  // na página pública) invalida uma confirmação pendente (tarefa 0022) — o
  // hash recalculado no lado da IA já não bateria mais de qualquer forma,
  // mas limpar aqui evita que a UI continue mostrando "aguardando
  // confirmação" pra um resumo que não existe mais.
  const { aguardando_confirmacao: _descartado, ...estadoSemConfirmacao } = estadoAtual;

  await supabase.from("ia_sessoes").upsert(
    {
      empresa_id: empresaId,
      atendimento_id: atendimentoId,
      estado_json: { ...estadoSemConfirmacao, pedido },
    },
    { onConflict: "atendimento_id" },
  );
}

/** Grava um campo irmão de `pedido` em `estado_json` sem tocar no resto —
 * usado por quem registra a criação de um pedido real
 * (`ultimo_pedido_criado`), que não é carrinho e por isso não passa por
 * `salvarPedidoIa`. */
export async function mesclarEstadoIa(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  parcial: Record<string, unknown>,
): Promise<void> {
  const { data } = await supabase
    .from("ia_sessoes")
    .select("estado_json")
    .eq("empresa_id", empresaId)
    .eq("atendimento_id", atendimentoId)
    .maybeSingle();

  const estadoAtual = (data?.estado_json as Record<string, unknown> | null) ?? {};

  await supabase.from("ia_sessoes").upsert(
    { empresa_id: empresaId, atendimento_id: atendimentoId, estado_json: { ...estadoAtual, ...parcial } },
    { onConflict: "atendimento_id" },
  );
}

async function resumoAtual(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  pedido: OrderContext,
  fluxoPedido: FluxoPedidoConfig,
): Promise<ResumoPedidoIa> {
  const { ultimo_pedido_criado } = await carregarEstadoIa(supabase, empresaId, atendimentoId);
  return resumoPedidoIa(pedido, null, fluxoPedido, ultimo_pedido_criado);
}

export async function lerCarrinho(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
): Promise<ResumoPedidoIa> {
  const [estado, fluxoPedido] = await Promise.all([
    carregarEstadoIa(supabase, empresaId, atendimentoId),
    carregarFluxoPedidoConfig(supabase, empresaId),
  ]);
  return resumoPedidoIa(estado.pedido, estado.aguardando_confirmacao, fluxoPedido, estado.ultimo_pedido_criado);
}

/** Adiciona um item ao carrinho com a mesma validação de preço/
 * disponibilidade real que a tool `adicionar_ao_carrinho` da IA usa
 * (`montarItensComSnapshot`, CLAUDE.md regra 1), e a mesma mesclagem de
 * linha equivalente pra nunca duplicar (tarefa 0054, episódio real do loop
 * de duplicação). */
export async function adicionarItemAoCarrinho(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  entrada: {
    produto_id: string;
    quantidade: number;
    observacoes?: string | null;
    opcoes?: Array<{ opcao_id: string }>;
  },
): Promise<ResultadoCarrinho> {
  const observacoes = entrada.observacoes ?? null;
  const opcoesInput = entrada.opcoes ?? [];

  if (!entrada.produto_id || !entrada.quantidade || entrada.quantidade < 1) {
    return { ok: false, erro: "produto_e_quantidade_obrigatorios" };
  }

  const [pedido, fluxoPedido] = await Promise.all([
    carregarPedidoIa(supabase, empresaId, atendimentoId),
    carregarFluxoPedidoConfig(supabase, empresaId),
  ]);

  const linhaExistente = encontrarLinhaEquivalente(
    pedido.itens,
    entrada.produto_id,
    observacoes,
    opcoesInput.map((o) => o.opcao_id),
  );
  const quantidadeFinal = (linhaExistente?.quantidade ?? 0) + entrada.quantidade;

  const montagem = await montarItensComSnapshot(
    supabase,
    [{ produto_id: entrada.produto_id, quantidade: quantidadeFinal, observacoes, opcoes: opcoesInput }],
    empresaId,
  );
  if (!montagem.ok) return { ok: false, erro: montagem.erro };

  const itemAtualizado: ItemCarrinho = { ...montagem.itens[0]!, linha_id: linhaExistente?.linha_id ?? randomUUID() };
  const novosItens = linhaExistente
    ? pedido.itens.map((item) => (item.linha_id === linhaExistente.linha_id ? itemAtualizado : item))
    : [...pedido.itens, itemAtualizado];

  const atualizado = aplicarMutacaoCarrinho(pedido, novosItens, fluxoPedido);
  await salvarPedidoIa(supabase, empresaId, atendimentoId, atualizado);
  return { ok: true, resumo: await resumoAtual(supabase, empresaId, atendimentoId, atualizado, fluxoPedido) };
}

/** Atualiza quantidade/observação de uma linha já existente — revalida
 * preço/disponibilidade de novo (não é só editar um número). */
export async function atualizarItemDoCarrinho(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  linhaId: string,
  entrada: { quantidade?: number; observacoes?: string | null },
): Promise<ResultadoCarrinho> {
  const [pedido, fluxoPedido] = await Promise.all([
    carregarPedidoIa(supabase, empresaId, atendimentoId),
    carregarFluxoPedidoConfig(supabase, empresaId),
  ]);

  const itemAtual = pedido.itens.find((item) => item.linha_id === linhaId);
  if (!itemAtual) return { ok: false, erro: "linha_nao_encontrada" };

  const montagem = await montarItensComSnapshot(
    supabase,
    [
      {
        produto_id: itemAtual.produto_id,
        quantidade: entrada.quantidade ?? itemAtual.quantidade,
        observacoes: entrada.observacoes !== undefined ? entrada.observacoes : itemAtual.observacoes,
        opcoes: itemAtual.opcoes.map((o) => ({ opcao_id: o.opcao_id })),
      },
    ],
    empresaId,
  );
  if (!montagem.ok) return { ok: false, erro: montagem.erro };

  const itemAtualizado: ItemCarrinho = { ...montagem.itens[0]!, linha_id: linhaId };
  const novosItens = pedido.itens.map((item) => (item.linha_id === linhaId ? itemAtualizado : item));
  const atualizado = aplicarMutacaoCarrinho(pedido, novosItens, fluxoPedido);
  await salvarPedidoIa(supabase, empresaId, atendimentoId, atualizado);
  return { ok: true, resumo: await resumoAtual(supabase, empresaId, atendimentoId, atualizado, fluxoPedido) };
}

export async function removerItemDoCarrinho(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  linhaId: string,
): Promise<ResultadoCarrinho> {
  const [pedido, fluxoPedido] = await Promise.all([
    carregarPedidoIa(supabase, empresaId, atendimentoId),
    carregarFluxoPedidoConfig(supabase, empresaId),
  ]);

  if (!pedido.itens.some((item) => item.linha_id === linhaId)) {
    return { ok: false, erro: "linha_nao_encontrada" };
  }

  const novosItens = pedido.itens.filter((item) => item.linha_id !== linhaId);
  const atualizado = aplicarMutacaoCarrinho(pedido, novosItens, fluxoPedido);
  await salvarPedidoIa(supabase, empresaId, atendimentoId, atualizado);
  return { ok: true, resumo: await resumoAtual(supabase, empresaId, atendimentoId, atualizado, fluxoPedido) };
}

/** Define tipo de entrega + endereço — mesmos campos que a IA preenche via
 * conversa (tarefas 0018/0020), mesmo estado. */
export async function definirEntregaDoCarrinho(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  entrada: { tipo_entrega: TipoEntrega | null; endereco: EnderecoEntrega | null },
): Promise<ResultadoCarrinho> {
  const { tipo_entrega, endereco } = entrada;

  if (tipo_entrega && !TIPOS_ENTREGA.includes(tipo_entrega)) {
    return { ok: false, erro: "tipo_entrega_invalido" };
  }

  const fluxoPedido = await carregarFluxoPedidoConfig(supabase, empresaId);
  if (tipo_entrega && !fluxoPedido.tipos_entrega_oferecidos.includes(tipo_entrega)) {
    return {
      ok: false,
      erro: "tipo_entrega_nao_oferecido",
      extra: { tipos_oferecidos: fluxoPedido.tipos_entrega_oferecidos },
    };
  }

  const pedido = await carregarPedidoIa(supabase, empresaId, atendimentoId);
  // Mudar entrega/endereço também é uma mutação real do pedido — mesma regra
  // 6 do CLAUDE.md de nunca herdar confirmação de um estado que já mudou.
  const atualizado: OrderContext = {
    ...pedido,
    tipo_entrega,
    endereco: tipo_entrega === "retirada" ? null : endereco,
    carrinho_confirmado: false,
  };
  await salvarPedidoIa(supabase, empresaId, atendimentoId, atualizado);
  return { ok: true, resumo: await resumoAtual(supabase, empresaId, atendimentoId, atualizado, fluxoPedido) };
}

export async function definirPagamentoDoCarrinho(
  supabase: SupabaseClient,
  empresaId: string,
  atendimentoId: string,
  forma_pagamento: FormaPagamento | null,
): Promise<ResultadoCarrinho> {
  if (forma_pagamento && !FORMAS_PAGAMENTO.includes(forma_pagamento)) {
    return { ok: false, erro: "forma_pagamento_invalida" };
  }

  const fluxoPedido = await carregarFluxoPedidoConfig(supabase, empresaId);
  if (forma_pagamento && !fluxoPedido.formas_pagamento_aceitas.includes(forma_pagamento)) {
    return {
      ok: false,
      erro: "forma_pagamento_nao_aceita",
      extra: { formas_aceitas: fluxoPedido.formas_pagamento_aceitas },
    };
  }

  const pedido = await carregarPedidoIa(supabase, empresaId, atendimentoId);
  const atualizado: OrderContext = { ...pedido, forma_pagamento, carrinho_confirmado: false };
  await salvarPedidoIa(supabase, empresaId, atendimentoId, atualizado);
  return { ok: true, resumo: await resumoAtual(supabase, empresaId, atendimentoId, atualizado, fluxoPedido) };
}
