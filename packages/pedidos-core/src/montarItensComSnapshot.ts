import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Monta os itens de um pedido com preço travado no catálogo real (snapshot)
 * — nunca confia em preço vindo do caller (CLAUDE.md regra 1: nenhum dado
 * comercial sem fonte rastreável). Compartilhada entre `POST /pedidos`
 * (painel humano, apps/api) e a página pública (`POST /publico/pedido`) — a
 * lógica de "o que pode ser vendido agora, por quanto" não pode divergir
 * entre os dois caminhos.
 *
 * Validações cobertas (além do preço):
 * - produto existe, pertence à empresa, está `ativo` (nem rascunho nem arquivado) e `disponivel`.
 * - quantidade dentro de `quantidade_minima`/`quantidade_maxima` do produto.
 * - dentro da janela `horario_inicio`/`horario_fim`, quando o produto define uma.
 * - toda opção escolhida pertence a um grupo de opções DESSE produto e à empresa, e está `disponivel`.
 * - todo grupo `obrigatorio` do produto tem pelo menos 1 opção escolhida.
 * - toda opção escolhida respeita `minimo`/`maximo` do grupo a que pertence.
 */

export interface ItemPedidoInput {
  produto_id: string;
  quantidade: number;
  observacoes: string | null;
  opcoes: Array<{ opcao_id: string }>;
}

export interface ItemMontado {
  produto_id: string;
  nome_produto: string;
  preco_unitario: number;
  quantidade: number;
  observacoes: string | null;
  opcoes: Array<{ opcao_id: string; nome_opcao: string; preco_adicional: number }>;
}

export type MontarItensResultado =
  | { ok: true; itens: ItemMontado[]; subtotal: number }
  | { ok: false; erro: string };

function minutosDoDia(horaHHMMSS: string): number {
  const [h, m] = horaHHMMSS.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function dentroDoHorario(agora: number, inicio: number, fim: number): boolean {
  // janela que cruza a meia-noite (ex: 18:00–02:00)
  if (inicio <= fim) return agora >= inicio && agora <= fim;
  return agora >= inicio || agora <= fim;
}

export async function montarItensComSnapshot(
  supabase: SupabaseClient,
  itens: ItemPedidoInput[],
  empresaId: string,
): Promise<MontarItensResultado> {
  if (itens.length === 0) {
    return { ok: false, erro: "nenhum_item_informado" };
  }

  const produtoIds = [...new Set(itens.map((i) => i.produto_id))];
  const { data: produtos, error: produtosError } = await supabase
    .from("produtos")
    .select("id, nome, preco, preco_promocional, disponivel, status, quantidade_minima, quantidade_maxima, horario_inicio, horario_fim")
    .eq("empresa_id", empresaId)
    .in("id", produtoIds);
  if (produtosError) return { ok: false, erro: "erro_ao_consultar_catalogo" };

  interface GrupoOpcoesResumo {
    id: string;
    produto_id: string;
    obrigatorio: boolean;
    minimo: number;
    maximo: number;
  }

  const { data: grupos, error: gruposError } = await supabase
    .from("grupos_opcoes")
    .select("id, produto_id, obrigatorio, minimo, maximo")
    .eq("empresa_id", empresaId)
    .in("produto_id", produtoIds);
  if (gruposError) return { ok: false, erro: "erro_ao_consultar_catalogo" };
  const gruposTyped = (grupos ?? []) as GrupoOpcoesResumo[];

  const opcaoIds = [...new Set(itens.flatMap((i) => i.opcoes.map((o) => o.opcao_id)))];
  const { data: opcoesCatalogo, error: opcoesError } =
    opcaoIds.length > 0
      ? await supabase
          .from("opcoes")
          .select("id, nome, preco_adicional, empresa_id, grupo_opcoes_id, disponivel")
          .in("id", opcaoIds)
      : { data: [], error: null };
  if (opcoesError) return { ok: false, erro: "erro_ao_consultar_catalogo" };

  const produtosPorId = new Map((produtos ?? []).map((p) => [p.id, p]));
  const opcoesPorId = new Map((opcoesCatalogo ?? []).map((o) => [o.id, o]));
  const gruposPorProduto = new Map<string, GrupoOpcoesResumo[]>();
  for (const g of gruposTyped) {
    const lista = gruposPorProduto.get(g.produto_id) ?? [];
    lista.push(g);
    gruposPorProduto.set(g.produto_id, lista);
  }

  const agoraMin = minutosDoDia(
    new Date().toLocaleTimeString("pt-BR", { hour12: false, timeZone: "America/Sao_Paulo" }),
  );

  let subtotal = 0;
  const montados: ItemMontado[] = [];

  for (const item of itens) {
    const produto = produtosPorId.get(item.produto_id);
    if (!produto || produto.status !== "ativo" || !produto.disponivel) {
      return { ok: false, erro: `produto_indisponivel:${item.produto_id}` };
    }

    if (item.quantidade < produto.quantidade_minima) {
      return { ok: false, erro: `quantidade_abaixo_do_minimo:${item.produto_id}` };
    }
    if (produto.quantidade_maxima != null && item.quantidade > produto.quantidade_maxima) {
      return { ok: false, erro: `quantidade_acima_do_maximo:${item.produto_id}` };
    }

    if (produto.horario_inicio && produto.horario_fim) {
      const dentro = dentroDoHorario(
        agoraMin,
        minutosDoDia(produto.horario_inicio),
        minutosDoDia(produto.horario_fim),
      );
      if (!dentro) return { ok: false, erro: `produto_fora_do_horario:${item.produto_id}` };
    }

    const opcoesResolvidas: Array<{ opcao_id: string; nome_opcao: string; preco_adicional: number; grupo_opcoes_id: string }> = [];
    for (const o of item.opcoes) {
      const opcao = opcoesPorId.get(o.opcao_id);
      if (!opcao || opcao.empresa_id !== empresaId || !opcao.disponivel) {
        return { ok: false, erro: `opcao_invalida:${item.produto_id}` };
      }
      opcoesResolvidas.push({
        opcao_id: o.opcao_id,
        nome_opcao: opcao.nome,
        preco_adicional: Number(opcao.preco_adicional),
        grupo_opcoes_id: opcao.grupo_opcoes_id,
      });
    }

    // toda opção precisa pertencer a um grupo DESTE produto — impede opção
    // de outro produto (mesmo que da mesma empresa) vazar pro pedido.
    const gruposDoProduto = gruposPorProduto.get(item.produto_id) ?? [];
    const gruposDoProdutoIds = new Set(gruposDoProduto.map((g) => g.id));
    if (opcoesResolvidas.some((o) => !gruposDoProdutoIds.has(o.grupo_opcoes_id))) {
      return { ok: false, erro: `opcao_invalida:${item.produto_id}` };
    }

    const contagemPorGrupo = new Map<string, number>();
    for (const o of opcoesResolvidas) {
      contagemPorGrupo.set(o.grupo_opcoes_id, (contagemPorGrupo.get(o.grupo_opcoes_id) ?? 0) + 1);
    }
    for (const grupo of gruposDoProduto) {
      const count = contagemPorGrupo.get(grupo.id) ?? 0;
      if (grupo.obrigatorio && count === 0) {
        return { ok: false, erro: `grupo_obrigatorio_nao_preenchido:${item.produto_id}:${grupo.id}` };
      }
      if (count < grupo.minimo) {
        return { ok: false, erro: `grupo_abaixo_do_minimo:${item.produto_id}:${grupo.id}` };
      }
      if (count > grupo.maximo) {
        return { ok: false, erro: `grupo_acima_do_maximo:${item.produto_id}:${grupo.id}` };
      }
    }

    const precoUnitario = Number(produto.preco_promocional ?? produto.preco);
    const precoOpcoes = opcoesResolvidas.reduce((acc, o) => acc + o.preco_adicional, 0);
    subtotal += (precoUnitario + precoOpcoes) * item.quantidade;

    montados.push({
      produto_id: produto.id,
      nome_produto: produto.nome,
      preco_unitario: precoUnitario,
      quantidade: item.quantidade,
      observacoes: item.observacoes,
      opcoes: opcoesResolvidas.map((o) => ({
        opcao_id: o.opcao_id,
        nome_opcao: o.nome_opcao,
        preco_adicional: o.preco_adicional,
      })),
    });
  }

  return { ok: true, itens: montados, subtotal: Math.round(subtotal * 100) / 100 };
}
