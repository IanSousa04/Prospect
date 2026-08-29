// Resolução determinística dos itens citados pelo cliente (tarefa 0082) —
// a peça que faltava na 0081.
//
// Até aqui, `adicionar_ao_carrinho` era a única mutação que continuava
// dependendo de o modelo decidir chamá-la. Numa conversa real ele discutiu o
// X-Bacon por três turnos, respondeu tudo certo sobre preço e adicionais, e
// nunca chamou a ferramenta: o carrinho ficou vazio, `derivarEstadoCheckout`
// devolveu `sem_carrinho`, e toda a máquina de estados da 0081 permaneceu
// inerte até o fim do atendimento.
//
// Agora o LLM só diz O QUE o cliente citou (`ItemMencionado`, mensagem.ts) e
// este módulo faz o resto em código: procura no catálogo real, decide se dá
// pra agir, e executa. Zero resultados vira um fato negativo explícito ("não
// existe pizza no cardápio") em vez de silêncio — foi a ausência desse fato
// que deixou a IA responder "temos várias opções" logo depois de uma busca
// que não achou nada.
import type { ItemCarrinho, NomeFerramenta, OrderContext } from "@prospect/shared";
import type { ToolContext } from "../../tools/index.js";
import type { EvidenciaColetada } from "../investigador.js";
import { erroDaExecucao, type FalhaDeFerramenta, type PortasDoWorkflow } from "../portas.js";
import type { ItemMencionado } from "./mensagem.js";

interface ProdutoDoCatalogo {
  id: string;
  nome: string;
}

interface OpcaoDoProduto {
  id: string;
  nome: string;
  disponivel: boolean;
}

export interface ItemAdicionado {
  /** Como o cliente escreveu — usado só em log/invariante, nunca na
   * mensagem ao cliente. */
  texto: string;
  produto_id: string;
  nome: string;
  quantidade: number;
  /** Adicionais citados que não existem pra este produto. Viram fato, nunca
   * são silenciosamente ignorados nem inventados. */
  adicionais_ignorados: string[];
}

export interface ItemAmbiguo {
  texto: string;
  candidatos: string[];
}

export interface ResultadoResolucaoItens {
  adicionados: ItemAdicionado[];
  removidos: string[];
  quantidadeAlterada: Array<{ nome: string; quantidade: number }>;
  /** Citados pelo cliente e inexistentes no cardápio — cada um vira o fato
   * "não existe X no cardápio". */
  naoEncontrados: string[];
  /** Mais de um produto plausível: nunca escolhe sozinho (CLAUDE.md regra 1
   * e regra 3 do prompt do Investigador), vira pergunta de esclarecimento
   * com os nomes reais. */
  ambiguos: ItemAmbiguo[];
  /** Pedido pra tirar/alterar algo que não está no carrinho. */
  naoEstaNoCarrinho: string[];
  evidencias: EvidenciaColetada[];
  falhas: FalhaDeFerramenta[];
}

const RESULTADO_VAZIO: ResultadoResolucaoItens = {
  adicionados: [],
  removidos: [],
  quantidadeAlterada: [],
  naoEncontrados: [],
  ambiguos: [],
  naoEstaNoCarrinho: [],
  evidencias: [],
  falhas: [],
};

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Casamento tolerante entre o que o cliente escreveu e um nome real do
 * catálogo: todas as palavras de um precisam aparecer no outro. Cobre
 * "x bacon" → "X-Bacon" e "bacon extra" → "Bacon extra" sem aceitar
 * qualquer coisa. */
function casaNome(escrito: string, real: string): boolean {
  const a = normalizar(escrito);
  const b = normalizar(real);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const palavras = a.split(" ").filter(Boolean);
  return palavras.length > 0 && palavras.every((p) => b.includes(p));
}

function resultadosDoOutput(output: unknown): ProdutoDoCatalogo[] {
  if (!output || typeof output !== "object") return [];
  const lista = (output as Record<string, unknown>).resultados;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .filter((p) => typeof p.id === "string" && typeof p.nome === "string")
    .map((p) => ({ id: p.id as string, nome: p.nome as string }));
}

function opcoesDoOutput(output: unknown): OpcaoDoProduto[] {
  if (!output || typeof output !== "object") return [];
  const grupos = (output as Record<string, unknown>).grupos;
  if (!Array.isArray(grupos)) return [];
  const opcoes: OpcaoDoProduto[] = [];
  for (const grupo of grupos) {
    const lista = (grupo as Record<string, unknown>)?.opcoes;
    if (!Array.isArray(lista)) continue;
    for (const o of lista) {
      const opcao = o as Record<string, unknown>;
      if (typeof opcao.id === "string" && typeof opcao.nome === "string") {
        opcoes.push({ id: opcao.id, nome: opcao.nome, disponivel: opcao.disponivel !== false });
      }
    }
  }
  return opcoes;
}

function linhaDoCarrinho(pedido: OrderContext, texto: string): ItemCarrinho | null {
  return pedido.itens.find((item) => casaNome(texto, item.nome_produto)) ?? null;
}

async function executarEColetar(
  portas: PortasDoWorkflow,
  ctx: ToolContext,
  nome: NomeFerramenta,
  input: unknown,
  acumulador: { evidencias: EvidenciaColetada[]; falhas: FalhaDeFerramenta[] },
): Promise<unknown | null> {
  const execucao = await portas.executar(nome, input, ctx);
  if (execucao.sucesso && execucao.execucaoId) {
    acumulador.evidencias.push({ execucaoId: execucao.execucaoId, toolNome: nome, output: execucao.output });
  }
  const erro = erroDaExecucao(execucao);
  if (erro) {
    acumulador.falhas.push({ tool: nome, erro });
    return null;
  }
  return execucao.output;
}

/**
 * Para cada item que o cliente citou: busca no catálogo real e age.
 *
 * - exatamente 1 produto → `adicionar_ao_carrinho` executado pelo código;
 * - 0 produtos → fato negativo ("não existe X no cardápio");
 * - vários → esclarecimento com os nomes reais, nunca escolhendo sozinho.
 *
 * Nenhum caminho aqui depende de o modelo "lembrar" de chamar ferramenta.
 */
export async function resolverItensMencionados(params: {
  itens: ItemMencionado[];
  ctx: ToolContext;
  portas: PortasDoWorkflow;
}): Promise<ResultadoResolucaoItens> {
  const { itens, ctx, portas } = params;
  if (itens.length === 0) return { ...RESULTADO_VAZIO };

  const resultado: ResultadoResolucaoItens = {
    adicionados: [],
    removidos: [],
    quantidadeAlterada: [],
    naoEncontrados: [],
    ambiguos: [],
    naoEstaNoCarrinho: [],
    evidencias: [],
    falhas: [],
  };

  for (const item of itens) {
    if (item.acao === "remover" || item.acao === "alterar_quantidade") {
      const pedido = await portas.carregarPedido(ctx);
      const linha = linhaDoCarrinho(pedido, item.texto);
      if (!linha) {
        resultado.naoEstaNoCarrinho.push(item.texto);
        continue;
      }
      if (item.acao === "remover") {
        await executarEColetar(portas, ctx, "remover_do_carrinho", { linha_id: linha.linha_id }, resultado);
        resultado.removidos.push(linha.nome_produto);
      } else {
        await executarEColetar(
          portas,
          ctx,
          "atualizar_item_carrinho",
          { linha_id: linha.linha_id, quantidade: item.quantidade },
          resultado,
        );
        resultado.quantidadeAlterada.push({ nome: linha.nome_produto, quantidade: item.quantidade });
      }
      continue;
    }

    // Produto primeiro, combo como segunda tentativa — a busca por palavra
    // de `buscar_produtos` (tools/catalogo.ts) já resolve "x bacon" → "X-Bacon".
    const saidaProdutos = await executarEColetar(portas, ctx, "buscar_produtos", { termo: item.texto }, resultado);
    let candidatos = resultadosDoOutput(saidaProdutos);
    if (candidatos.length === 0) {
      const saidaCombos = await executarEColetar(portas, ctx, "buscar_combos", { termo: item.texto }, resultado);
      candidatos = resultadosDoOutput(saidaCombos);
    }

    if (candidatos.length === 0) {
      resultado.naoEncontrados.push(item.texto);
      continue;
    }
    if (candidatos.length > 1) {
      // Nome idêntico ao que o cliente escreveu desempata; senão, pergunta.
      const exato = candidatos.filter((c) => normalizar(c.nome) === normalizar(item.texto));
      if (exato.length !== 1) {
        resultado.ambiguos.push({ texto: item.texto, candidatos: candidatos.map((c) => c.nome).slice(0, 3) });
        continue;
      }
      candidatos = exato;
    }

    const produto = candidatos[0]!;

    // Adicionais citados só entram se existirem de verdade neste produto.
    const opcoesEscolhidas: Array<{ opcao_id: string }> = [];
    const adicionaisIgnorados: string[] = [];
    if (item.adicionais_texto.length > 0) {
      const saidaOpcoes = await executarEColetar(portas, ctx, "buscar_adicionais", { produto_id: produto.id }, resultado);
      const disponiveis = opcoesDoOutput(saidaOpcoes).filter((o) => o.disponivel);
      for (const texto of item.adicionais_texto) {
        const encontrada = disponiveis.find((o) => casaNome(texto, o.nome));
        if (encontrada) opcoesEscolhidas.push({ opcao_id: encontrada.id });
        else adicionaisIgnorados.push(texto);
      }
    }

    const saidaAdicao = await executarEColetar(
      portas,
      ctx,
      "adicionar_ao_carrinho",
      {
        produto_id: produto.id,
        quantidade: item.quantidade,
        observacoes: item.observacao,
        opcoes: opcoesEscolhidas,
      },
      resultado,
    );
    if (saidaAdicao === null) continue;

    resultado.adicionados.push({
      texto: item.texto,
      produto_id: produto.id,
      nome: produto.nome,
      quantidade: item.quantidade,
      adicionais_ignorados: adicionaisIgnorados,
    });
  }

  return resultado;
}
