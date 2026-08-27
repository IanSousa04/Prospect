import type { FastifyInstance } from "fastify";
import type { PedidoDetalhado, StatusPedido, FormaPagamento, TipoEntrega, EnderecoEntrega } from "@prospect/shared";
import { montarItensComSnapshot } from "@prospect/pedidos-core";
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

const STATUS_VALIDOS: StatusPedido[] = [
  "aberto",
  "confirmado",
  "em_preparo",
  "pronto",
  "saiu_para_entrega",
  "entregue",
  "cancelado",
];

// Transições permitidas — evita, por exemplo, "reabrir" um pedido já
// entregue/cancelado a partir do painel (mudança de status é uma ação
// operacional real, não um campo solto).
const TRANSICOES: Record<StatusPedido, StatusPedido[]> = {
  aberto: ["confirmado", "cancelado"],
  confirmado: ["em_preparo", "cancelado"],
  em_preparo: ["pronto", "cancelado"],
  pronto: ["saiu_para_entrega", "entregue", "cancelado"],
  saiu_para_entrega: ["entregue", "cancelado"],
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

    const montagem = await montarItensComSnapshot(supabaseAdmin, body.itens, empresaId);
    if (!montagem.ok) return reply.code(400).send({ error: montagem.erro });

    const total = Math.round((montagem.subtotal + body.taxa_entrega) * 100) / 100;

    const { data: pedido, error: pedidoError } = await supabaseAdmin
      .from("pedidos")
      .insert({
        empresa_id: empresaId,
        cliente_id: body.cliente_id,
        atendimento_id: body.atendimento_id,
        tipo_entrega: body.tipo_entrega,
        endereco_json: body.endereco_json,
        taxa_entrega: body.taxa_entrega,
        forma_pagamento: body.forma_pagamento,
        observacoes: body.observacoes,
        subtotal: montagem.subtotal,
        total,
      })
      .select()
      .single();

    if (pedidoError || !pedido) {
      request.log.error(pedidoError);
      return reply.code(500).send({ error: "erro_ao_criar_pedido" });
    }

    for (const [ordem, item] of montagem.itens.entries()) {
      const { data: itemCriado, error: itemError } = await supabaseAdmin
        .from("itens_pedido")
        .insert({
          empresa_id: empresaId,
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

      if (itemError || !itemCriado) {
        request.log.error(itemError);
        return reply.code(500).send({ error: "erro_ao_salvar_item_pedido" });
      }

      if (item.opcoes.length > 0) {
        await supabaseAdmin.from("itens_pedido_opcoes").insert(
          item.opcoes.map((o) => ({
            empresa_id: empresaId,
            item_pedido_id: itemCriado.id,
            opcao_id: o.opcao_id,
            nome_opcao: o.nome_opcao,
            preco_adicional: o.preco_adicional,
          })),
        );
      }
    }

    return reply.code(201).send(pedido);
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
        .select("status")
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
      return data;
    },
  );

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
