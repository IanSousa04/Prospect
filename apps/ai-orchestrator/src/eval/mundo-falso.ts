// Mundo falso do gabarito — estado de sessão em memória + um executor que
// reproduz o efeito real de cada ferramenta sobre esse estado.
//
// É o que permite rodar o pipeline determinístico inteiro (interpretação →
// resolução de itens → mutações de checkout → roteamento de perguntas →
// criação de pedido) sem banco, sem LLM e sem rede, em milissegundos.
//
// Regra que mantém o gabarito honesto: nada de regra de negócio é
// reimplementado aqui. A validação de `criar_pedido` chama
// `validarPreRequisitosDeCriacao`, a mesma função pura que a tool real usa em
// produção; o casamento de nome de produto imita a busca por palavra de
// `tools/catalogo.ts`. O que é simulado é só a persistência.
import type {
  AguardandoConfirmacao,
  FluxoPedidoConfig,
  ItemCarrinho,
  NomeFerramenta,
  OrderContext,
  UltimoPedidoCriado,
} from "@prospect/shared";
import {
  FLUXO_PEDIDO_CONFIG_PADRAO,
  calcularHashConfirmacao,
  construirResumoTexto,
  pedidoVazio,
  resumoPedidoIa,
} from "@prospect/shared";
import type { ChatModel } from "../llm/types.js";
import type { ResultadoExecucaoTool, ToolContext } from "../tools/index.js";
import type { EventoInvariante } from "../agent/checkout/invariantes.js";
import type { PortasDoWorkflow } from "../agent/portas.js";
import { validarPreRequisitosDeCriacao } from "../agent/checkout/validacao-criacao.js";

export interface ProdutoFalso {
  id: string;
  nome: string;
  preco: number;
}

export interface OpcaoFalsa {
  id: string;
  nome: string;
  preco_adicional: number;
}

/** Catálogo espelhado do da empresa de teste real — três produtos, nenhuma
 * pizza. É de propósito: o episódio que motivou a tarefa 0082 começou com
 * "quero uma pizza" numa loja que não vende pizza. */
export const CATALOGO_FALSO: ProdutoFalso[] = [
  { id: "p-xbacon", nome: "X-Bacon", preco: 32.9 },
  { id: "p-batata", nome: "Batata Frita", preco: 14.9 },
  { id: "p-coca", nome: "Coca-Cola 350ml", preco: 6.9 },
];

export const ADICIONAIS_FALSOS: OpcaoFalsa[] = [
  { id: "a-bacon", nome: "Bacon extra", preco_adicional: 5 },
  { id: "a-queijo", nome: "Queijo extra", preco_adicional: 4 },
  { id: "a-ovo", nome: "Ovo", preco_adicional: 3 },
];

export interface MundoFalso {
  pedido: OrderContext;
  confirmacao: AguardandoConfirmacao | null;
  ultimoPedidoCriado: UltimoPedidoCriado | null;
  chamadas: Array<{ tool: NomeFerramenta; input: unknown }>;
  invariantes: Array<{ evento: EventoInvariante; detalhe: Record<string, unknown> }>;
  pedidosCriados: string[];
  sequencia: number;
}

export interface OpcoesDoMundo {
  /** Força uma tool a devolver erro de negócio (mesmo formato das tools
   * reais: execução com sucesso, `erro` no output). */
  erros?: Partial<Record<NomeFerramenta, string>>;
  /** Simula o gate de risco da empresa bloqueando `criar_pedido`. */
  bloqueioDeRisco?: { motivo: string; total: number };
  /** Conteúdo cadastrado por categoria de conhecimento. Ausente = vazio,
   * que é o caso real de `regiao`, `horario` e `politica` na empresa de
   * teste — e é justamente o vazio que precisa virar fato, nunca improviso. */
  conhecimento?: Partial<Record<"entrega" | "regiao" | "horario" | "politica" | "livre", string>>;
  config?: FluxoPedidoConfig;
  agora?: () => Date;
}

export const CTX_FALSO = {
  empresaId: "empresa-teste",
  atendimentoId: "atendimento-teste",
  clienteId: "cliente-teste",
  mensagemId: null,
} as unknown as ToolContext;

export function item(nome: string, preco: number, quantidade = 1, linhaId = "l1"): ItemCarrinho {
  return {
    linha_id: linhaId,
    produto_id: `p-${linhaId}`,
    nome_produto: nome,
    preco_unitario: preco,
    quantidade,
    observacoes: null,
    opcoes: [],
  };
}

export function confirmacaoValidaPara(pedido: OrderContext): AguardandoConfirmacao {
  return {
    hash: calcularHashConfirmacao(pedido),
    expiraEm: new Date(Date.now() + 10 * 60_000).toISOString(),
    resumoTexto: construirResumoTexto(pedido),
  };
}

export function criarMundo(pedido: OrderContext, confirmacao: AguardandoConfirmacao | null = null): MundoFalso {
  return {
    pedido,
    confirmacao,
    ultimoPedidoCriado: null,
    chamadas: [],
    invariantes: [],
    pedidosCriados: [],
    sequencia: 0,
  };
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Mesma ideia da busca real (`tools/catalogo.ts`): casa por palavra, com
 * qualquer separador entre elas, pra "x bacon" achar "X-Bacon". */
function buscarNoCatalogo(termo: string | undefined): ProdutoFalso[] {
  if (!termo?.trim()) return CATALOGO_FALSO;
  const palavras = normalizar(termo).split(" ").filter(Boolean);
  return CATALOGO_FALSO.filter((p) => {
    const nome = normalizar(p.nome);
    return palavras.every((palavra) => nome.includes(palavra));
  });
}

function resultadosDeConhecimento(conteudo: string | undefined) {
  return { resultados: conteudo ? [{ titulo: "Item cadastrado", conteudo }] : [] };
}

export function criarPortas(mundo: MundoFalso, opcoes: OpcoesDoMundo = {}): PortasDoWorkflow {
  const config = opcoes.config ?? FLUXO_PEDIDO_CONFIG_PADRAO;
  const agora = opcoes.agora ?? (() => new Date());
  const conhecimento = opcoes.conhecimento ?? {};

  const executar = async (nome: NomeFerramenta, input: unknown): Promise<ResultadoExecucaoTool> => {
    mundo.chamadas.push({ tool: nome, input });
    const execucaoId = `exec-${++mundo.sequencia}`;

    const erroForcado = opcoes.erros?.[nome];
    if (erroForcado) return { sucesso: true, output: { erro: erroForcado }, execucaoId };

    const dados = (input ?? {}) as Record<string, any>;
    const ok = (output: unknown): ResultadoExecucaoTool => ({ sucesso: true, output, execucaoId });

    switch (nome) {
      // ---------- catálogo ----------
      case "buscar_produtos":
        return ok({
          resultados: buscarNoCatalogo(dados.termo).map((p) => ({ ...p, disponivel: true, categoria: "Lanches" })),
        });
      case "buscar_combos":
        return ok({ resultados: [] });
      case "buscar_adicionais":
      case "buscar_opcoes":
        return ok({
          grupos: [
            {
              nome: "Adicionais",
              tipo: "adicionar",
              obrigatorio: false,
              minimo: 0,
              maximo: 5,
              opcoes: ADICIONAIS_FALSOS.map((o) => ({ ...o, disponivel: true })),
            },
          ],
        });
      case "buscar_recomendacoes":
        return ok({ recomendacoes: [] });

      // ---------- operação ----------
      case "consultar_taxa":
        return ok(resultadosDeConhecimento(conhecimento.entrega));
      case "consultar_regiao":
        return ok(resultadosDeConhecimento(conhecimento.regiao));
      case "consultar_horario":
        return ok(resultadosDeConhecimento(conhecimento.horario));
      case "consultar_politica":
        return ok(resultadosDeConhecimento(conhecimento.politica));
      case "buscar_conhecimento":
        return ok(resultadosDeConhecimento(conhecimento.livre));
      case "consultar_prazo_entrega":
        return ok({ modo: "padrao", texto: null });
      case "consultar_opcoes_atendimento":
        return ok({
          tipos_entrega_oferecidos: config.tipos_entrega_oferecidos,
          formas_pagamento_aceitas: config.perguntar_forma_pagamento ? config.formas_pagamento_aceitas : [],
          pergunta_forma_pagamento: config.perguntar_forma_pagamento,
          pagamento_na_entrega: true,
        });
      case "consultar_cliente":
        return ok({ nome: null, telefone: "0000", endereco_json: null });
      case "consultar_historico":
        return ok({ pedidos: [] });
      case "consultar_pedido":
      case "consultar_status":
        return ok({ erro: "pedido_nao_encontrado" });

      // ---------- carrinho ----------
      case "adicionar_ao_carrinho": {
        const produto = CATALOGO_FALSO.find((p) => p.id === dados.produto_id);
        if (!produto) return ok({ erro: "produto_nao_encontrado" });
        const opcoesItem = (dados.opcoes ?? []) as Array<{ opcao_id: string }>;
        const novoItem: ItemCarrinho = {
          linha_id: `linha-${mundo.pedido.itens.length + 1}`,
          produto_id: produto.id,
          nome_produto: produto.nome,
          preco_unitario: produto.preco,
          quantidade: dados.quantidade ?? 1,
          observacoes: dados.observacoes ?? null,
          opcoes: opcoesItem.map((o) => {
            const opcao = ADICIONAIS_FALSOS.find((a) => a.id === o.opcao_id)!;
            return { opcao_id: opcao.id, nome_opcao: opcao.nome, preco_adicional: opcao.preco_adicional };
          }),
        };
        mundo.pedido = {
          ...mundo.pedido,
          itens: [...mundo.pedido.itens, novoItem],
          carrinho_confirmado: false,
          status: "montando",
          tipo_entrega:
            mundo.pedido.tipo_entrega ??
            (config.tipos_entrega_oferecidos.length === 1 ? config.tipos_entrega_oferecidos[0]! : null),
        };
        return ok(resumoPedidoIa(mundo.pedido, null, config));
      }
      case "remover_do_carrinho":
        mundo.pedido = {
          ...mundo.pedido,
          itens: mundo.pedido.itens.filter((i) => i.linha_id !== dados.linha_id),
          carrinho_confirmado: false,
        };
        return ok(resumoPedidoIa(mundo.pedido, null, config));
      case "atualizar_item_carrinho":
        mundo.pedido = {
          ...mundo.pedido,
          itens: mundo.pedido.itens.map((i) =>
            i.linha_id === dados.linha_id ? { ...i, quantidade: dados.quantidade ?? i.quantidade } : i,
          ),
          carrinho_confirmado: false,
        };
        return ok(resumoPedidoIa(mundo.pedido, null, config));

      // ---------- checkout ----------
      case "definir_tipo_entrega":
        mundo.pedido = {
          ...mundo.pedido,
          tipo_entrega: dados.tipo_entrega,
          endereco: dados.tipo_entrega === "retirada" ? null : mundo.pedido.endereco,
          carrinho_confirmado: false,
        };
        return ok(resumoPedidoIa(mundo.pedido, null, config));
      case "definir_endereco_entrega":
        mundo.pedido = {
          ...mundo.pedido,
          tipo_entrega: "entrega",
          endereco: {
            rua: dados.rua,
            numero: dados.numero,
            complemento: dados.complemento,
            bairro: dados.bairro,
            cidade: dados.cidade,
            referencia: dados.referencia,
          },
          carrinho_confirmado: false,
        };
        return ok(resumoPedidoIa(mundo.pedido, null, config));
      case "definir_forma_pagamento":
        mundo.pedido = { ...mundo.pedido, forma_pagamento: dados.forma_pagamento, carrinho_confirmado: false };
        return ok(resumoPedidoIa(mundo.pedido, null, config));
      case "consultar_carrinho":
        return ok(resumoPedidoIa(mundo.pedido, mundo.confirmacao, config, mundo.ultimoPedidoCriado));

      case "criar_pedido": {
        // Regra REAL, não cópia: mesma função pura que tools/pedido.ts usa.
        const validacao = validarPreRequisitosDeCriacao({
          pedido: mundo.pedido,
          confirmacao: mundo.confirmacao,
          ultimoPedidoCriado: mundo.ultimoPedidoCriado,
          config,
          agora: agora(),
        });
        if (validacao.situacao === "ja_criado") {
          return ok({ pedido_criado: true, pedido_id: validacao.pedido_id, idempotente: true });
        }
        if (validacao.situacao === "recusado") {
          return ok(
            validacao.pendencias ? { erro: validacao.motivo, pendencias: validacao.pendencias } : { erro: validacao.motivo },
          );
        }
        if (opcoes.bloqueioDeRisco) {
          return ok({ erro: "confirmacao_humana_necessaria", ...opcoes.bloqueioDeRisco });
        }

        const pedidoId = `pedido-${mundo.pedidosCriados.length + 1}`;
        mundo.pedidosCriados.push(pedidoId);
        const snapshot = mundo.pedido;
        mundo.ultimoPedidoCriado = {
          pedido_id: pedidoId,
          hash: calcularHashConfirmacao(snapshot),
          criado_em: agora().toISOString(),
        };
        mundo.pedido = pedidoVazio();
        mundo.confirmacao = null;
        return ok({
          pedido_criado: true,
          pedido_id: pedidoId,
          total: snapshot.itens.reduce((acc, i) => acc + i.preco_unitario * i.quantidade, 0),
          itens: snapshot.itens.map((i) => ({ nome_produto: i.nome_produto, quantidade: i.quantidade })),
          tipo_entrega: snapshot.tipo_entrega,
          endereco: snapshot.endereco,
          forma_pagamento: snapshot.forma_pagamento,
        });
      }

      default:
        return ok({});
    }
  };

  return {
    executar,
    carregarPedido: async () => mundo.pedido,
    carregarConfirmacao: async () => mundo.confirmacao,
    carregarUltimoPedidoCriado: async () => mundo.ultimoPedidoCriado,
    salvarPedido: async (_ctx, pedido) => {
      mundo.pedido = pedido;
    },
    salvarConfirmacao: async (_ctx, confirmacao) => {
      mundo.confirmacao = confirmacao ?? null;
    },
    registrarInvariante: async (_ctx, evento, detalhe) => {
      mundo.invariantes.push({ evento, detalhe });
    },
    agora,
  };
}

export function chatFalso(conteudo: string): ChatModel {
  return {
    chatCompletion: async () => ({ content: conteudo, toolCalls: null, usage: null }),
  };
}

/** Pedido completo, pronto pra fechar — o estado do episódio "Luiza" no
 * momento em que ela responde "Tudo certo". */
export function pedidoProntoPraFechar(): OrderContext {
  return {
    ...pedidoVazio(),
    itens: [item("X-Bacon", 32.9)],
    tipo_entrega: "entrega",
    endereco: { rua: "Rua das Flores", numero: "100", bairro: "Centro", cidade: "São Paulo" },
    forma_pagamento: "cartao_credito",
  };
}
