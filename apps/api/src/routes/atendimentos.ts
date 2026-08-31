import type { FastifyInstance } from "fastify";
import type {
  AtendimentoComContexto,
  EnderecoEntrega,
  EstagioOperacional,
  FormaPagamento,
  StatusAtendimento,
  TipoEntrega,
} from "@prospect/shared";
import type { PedidoComResumo, StatusPedido } from "@prospect/shared";
import { estagioDeAtendimento } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";
import {
  adicionarItemAoCarrinho,
  atualizarItemDoCarrinho,
  definirEntregaDoCarrinho,
  definirPagamentoDoCarrinho,
  lerCarrinho,
  removerItemDoCarrinho,
  type ResultadoCarrinho,
} from "../services/carrinho.js";

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
  // Terminal — "cancelar" tem rota própria com guardas (POST /cancelar), não
  // passa pelo PATCH genérico.
  cancelado: [],
};

/** Códigos de erro do serviço de carrinho que são falha de VALIDAÇÃO (400) —
 * qualquer outro é "não achei" (404). O painel traduz o código pra frase
 * (ver pages/kanban/acoes.ts); a rota só escolhe o status HTTP. */
const ERROS_CARRINHO_400: ReadonlySet<string> = new Set([
  "produto_e_quantidade_obrigatorios",
  "tipo_entrega_invalido",
  "tipo_entrega_nao_oferecido",
  "forma_pagamento_invalida",
  "forma_pagamento_nao_aceita",
]);

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

  /** Traduz o resultado do serviço de carrinho em resposta HTTP — uma função
   * só pras cinco rotas de mutação, que antes repetiam o mesmo `if (!ok)`. */
  function responderCarrinho(reply: any, resultado: ResultadoCarrinho) {
    if (resultado.ok) return resultado.resumo;
    const codigo = ERROS_CARRINHO_400.has(resultado.erro) ? 400 : 404;
    return reply.code(codigo).send({ error: resultado.erro, ...(resultado.extra ?? {}) });
  }

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
  // nunca um pedido paralelo (CLAUDE.md regra 8). A mecânica real vive em
  // services/carrinho.ts, compartilhada com a página pública (tarefa 0043).
  // GET sempre devolve um resumo válido (carrinho vazio, não 404) mesmo sem
  // nenhuma sessão criada ainda, pra UI não precisar tratar caso especial.
  app.get<{ Params: { id: string } }>("/atendimentos/:id/carrinho", async (request) => {
    const { empresaId } = request.auth!;
    return lerCarrinho(supabaseAdmin, empresaId, request.params.id);
  });

  app.post<{
    Params: { id: string };
    Body: { produto_id: string; quantidade: number; observacoes?: string | null; opcoes?: Array<{ opcao_id: string }> };
  }>("/atendimentos/:id/carrinho/itens", async (request, reply) => {
    const { empresaId } = request.auth!;
    return responderCarrinho(
      reply,
      await adicionarItemAoCarrinho(supabaseAdmin, empresaId, request.params.id, request.body),
    );
  });

  app.patch<{
    Params: { id: string; linhaId: string };
    Body: { quantidade?: number; observacoes?: string | null };
  }>("/atendimentos/:id/carrinho/itens/:linhaId", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id, linhaId } = request.params;
    return responderCarrinho(
      reply,
      await atualizarItemDoCarrinho(supabaseAdmin, empresaId, id, linhaId, request.body),
    );
  });

  app.delete<{ Params: { id: string; linhaId: string } }>(
    "/atendimentos/:id/carrinho/itens/:linhaId",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id, linhaId } = request.params;
      return responderCarrinho(reply, await removerItemDoCarrinho(supabaseAdmin, empresaId, id, linhaId));
    },
  );

  app.put<{
    Params: { id: string };
    Body: { tipo_entrega: TipoEntrega | null; endereco: EnderecoEntrega | null };
  }>("/atendimentos/:id/carrinho/entrega", async (request, reply) => {
    const { empresaId } = request.auth!;
    return responderCarrinho(
      reply,
      await definirEntregaDoCarrinho(supabaseAdmin, empresaId, request.params.id, request.body),
    );
  });

  app.put<{ Params: { id: string }; Body: { forma_pagamento: FormaPagamento | null } }>(
    "/atendimentos/:id/carrinho/pagamento",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      return responderCarrinho(
        reply,
        await definirPagamentoDoCarrinho(supabaseAdmin, empresaId, request.params.id, request.body.forma_pagamento),
      );
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
      .neq("status", "cancelado")
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
      .neq("status", "cancelado")
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

  // Cancelar atendimento — conversa abortada (spam, número errado, cliente
  // desistiu, duplicada). Terminal como `resolvido`, mas semanticamente
  // distinto: cancelado ≠ concluído (migration 0031). Duas guardas: (1) não
  // pode cancelar conversa já terminal; (2) não pode cancelar com pedido
  // ATIVO (aberto/em_preparacao/pronto) — primeiro cancela-se o pedido (a
  // conversa continua aberta), depois o atendimento; do contrário o card
  // sumiria do board escondendo um pedido em produção na cozinha. Resolve
  // handoffs abertos/assumidos, mesmo tratamento que `/devolver-ia`.
  app.post<{ Params: { id: string } }>("/atendimentos/:id/cancelar", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data: atual, error: buscaError } = await supabaseAdmin
      .from("atendimentos")
      .select("status, pedidos(status)")
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

    if (atual.status === "resolvido" || atual.status === "cancelado") {
      return reply.code(400).send({ error: "atendimento_ja_encerrado" });
    }

    const pedidoAtivo = ((atual as any).pedidos ?? []).some((p: any) =>
      STATUS_PEDIDO_ATIVO.includes(p.status as StatusPedido),
    );
    if (pedidoAtivo) {
      return reply.code(400).send({ error: "pedido_ativo_impede_cancelar" });
    }

    const { data, error } = await supabaseAdmin
      .from("atendimentos")
      // Limpa responsável e cronômetro junto — mesma lógica de `/devolver-ia`:
      // uma conversa cancelada não pode continuar exibindo quem atendia.
      .update({ status: "cancelado", responsavel_usuario_id: null, assumido_em: null })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_cancelar_atendimento" });
    }
    if (!data) {
      return reply.code(404).send({ error: "atendimento_nao_encontrado" });
    }

    // Handoff pendente não faz sentido numa conversa cancelada — resolve igual
    // a `/devolver-ia`. Falha é logada, não derruba o cancelamento (já feito).
    const { error: handoffError } = await supabaseAdmin
      .from("handoffs")
      .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
      .eq("atendimento_id", id)
      .eq("empresa_id", empresaId)
      .in("status", ["aberto", "assumido"]);
    if (handoffError) request.log.error(handoffError);

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
