import type { FastifyInstance } from "fastify";
import type {
  GrupoOpcoesComOpcoes,
  Ingrediente,
  Produto,
  ProdutoDetalhado,
  TipoRelacao,
} from "@prospect/shared";
import { supabaseAdmin } from "../lib/supabase.js";
import { requireAuth } from "../lib/auth.js";

interface ProdutoBody {
  categoria_id: string | null;
  tipo: "produto" | "combo";
  nome: string;
  nome_curto: string | null;
  descricao: string | null;
  descricao_comercial: string | null;
  imagem_url: string | null;
  tags: string[];
  preco: number;
  preco_promocional: number | null;
  disponivel: boolean;
  horario_inicio: string | null;
  horario_fim: string | null;
  quantidade_minima: number;
  quantidade_maxima: number | null;
  tempo_preparo_minutos: number | null;
  restricoes: string | null;
}

interface ComposicaoBody {
  ingredientes: Array<Pick<Ingrediente, "nome" | "alergeno" | "ordem">>;
  grupos_opcoes: Array<
    Omit<GrupoOpcoesComOpcoes, "id" | "empresa_id" | "produto_id" | "opcoes"> & {
      opcoes: Array<Omit<GrupoOpcoesComOpcoes["opcoes"][number], "id" | "empresa_id" | "grupo_opcoes_id">>;
    }
  >;
}

/**
 * Confirma que todo produto_id em `ids` pertence à empresa — usado antes de
 * gravar qualquer referência entre produtos (recomendações, opção de combo
 * apontando pra outro produto). Sem isso, como as rotas usam service_role
 * (que ignora RLS), um payload malicioso poderia criar uma relação
 * apontando pra um produto de outra empresa (CLAUDE.md, regra 5).
 */
async function todosPertencemAEmpresa(ids: string[], empresaId: string): Promise<boolean> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return true;

  const { data, error } = await supabaseAdmin
    .from("produtos")
    .select("id")
    .eq("empresa_id", empresaId)
    .in("id", unicos);

  if (error) return false;
  return (data ?? []).length === unicos.length;
}

async function todosPertencemAEmpresaCategorias(ids: string[], empresaId: string): Promise<boolean> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return true;

  const { data, error } = await supabaseAdmin
    .from("categorias")
    .select("id")
    .eq("empresa_id", empresaId)
    .in("id", unicos);

  if (error) return false;
  return (data ?? []).length === unicos.length;
}

export async function produtosRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // Lista enxuta para a tela de catálogo — sem grupos de opções, que só o
  // editor de produto precisa.
  app.get("/produtos", async (request, reply) => {
    const { empresaId } = request.auth!;

    const { data, error } = await supabaseAdmin
      .from("produtos")
      .select("*, categoria:categorias(id,nome)")
      .eq("empresa_id", empresaId)
      .order("nome", { ascending: true });

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_produtos" });
    }
    return data;
  });

  app.get<{ Params: { id: string } }>("/produtos/:id", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data: produto, error } = await supabaseAdmin
      .from("produtos")
      .select(
        `*,
         categoria:categorias(*),
         ingredientes(*),
         grupos_opcoes(*, opcoes(*)),
         relacionados:produto_relacionados!produto_relacionados_produto_id_fkey(*, produto:produtos!produto_relacionados_relacionado_id_fkey(id,nome,imagem_url,preco,preco_promocional))`,
      )
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_buscar_produto" });
    }
    if (!produto) return reply.code(404).send({ error: "produto_nao_encontrado" });

    const detalhado: ProdutoDetalhado = {
      ...(produto as any),
      grupos_opcoes: ((produto as any).grupos_opcoes ?? []).sort(
        (a: any, b: any) => a.ordem - b.ordem,
      ),
    };
    return detalhado;
  });

  app.post<{ Body: ProdutoBody }>("/produtos", async (request, reply) => {
    const { empresaId } = request.auth!;
    const body = request.body;

    if (!body.nome?.trim() || body.preco == null) {
      return reply.code(400).send({ error: "nome_e_preco_obrigatorios" });
    }
    if (body.categoria_id && !(await todosPertencemAEmpresaCategorias([body.categoria_id], empresaId))) {
      return reply.code(400).send({ error: "categoria_invalida" });
    }

    const { data, error } = await supabaseAdmin
      .from("produtos")
      .insert({ ...body, empresa_id: empresaId, status: "rascunho" })
      .select()
      .single();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_criar_produto" });
    }
    return reply.code(201).send(data as Produto);
  });

  app.patch<{ Params: { id: string }; Body: Partial<ProdutoBody & { status: string }> }>(
    "/produtos/:id",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id } = request.params;

      if (
        request.body.categoria_id &&
        !(await todosPertencemAEmpresaCategorias([request.body.categoria_id], empresaId))
      ) {
        return reply.code(400).send({ error: "categoria_invalida" });
      }

      const { data, error } = await supabaseAdmin
        .from("produtos")
        .update(request.body)
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .select()
        .maybeSingle();

      if (error) {
        request.log.error(error);
        return reply.code(500).send({ error: "erro_ao_atualizar_produto" });
      }
      if (!data) return reply.code(404).send({ error: "produto_nao_encontrado" });
      return data as Produto;
    },
  );

  app.post<{ Params: { id: string } }>("/produtos/:id/arquivar", async (request, reply) => {
    const { empresaId } = request.auth!;
    const { id } = request.params;

    const { data, error } = await supabaseAdmin
      .from("produtos")
      .update({ status: "arquivado" })
      .eq("id", id)
      .eq("empresa_id", empresaId)
      .select()
      .maybeSingle();

    if (error) {
      request.log.error(error);
      return reply.code(500).send({ error: "erro_ao_arquivar_produto" });
    }
    if (!data) return reply.code(404).send({ error: "produto_nao_encontrado" });
    return data;
  });

  // Substitui ingredientes + grupos de opções (com suas opções) inteiros —
  // é assim que o editor de produto salva a personalização toda de uma vez.
  // Delete-then-insert é seguro aqui porque tudo é escopado por produto_id +
  // empresa_id e roda sequencialmente numa única requisição.
  app.put<{ Params: { id: string }; Body: ComposicaoBody }>(
    "/produtos/:id/composicao",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id: produtoId } = request.params;
      const { ingredientes, grupos_opcoes } = request.body;

      const { data: produto } = await supabaseAdmin
        .from("produtos")
        .select("id")
        .eq("id", produtoId)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!produto) return reply.code(404).send({ error: "produto_nao_encontrado" });

      const produtosReferenciados = grupos_opcoes
        .flatMap((g) => g.opcoes.map((o) => o.produto_referenciado_id))
        .filter((v): v is string => v != null);
      if (!(await todosPertencemAEmpresa(produtosReferenciados, empresaId))) {
        return reply.code(400).send({ error: "produto_referenciado_invalido" });
      }

      await supabaseAdmin.from("ingredientes").delete().eq("produto_id", produtoId);
      if (ingredientes.length > 0) {
        await supabaseAdmin
          .from("ingredientes")
          .insert(ingredientes.map((i) => ({ ...i, empresa_id: empresaId, produto_id: produtoId })));
      }

      // grupos_opcoes tem FK cascade em opcoes — apagar o grupo já limpa as opções.
      await supabaseAdmin.from("grupos_opcoes").delete().eq("produto_id", produtoId);

      for (const grupo of grupos_opcoes) {
        const { opcoes, ...grupoBase } = grupo;
        const { data: grupoCriado, error: grupoError } = await supabaseAdmin
          .from("grupos_opcoes")
          .insert({ ...grupoBase, empresa_id: empresaId, produto_id: produtoId })
          .select("id")
          .single();

        if (grupoError || !grupoCriado) {
          request.log.error(grupoError);
          return reply.code(500).send({ error: "erro_ao_salvar_grupo_opcoes" });
        }

        if (opcoes.length > 0) {
          await supabaseAdmin.from("opcoes").insert(
            opcoes.map((o) => ({ ...o, empresa_id: empresaId, grupo_opcoes_id: grupoCriado.id })),
          );
        }
      }

      return { ok: true };
    },
  );

  app.put<{ Params: { id: string }; Body: { relacionados: Array<{ relacionado_id: string; tipo: TipoRelacao }> } }>(
    "/produtos/:id/relacionados",
    async (request, reply) => {
      const { empresaId } = request.auth!;
      const { id: produtoId } = request.params;
      const { relacionados } = request.body;

      const { data: produto } = await supabaseAdmin
        .from("produtos")
        .select("id")
        .eq("id", produtoId)
        .eq("empresa_id", empresaId)
        .maybeSingle();
      if (!produto) return reply.code(404).send({ error: "produto_nao_encontrado" });

      if (!(await todosPertencemAEmpresa(relacionados.map((r) => r.relacionado_id), empresaId))) {
        return reply.code(400).send({ error: "produto_relacionado_invalido" });
      }

      await supabaseAdmin.from("produto_relacionados").delete().eq("produto_id", produtoId);
      if (relacionados.length > 0) {
        await supabaseAdmin.from("produto_relacionados").insert(
          relacionados.map((r) => ({
            empresa_id: empresaId,
            produto_id: produtoId,
            relacionado_id: r.relacionado_id,
            tipo: r.tipo,
          })),
        );
      }

      return { ok: true };
    },
  );
}
