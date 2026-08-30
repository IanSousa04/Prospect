import type { FastifyInstance } from "fastify";
import type {
  AguardandoConfirmacao,
  AtendimentoComContexto,
  EnderecoEntrega,
  EstagioOperacional,
  FluxoPedidoConfig,
  FormaPagamento,
  ItemCarrinho,
  OrderContext,
  StatusAtendimento,
  TipoEntrega,
  UltimoPedidoCriado,
} from "@prospect/shared";
import type { PedidoComResumo, StatusPedido } from "@prospect/shared";
import {
  estagioDeAtendimento,
  aplicarMutacaoCarrinho,
  encontrarLinhaEquivalente,
  pedidoVazio,
  resumoPedidoIa,
  FluxoPedidoConfigSchema,
  FLUXO_PEDIDO_CONFIG_PADRAO,
} from "@prospect/shared";
import { montarItensComSnapshot } from "@prospect/pedidos-core";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const STATUS_VALIDOS: StatusAtendimento[] = ["ia_atendendo", "solicitou_humano", "humano_atendendo", "resolvido"];

// Transições permitidas via PATCH genérico — mesmo padrão de
// `TRANSICOES` em pedidos.ts. `/assumir` e `/devolver-ia` continuam sendo
// os caminhos normais pra entrar/sair de `humano_atendendo`/`ia_atendendo`;
// esta rota cobre o resto (ex.: IA escalando pra "solicitou humano",
// cliente pedindo humano, ou finalizar a partir de qualquer estado ativo).
const TRANSICOES: Record<StatusAtendimento, StatusAtendimento[]> = {
  ia_atendendo: ["solicitou_humano", "humano_atendendo", "resolvido"],
  solicitou_humano: ["humano_atendendo", "ia_atendendo", "resolvido"],
  humano_atendendo: ["ia_atendendo", "resolvido"],
  resolvido: [],
};

/** Lê/grava o Order Context (`ia_sessoes.estado_json.pedido`) — mesmo
 * estado que a IA usa (`apps/ai-orchestrator/src/agent/sessao.ts`).
 * Mescla sobre `estado_json` existente (nunca sobrescreve outros campos
 * que só a IA usa, ex. `ultimo_produto_mencionado`) — mesmo cuidado que
 * `mesclarEstado` já tem do lado do orquestrador. Um humano editando pela
 * UI (tarefa 0063) usa exatamente estas duas funções, nunca um pedido
 * paralelo (CLAUDE.md regra 8). */
interface EstadoSessaoIa {
  pedido: OrderContext;
  aguardando_confirmacao: AguardandoConfirmacao | null;
  ultimo_pedido_criado: UltimoPedidoCriado | null;
}

/** Lê de uma vez tudo que o painel precisa de `ia_sessoes.estado_json` —
 * carrinho, confirmação pendente e ponteiro do pedido já criado. Uma query
 * só: os três campos vivem na mesma linha e sempre são lidos juntos (a
 * etapa do checkout, `estado_checkout`, é derivada dos três). */
async function carregarEstadoIa(empresaId: string, atendimentoId: string): Promise<EstadoSessaoIa> {
  const { data } = await supabaseAdmin
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

async function carregarPedidoIa(empresaId: string, atendimentoId: string): Promise<OrderContext> {
  return (await carregarEstadoIa(empresaId, atendimentoId)).pedido;
}

/** Motor de etapas configurável (tasks/0056/0077/0078) — o painel humano
 * precisa refletir exatamente as mesmas etapas/opções que a IA usa
 * (CLAUDE.md regra 8: mesmo estado, nunca um cálculo paralelo), então
 * `informacoesPendentes`/`aplicarMutacaoCarrinho` aqui usam a mesma config
 * real da empresa, nunca o default silencioso. */
async function carregarFluxoPedidoConfig(empresaId: string): Promise<FluxoPedidoConfig> {
  const { data } = await supabaseAdmin
    .from("ia_configuracoes")
    .select("fluxo_pedido_json")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const parseado = FluxoPedidoConfigSchema.safeParse(data?.fluxo_pedido_json ?? {});
  return parseado.success ? parseado.data : FLUXO_PEDIDO_CONFIG_PADRAO;
}

async function salvarPedidoIa(empresaId: string, atendimentoId: string, pedido: OrderContext): Promise<void> {
  const { data } = await supabaseAdmin
    .from("ia_sessoes")
    .select("estado_json")
    .eq("empresa_id", empresaId)
    .eq("atendimento_id", atendimentoId)
    .maybeSingle();

  const estadoAtual = (data?.estado_json as Record<string, unknown> | null) ?? {};

  // Um humano editando o carrinho (tarefa 0063) sempre invalida uma
  // confirmação pendente (tarefa 0022) — o hash recalculado no lado da IA
  // já não bateria mais de qualquer forma, mas limpar aqui evita que o
  // painel continue mostrando "aguardando confirmação" pra um resumo que
  // não existe mais.
  const { aguardando_confirmacao: _descartado, ...estadoSemConfirmacao } = estadoAtual;

  await supabaseAdmin.from("ia_sessoes").upsert(
    {
      empresa_id: empresaId,
      atendimento_id: atendimentoId,
      estado_json: { ...estadoSemConfirmacao, pedido },
    },
    { onConflict: "atendimento_id" },
  );
}

/** Um pedido só "domina" a coluna do card enquanto está em produção. Pedido
 * arquivado, entregue ou cancelado sai da visão ativa do board: o card volta a
 * ser posicionado pelo status da conversa (que, no caso da entrega, a rota
 * `/pedidos/:id/entregar` já deixou `resolvido`). */
const STATUS_PEDIDO_ATIVO: StatusPedido[] = ["aberto", "em_preparacao", "pronto"];

/** Deriva a etapa do fluxo (`EstagioOperacional`) a partir de
 * `atendimentos.status` + `pedidos.status`, sem gravar uma terceira fonte de
 * verdade. Só pedido JÁ CONFIRMADO define coluna própria — um pedido `aberto`
 * (montado, não confirmado) deixa o card na coluna de conversa, onde o humano
 * tem a ação "Confirmar pedido". É isso que elimina a antiga coluna "Aberto". */
function derivarEstagioOperacional(
  statusAtendimento: StatusAtendimento,
  pedidoAtivo: { status: StatusPedido } | null,
): EstagioOperacional {
  if (pedidoAtivo?.status === "em_preparacao") return "na_cozinha";
  if (pedidoAtivo?.status === "pronto") return "pronto";
  return estagioDeAtendimento(statusAtendimento);
}

function paraContexto(row: any): AtendimentoComContexto {
  const pedidosNaoArquivados = (row.pedidos ?? []).filter((p: any) => !p.arquivado_em);
  const handoff_aberto = (row.handoffs ?? []).find((h: any) => h.status === "aberto") ?? null;
  const pedido_aberto = pedidosNaoArquivados.find((p: any) => p.status !== "cancelado") ?? null;
  const pedido_estagio: PedidoComResumo | null =
    pedidosNaoArquivados.find((p: any) => STATUS_PEDIDO_ATIVO.includes(p.status)) ?? null;

  if (pedido_estagio?.itens) {
    pedido_estagio.itens = [...pedido_estagio.itens].sort((a, b) => a.ordem - b.ordem);
  }

  return {
    ...row,
    cliente: row.cliente,
    responsavel: row.responsavel ?? null,
    handoff_aberto,
    pedido_aberto,
    pedido_estagio,
    estagio_operacional: derivarEstagioOperacional(row.status, pedido_estagio),
  };
}

export async function atendimentosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Lista todos os atendimentos da empresa, já com cliente e handoff aberto
  // embutidos — é a query que alimenta o Kanban inteiro numa chamada só.
  app.get("/atendimentos", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { data, error } = await supabaseAdmin
      .from("atendimentos")
      .select(
        `*,
         cliente:clientes(*),
         handoffs(*),
         responsavel:usuarios(id, nome),
         pedidos(*, itens:itens_pedido(nome_produto, quantidade, ordem))`,
      )
      .eq("empresa_id", empresaId)
      .order("ultima_mensagem_em", { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_atendimentos" });
    }

    // Um atendimento `resolvido` sem nenhum pedido (nunca virou venda)
    // desaparece do board sozinho, sem ação manual (ver tasks/0066) — os
    // demais casos de "sair da visão ativa" (pedido entregue/cancelado)
    // passam por arquivamento explícito (`POST /pedidos/:id/arquivar`).
    const atendimentos: AtendimentoComContexto[] = (data ?? [])
      .map(paraContexto)
      .filter((a) => a.estagio_operacional !== "resolvido");

    return atendimentos;
  });

  app.get<{ Params: { id: string } }>("/atendimentos/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("atendimentos")
      .select(
        `*,
         cliente:clientes(*),
         handoffs(*),
         responsavel:usuarios(id, nome),
         pedidos(*, itens:itens_pedido(nome_produto, quantidade, ordem))`,
      )
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_atendimento" });
    }
    if (!data) {
      return reply.code(404).send({ error: "atendimento_nao_encontrado" });
    }

    return paraContexto(data);
  });

  // Carrinho em construção pela IA (ver ia_sessoes.estado_json.pedido,
  // apps/ai-orchestrator/src/agent/sessao.ts). Desde a tarefa 0063, também
  // editável por um humano (rotas abaixo) — mesmo estado que a IA usa,
  // nunca um pedido paralelo (CLAUDE.md regra 8). GET sempre devolve um
  // resumo válido (carrinho vazio, não 404) mesmo sem nenhuma sessão criada
  // ainda, pra UI não precisar tratar caso especial.
  app.get<{ Params: { id: string } }>("/atendimentos/:id/carrinho", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const [estado, fluxoPedido] = await Promise.all([
      carregarEstadoIa(empresaId, id),
      carregarFluxoPedidoConfig(empresaId),
    ]);
    return resumoPedidoIa(estado.pedido, estado.aguardando_confirmacao, fluxoPedido, estado.ultimo_pedido_criado);
  });

  // Adicionar item ao carrinho — mesma validação de preço/disponibilidade
  // real que a tool `adicionar_ao_carrinho` da IA usa (montarItensComSnapshot,
  // CLAUDE.md regra 1), e a mesma mesclagem de linha equivalente pra nunca
  // duplicar (ver tarefa 0054, episódio real do loop de duplicação).
  app.post<{
    Params: { id: string };
    Body: { produto_id: string; quantidade: number; observacoes?: string | null; opcoes?: Array<{ opcao_id: string }> };
  }>("/atendimentos/:id/carrinho/itens", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;
    const { produto_id, quantidade, opcoes } = request.body;
    const observacoes = request.body.observacoes ?? null;
    const opcoesInput = opcoes ?? [];

    if (!produto_id || !quantidade || quantidade < 1) {
      return reply.code(400).send({ error: "produto_e_quantidade_obrigatorios" });
    }

    const [pedido, fluxoPedido] = await Promise.all([carregarPedidoIa(empresaId, id), carregarFluxoPedidoConfig(empresaId)]);
    const linhaExistente = encontrarLinhaEquivalente(
      pedido.itens,
      produto_id,
      observacoes,
      opcoesInput.map((o) => o.opcao_id),
    );
    const quantidadeFinal = (linhaExistente?.quantidade ?? 0) + quantidade;

    const montagem = await montarItensComSnapshot(
      supabaseAdmin,
      [{ produto_id, quantidade: quantidadeFinal, observacoes, opcoes: opcoesInput }],
      empresaId,
    );
    if (!montagem.ok) return reply.code(400).send({ error: montagem.erro });

    const itemAtualizado: ItemCarrinho = { ...montagem.itens[0]!, linha_id: linhaExistente?.linha_id ?? randomUUID() };
    const novosItens = linhaExistente
      ? pedido.itens.map((item) => (item.linha_id === linhaExistente.linha_id ? itemAtualizado : item))
      : [...pedido.itens, itemAtualizado];

    const atualizado = aplicarMutacaoCarrinho(pedido, novosItens, fluxoPedido);
    await salvarPedidoIa(empresaId, id, atualizado);
    return resumoPedidoIa(atualizado, null, fluxoPedido, (await carregarEstadoIa(empresaId, id)).ultimo_pedido_criado);
  });

  // Atualizar quantidade/observação de uma linha já existente — revalida
  // preço/disponibilidade de novo (não é só editar um número).
  app.patch<{
    Params: { id: string; linhaId: string };
    Body: { quantidade?: number; observacoes?: string | null };
  }>("/atendimentos/:id/carrinho/itens/:linhaId", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id, linhaId } = request.params;

    const [pedido, fluxoPedido] = await Promise.all([carregarPedidoIa(empresaId, id), carregarFluxoPedidoConfig(empresaId)]);
    const itemAtual = pedido.itens.find((item) => item.linha_id === linhaId);
    if (!itemAtual) return reply.code(404).send({ error: "linha_nao_encontrada" });

    const montagem = await montarItensComSnapshot(
      supabaseAdmin,
      [
        {
          produto_id: itemAtual.produto_id,
          quantidade: request.body.quantidade ?? itemAtual.quantidade,
          observacoes: request.body.observacoes !== undefined ? request.body.observacoes : itemAtual.observacoes,
          opcoes: itemAtual.opcoes.map((o) => ({ opcao_id: o.opcao_id })),
        },
      ],
      empresaId,
    );
    if (!montagem.ok) return reply.code(400).send({ error: montagem.erro });

    const itemAtualizado: ItemCarrinho = { ...montagem.itens[0]!, linha_id: linhaId };
    const novosItens = pedido.itens.map((item) => (item.linha_id === linhaId ? itemAtualizado : item));
    const atualizado = aplicarMutacaoCarrinho(pedido, novosItens, fluxoPedido);
    await salvarPedidoIa(empresaId, id, atualizado);
    return resumoPedidoIa(atualizado, null, fluxoPedido, (await carregarEstadoIa(empresaId, id)).ultimo_pedido_criado);
  });

  // Remover uma linha do carrinho.
  app.delete<{ Params: { id: string; linhaId: string } }>(
    "/atendimentos/:id/carrinho/itens/:linhaId",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id, linhaId } = request.params;

      const [pedido, fluxoPedido] = await Promise.all([carregarPedidoIa(empresaId, id), carregarFluxoPedidoConfig(empresaId)]);
      if (!pedido.itens.some((item) => item.linha_id === linhaId)) {
        return reply.code(404).send({ error: "linha_nao_encontrada" });
      }

      const novosItens = pedido.itens.filter((item) => item.linha_id !== linhaId);
      const atualizado = aplicarMutacaoCarrinho(pedido, novosItens, fluxoPedido);
      await salvarPedidoIa(empresaId, id, atualizado);
      return resumoPedidoIa(atualizado, null, fluxoPedido, (await carregarEstadoIa(empresaId, id)).ultimo_pedido_criado);
    },
  );

  // Definir tipo de entrega + endereço — mesmos campos que a IA vai
  // preencher via conversa (tarefas 0018/0020), mesmo estado.
  app.put<{
    Params: { id: string };
    Body: { tipo_entrega: TipoEntrega | null; endereco: EnderecoEntrega | null };
  }>("/atendimentos/:id/carrinho/entrega", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;
    const { tipo_entrega, endereco } = request.body;

    if (tipo_entrega && !["entrega", "retirada"].includes(tipo_entrega)) {
      return reply.code(400).send({ error: "tipo_entrega_invalido" });
    }

    const fluxoPedido = await carregarFluxoPedidoConfig(empresaId);
    if (tipo_entrega && !fluxoPedido.tipos_entrega_oferecidos.includes(tipo_entrega)) {
      return reply.code(400).send({ error: "tipo_entrega_nao_oferecido", tipos_oferecidos: fluxoPedido.tipos_entrega_oferecidos });
    }

    const pedido = await carregarPedidoIa(empresaId, id);
    // Mudar entrega/endereço também é uma mutação real do pedido — mesma
    // regra 6 do CLAUDE.md de nunca herdar confirmação de um estado que já
    // mudou (ver aplicarMutacaoCarrinho, mesmo espírito aplicado aqui).
    const atualizado = {
      ...pedido,
      tipo_entrega,
      endereco: tipo_entrega === "retirada" ? null : endereco,
      carrinho_confirmado: false,
    };
    await salvarPedidoIa(empresaId, id, atualizado);
    return resumoPedidoIa(atualizado, null, fluxoPedido, (await carregarEstadoIa(empresaId, id)).ultimo_pedido_criado);
  });

  // Definir forma de pagamento.
  app.put<{ Params: { id: string }; Body: { forma_pagamento: FormaPagamento | null } }>(
    "/atendimentos/:id/carrinho/pagamento",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id } = request.params;
      const { forma_pagamento } = request.body;

      const FORMAS_VALIDAS: FormaPagamento[] = ["dinheiro", "cartao_credito", "cartao_debito", "pix", "outro"];
      if (forma_pagamento && !FORMAS_VALIDAS.includes(forma_pagamento)) {
        return reply.code(400).send({ error: "forma_pagamento_invalida" });
      }

      const fluxoPedido = await carregarFluxoPedidoConfig(empresaId);
      if (forma_pagamento && !fluxoPedido.formas_pagamento_aceitas.includes(forma_pagamento)) {
        return reply.code(400).send({ error: "forma_pagamento_nao_aceita", formas_aceitas: fluxoPedido.formas_pagamento_aceitas });
      }

      const pedido = await carregarPedidoIa(empresaId, id);
      const atualizado = { ...pedido, forma_pagamento, carrinho_confirmado: false };
      await salvarPedidoIa(empresaId, id, atualizado);
      return resumoPedidoIa(atualizado, null, fluxoPedido, (await carregarEstadoIa(empresaId, id)).ultimo_pedido_criado);
    },
  );

  // Assumir atendimento — ação de 1 clique do Kanban/tela de conversa.
  // Regra: só move status pra humano_atendendo se ainda não estava resolvido.
  app.post<{ Params: { id: string } }>("/atendimentos/:id/assumir", async (request, reply) => {
    const { empresaId, usuarioId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("atendimentos")
      .update({
        status: "humano_atendendo",
        responsavel_usuario_id: usuarioId,
        assumido_em: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .neq("status", "resolvido")
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_assumir_atendimento" });
    }
    if (!data) {
      return reply.code(404).send({ error: "atendimento_nao_encontrado" });
    }

    return data;
  });

  // Devolver pra IA — inverso de /assumir. Só move status pra ia_atendendo
  // se não estava já lá nem resolvido, e resolve automaticamente qualquer
  // handoff aberto/assumido deste atendimento (decisão explícita: com a IA
  // de volta ativa, um handoff pendente ficaria com banner obsoleto na
  // tela — ver docs/ROADMAP.md §2 "Devolver atendimento pra IA").
  app.post<{ Params: { id: string } }>("/atendimentos/:id/devolver-ia", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("atendimentos")
      // Limpa responsável e cronômetro junto: um card na coluna 🤖 IA
      // mostrando "👤 Fulano" seria exatamente a confusão entre status e
      // responsável que o board novo existe pra desfazer.
      .update({ status: "ia_atendendo", responsavel_usuario_id: null, assumido_em: null })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .neq("status", "ia_atendendo")
      .neq("status", "resolvido")
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_devolver_para_ia" });
    }
    if (!data) {
      return reply.code(404).send({ error: "atendimento_nao_encontrado" });
    }

    const { error: handoffError } = await supabaseAdmin
      .from("handoffs")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("atendimento_id", id)
      .eq("empresa_id", empresaId)
      .in("status", ["aberto", "assumido"]);

    if (handoffError) {
      // Status do atendimento já mudou — loga mas não falha a resposta:
      // melhor a IA já estar ativa de novo com um handoff obsoleto sobrando
      // (visível, corrigível na mão) do que reverter o que já deu certo.
      request.log.error(handoffError);
    }

    return data;
  });

  app.post<{ Params: { id: string }; Body: { status: StatusAtendimento } }>(
    "/atendimentos/:id/status",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id } = request.params;
      const { status } = request.body;

      if (!STATUS_VALIDOS.includes(status)) {
        return reply.code(400).send({ error: "status_invalido" });
      }

      const { data: atual, error: buscaError } = await supabaseAdmin
        .from("atendimentos")
        .select("status, handoffs(status)")
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .maybeSingle();

      if (buscaError) {
        request.log.error(buscaError);
        return reply.code(500).send({ error: "erro_ao_buscar_atendimento" });
      }
      if (!atual) {
        return reply.code(404).send({ error: "atendimento_nao_encontrado" });
      }

      const permitido = TRANSICOES[atual.status as StatusAtendimento]?.includes(status);
      if (!permitido) {
        return reply.code(400).send({ error: "transicao_de_status_nao_permitida" });
      }

      // Encerrar com handoff aberto/assumido deixaria um humano esperando
      // resposta sem atendimento nenhum acompanhando — diferente de
      // devolver pra IA (que resolve o handoff de propósito), finalizar
      // precisa que o handoff já tenha sido tratado antes.
      if (status === "resolvido") {
        const handoffPendente = ((atual as any).handoffs ?? []).some(
          (h: { status: string }) => h.status === "aberto" || h.status === "assumido",
        );
        if (handoffPendente) {
          return reply.code(400).send({ error: "handoff_pendente_impede_finalizar" });
        }
      }

      const { data, error } = await supabaseAdmin
        .from("atendimentos")
        .update({ status })
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .select()
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_atualizar_status" });
      }
      if (!data) {
        return reply.code(404).send({ error: "atendimento_nao_encontrado" });
      }

      return data;
    },
  );
}
