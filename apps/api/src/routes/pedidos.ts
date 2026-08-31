import type { FastifyInstance } from "fastify";
import type { PedidoDetalhado, StatusPedido, FormaPagamento, TipoEntrega, EnderecoEntrega } from "@prospect/shared";
import { criarPedidoComItens, textoNotificacaoStatusPedido } from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

interface ItemBody {
  produto_id: string;
  quantidade: number;
  observacoes: string | null;
  opcoes: Array<{ opcao_id: string }>;
}

interface CriarPedidoBody {
  cliente_id: string;
  atendimento_id: string | null;
  tipo_entrega: TipoEntrega;
  endereco_json: EnderecoEntrega | null;
  taxa_entrega: number;
  forma_pagamento: FormaPagamento | null;
  observacoes: string | null;
  itens: ItemBody[];
}

const STATUS_VALIDOS: StatusPedido[] = ["aberto", "em_preparacao", "pronto", "entregue", "cancelado"];

// Transições permitidas — evita, por exemplo, "reabrir" um pedido já
// entregue/cancelado a partir do painel (mudança de status é uma ação
// operacional real, não um campo solto).
const TRANSICOES: Record<StatusPedido, StatusPedido[]> = {
  aberto: ["em_preparacao", "cancelado"],
  em_preparacao: ["pronto", "cancelado"],
  pronto: ["entregue", "cancelado"],
  entregue: [],
  cancelado: [],
};

export async function pedidosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { cliente_id?: string; atendimento_id?: string } }>(
    "/pedidos",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      let query = supabaseAdmin.from("pedidos").select("*").eq("empresa_id", empresaId);

      if (request.query.cliente_id) query = query.eq("cliente_id", request.query.cliente_id);
      if (request.query.atendimento_id) query = query.eq("atendimento_id", request.query.atendimento_id);

      const { data, error } = await query.order("criado_em", { ascending: false });
      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_buscar_pedidos" });
      }
      return data;
    },
  );

  app.get<{ Params: { id: string } }>("/pedidos/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .select("*, itens:itens_pedido(*, opcoes:itens_pedido_opcoes(*))")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_pedido" });
    }
    if (!data) return reply.code(404).send({ error: "pedido_nao_encontrado" });
    return data as PedidoDetalhado;
  });

  app.post<{ Body: CriarPedidoBody }>("/pedidos", async (request, reply) => {
    const { empresaId } = request.auth!;
    const body = request.body;

    if (!body.cliente_id || body.itens.length === 0) {
      return reply.code(400).send({ error: "cliente_e_itens_obrigatorios" });
    }

    const { data: cliente } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", body.cliente_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!cliente) return reply.code(400).send({ error: "cliente_invalido" });

    if (body.atendimento_id) {
      const { data: atendimento } = await supabaseAdmin
        .from("atendimentos")
        .select("id")
        .eq("id", body.atendimento_id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!atendimento) return reply.code(400).send({ error: "atendimento_invalido" });
    }

    const resultado = await criarPedidoComItens(supabaseAdmin, {
      empresaId,
      clienteId: body.cliente_id,
      atendimentoId: body.atendimento_id,
      origem: "painel",
      tipoEntrega: body.tipo_entrega,
      enderecoJson: body.endereco_json,
      taxaEntrega: body.taxa_entrega,
      formaPagamento: body.forma_pagamento,
      observacoes: body.observacoes,
      itens: body.itens,
    });

    if (!resultado.ok) {
      const codigo = resultado.erro === "erro_ao_criar_pedido" || resultado.erro === "erro_ao_salvar_item_pedido" ? 500 : 400;
      if (codigo === 500) request.log.error(resultado.erro);
      return reply.code(codigo).send({ error: resultado.erro });
    }

    return reply.code(201).send(resultado.pedido);
  });

  app.post<{ Params: { id: string }; Body: { status: StatusPedido } }>(
    "/pedidos/:id/status",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id } = request.params;
      const { status: novoStatus } = request.body;

      if (!STATUS_VALIDOS.includes(novoStatus)) {
        return reply.code(400).send({ error: "status_invalido" });
      }

      const { data: pedido } = await supabaseAdmin
        .from("pedidos")
        .select("status, cliente_id, tipo_entrega")
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!pedido) return reply.code(404).send({ error: "pedido_nao_encontrado" });

      const permitido = TRANSICOES[pedido.status as StatusPedido]?.includes(novoStatus);
      if (!permitido) {
        return reply.code(400).send({ error: "transicao_de_status_nao_permitida" });
      }

      const { data, error } = await supabaseAdmin
        .from("pedidos")
        .update({ status: novoStatus })
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .select()
        .single();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_atualizar_status" });
      }

      // Notificação de progresso do pedido (colunas "Na cozinha"/"Pronto" do
      // Kanban): enfileira pra o whatsapp-worker enviar ao cliente SEM passar
      // por `mensagens` (que é histórico de conversa). A mudança de status já
      // aconteceu; se o enfileiramento falhar, logamos e o pedido segue — o
      // envio é best-effort e não pode reverter o status persistido.
      if (novoStatus === "em_preparacao" || novoStatus === "pronto") {
        const { error: notifError } = await supabaseAdmin
          .from("notificacoes_pedido")
          .insert({
            empresa_id: empresaId,
            pedido_id: id,
            cliente_id: pedido.cliente_id,
            tipo: novoStatus,
            conteudo: textoNotificacaoStatusPedido(novoStatus, pedido.tipo_entrega),
          });
        if (notifError) {
          request.log.error(
            { pedidoId: id, status: novoStatus },
            "falha ao enfileirar notificação de status do pedido",
          );
        }
      }

      return data;
    },
  );

  // Finalizar entrega — transição COMPOSTA (pedido entregue + atendimento
  // encerrado), por isso é uma rota só e não duas chamadas encadeadas pelo
  // painel: quem tem autoridade sobre estado transacional é o backend
  // (CLAUDE.md regra 9). Encerrar o atendimento junto é o que tira o card do
  // Kanban de vez; se o cliente voltar a escrever, o ingest do worker abre um
  // atendimento novo em `ia_atendendo` sozinho.
  app.post<{ Params: { id: string } }>("/pedidos/:id/entregar", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("status, atendimento_id")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!pedido) return reply.code(404).send({ error: "pedido_nao_encontrado" });

    if (!TRANSICOES[pedido.status as StatusPedido]?.includes("entregue")) {
      return reply.code(400).send({ error: "transicao_de_status_nao_permitida" });
    }

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .update({ status: "entregue" })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_entregar_pedido" });
    }

    if (pedido.atendimento_id) {
      // Handoff pendente bloquearia o `resolvido` (ver
      // `handoff_pendente_impede_finalizar` em atendimentos.ts) — e, com o
      // pedido entregue, o motivo que gerou o handoff já se encerrou. Mesmo
      // tratamento que `/atendimentos/:id/devolver-ia` dá.
      const { error: handoffError } = await supabaseAdmin
        .from("handoffs")
        .update({ status: "resolvido", resolvido_em: new Date().toISOString() })
        .eq("atendimento_id", pedido.atendimento_id)
        .eq("empresa_id", empresaId)
        .in("status", ["aberto", "assumido"]);
      if (handoffError) request.log.error(handoffError);

      const { error: atendimentoError } = await supabaseAdmin
        .from("atendimentos")
        .update({ status: "resolvido" })
        .eq("id", pedido.atendimento_id)
        .eq("empresa_id", empresaId)
        .neq("status", "resolvido");
      // A entrega em si já está persistida; se encerrar a conversa falhar, o
      // card volta pra coluna de conversa em vez de sumir — estado visível e
      // corrigível na mão, melhor que reverter uma entrega que aconteceu.
      if (atendimentoError) request.log.error(atendimentoError);
    }

    return data;
  });

  // Arquivar (tarefa 0066) — sai da visão ativa do board unificado sem
  // mexer em `status` (fonte de verdade própria, consumida por outras
  // rotas isoladamente); só permitido em pedidos que já saíram do fluxo
  // ativo, nunca num pedido ainda em preparação.
  app.post<{ Params: { id: string } }>("/pedidos/:id/arquivar", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data: pedido } = await supabaseAdmin
      .from("pedidos")
      .select("status")
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!pedido) return reply.code(404).send({ error: "pedido_nao_encontrado" });

    if (!["entregue", "cancelado"].includes(pedido.status)) {
      return reply.code(400).send({ error: "pedido_ativo_nao_pode_ser_arquivado" });
    }

    const { data, error } = await supabaseAdmin
      .from("pedidos")
      .update({ arquivado_em: new Date().toISOString() })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_arquivar_pedido" });
    }
    if (!data) return reply.code(404).send({ error: "pedido_nao_encontrado" });
    return data;
  });

  app.post<{ Params: { id: string }; Body: { status_pagamento: string } }>(
    "/pedidos/:id/pagamento",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id } = request.params;
      const { status_pagamento } = request.body;

      if (!["pendente", "pago", "parcial", "estornado"].includes(status_pagamento)) {
        return reply.code(400).send({ error: "status_pagamento_invalido" });
      }

      const { data, error } = await supabaseAdmin
        .from("pedidos")
        .update({ status_pagamento })
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .select()
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_atualizar_pagamento" });
      }
      if (!data) return reply.code(404).send({ error: "pedido_nao_encontrado" });
      return data;
    },
  );
}
