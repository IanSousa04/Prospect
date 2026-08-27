import type { FastifyInstance } from "fastify";
import type { AtendimentoComContexto, StatusAtendimento } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

const STATUS_VALIDOS: StatusAtendimento[] = [
  "ia_atendendo",
  "ia_solicitou_humano",
  "cliente_solicitou_humano",
  "humano_atendendo",
  "resolvido",
];

// Transições permitidas via PATCH genérico — mesmo padrão de
// `TRANSICOES` em pedidos.ts. `/assumir` e `/devolver-ia` continuam sendo
// os caminhos normais pra entrar/sair de `humano_atendendo`/`ia_atendendo`;
// esta rota cobre o resto (ex.: IA escalando pra "solicitou humano",
// cliente pedindo humano, ou finalizar a partir de qualquer estado ativo).
const TRANSICOES: Record<StatusAtendimento, StatusAtendimento[]> = {
  ia_atendendo: ["ia_solicitou_humano", "cliente_solicitou_humano", "humano_atendendo", "resolvido"],
  ia_solicitou_humano: ["humano_atendendo", "ia_atendendo", "resolvido"],
  cliente_solicitou_humano: ["humano_atendendo", "ia_atendendo", "resolvido"],
  humano_atendendo: ["ia_atendendo", "resolvido"],
  resolvido: [],
};

function paraContexto(row: any): AtendimentoComContexto {
  return {
    ...row,
    cliente: row.cliente,
    handoff_aberto: (row.handoffs ?? []).find((h: any) => h.status === "aberto") ?? null,
    pedido_aberto: (row.pedidos ?? []).find((p: any) => p.status !== "cancelado") ?? null,
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
         pedidos(*)`,
      )
      .eq("empresa_id", empresaId)
      .order("ultima_mensagem_em", { ascending: false });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_atendimentos" });
    }

    const atendimentos: AtendimentoComContexto[] = (data ?? []).map(paraContexto);

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
         pedidos(*)`,
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

  // Assumir atendimento — ação de 1 clique do Kanban/tela de conversa.
  // Regra: só move status pra humano_atendendo se ainda não estava resolvido.
  app.post<{ Params: { id: string } }>("/atendimentos/:id/assumir", async (request, reply) => {
    const { empresaId, usuarioId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("atendimentos")
      .update({ status: "humano_atendendo", responsavel_usuario_id: usuarioId })
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
      .update({ status: "ia_atendendo" })
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
