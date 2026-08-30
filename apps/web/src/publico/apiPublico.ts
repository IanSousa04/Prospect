// Cliente HTTP da página pública de pedido (tarefa 0043). Separado de
// `lib/api.ts` de propósito: aquele fala com o painel e manda o JWT do
// Supabase Auth; este fala com `/publico` e manda o token de sessão do
// CLIENTE FINAL. Misturar os dois seria a forma mais fácil de um dia mandar
// credencial de painel pra uma rota pública, ou o contrário.
import type {
  CatalogoPublico,
  EnderecoEntrega,
  EstadoSessaoPublica,
  FormaPagamento,
  LojaPublica,
  PedidoPublicoResumo,
  ProdutoPublicoDetalhado,
  ResumoPedidoIa,
  SessaoPublicaCriada,
  StatusVerificacao,
  TipoEntrega,
  VerificacaoSolicitada,
} from "@prospect/shared";

const API_URL = import.meta.env.VITE_API_URL;

/** Token por LOJA: o mesmo navegador pode pedir em duas lojas diferentes, e
 * um token só vale na empresa que o emitiu. */
function chaveToken(slug: string): string {
  return `pedido-publico:token:${slug}`;
}

export function lerToken(slug: string): string | null {
  try {
    return localStorage.getItem(chaveToken(slug));
  } catch {
    // Navegador com storage bloqueado (aba anônima restrita, iOS com cookies
    // de terceiros desligados) — a página continua funcionando, só não
    // lembra o login entre recarregamentos.
    return null;
  }
}

export function salvarToken(slug: string, token: string): void {
  try {
    localStorage.setItem(chaveToken(slug), token);
  } catch {
    /* mesmo caso acima — sessão só na memória desta aba */
  }
}

export function apagarToken(slug: string): void {
  try {
    localStorage.removeItem(chaveToken(slug));
  } catch {
    /* nada a fazer */
  }
}

/** Telefone digitado na última vez — mesmo escopo por loja do token. É só
 * conveniência de preenchimento: o cliente não digita o número de novo em
 * cada visita. Nunca usado como identidade (a sessão é que vale). */
function chaveTelefone(slug: string): string {
  return `pedido-publico:telefone:${slug}`;
}

export function lerTelefone(slug: string): string | null {
  try {
    return localStorage.getItem(chaveTelefone(slug));
  } catch {
    return null;
  }
}

export function salvarTelefone(slug: string, telefone: string): void {
  try {
    localStorage.setItem(chaveTelefone(slug), telefone);
  } catch {
    /* storage bloqueado — segue sem lembrar */
  }
}

/** Erro com o CÓDIGO da API preservado — a UI decide a frase (e algumas
 * decisões dependem do código, não do texto: `carrinho_mudou` reabre a
 * revisão, `sessao_expirada` volta pra tela de telefone). */
export class ErroApiPublica extends Error {
  readonly codigo: string;
  readonly status: number;
  readonly corpo: Record<string, unknown>;

  constructor(codigo: string, status: number, corpo: Record<string, unknown>) {
    super(codigo);
    this.name = "ErroApiPublica";
    this.codigo = codigo;
    this.status = status;
    this.corpo = corpo;
  }
}

async function requisicao<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...resto } = init;

  const response = await fetch(`${API_URL}${path}`, {
    ...resto,
    headers: {
      ...(resto.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...resto.headers,
    },
  });

  if (!response.ok) {
    const corpo = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    throw new ErroApiPublica(
      String(corpo.error ?? `erro_${response.status}`),
      response.status,
      corpo,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const apiPublica = {
  loja: (slug: string) => requisicao<LojaPublica>(`/publico/${slug}`),

  catalogo: (slug: string) =>
    requisicao<CatalogoPublico>(`/publico/${slug}/catalogo`),

  produto: (slug: string, produtoId: string) =>
    requisicao<ProdutoPublicoDetalhado>(
      `/publico/${slug}/produtos/${produtoId}`,
    ),

  solicitarCodigo: (slug: string, telefone: string) =>
    requisicao<VerificacaoSolicitada>(`/publico/${slug}/verificacao`, {
      method: "POST",
      body: JSON.stringify({ telefone }),
    }),

  statusVerificacao: (slug: string, verificacaoId: string) =>
    requisicao<StatusVerificacao>(
      `/publico/${slug}/verificacao/${verificacaoId}/status`,
    ),

  confirmarCodigo: (slug: string, verificacaoId: string, codigo: string) =>
    requisicao<SessaoPublicaCriada>(`/publico/${slug}/verificacao/confirmar`, {
      method: "POST",
      body: JSON.stringify({ verificacao_id: verificacaoId, codigo }),
    }),

  sessao: (token: string) =>
    requisicao<EstadoSessaoPublica>("/publico/sessao", { token }),

  salvarNome: (token: string, nome: string) =>
    requisicao<EstadoSessaoPublica["cliente"]>("/publico/cliente/nome", {
      method: "PUT",
      token,
      body: JSON.stringify({ nome }),
    }),

  adicionarItem: (
    token: string,
    body: {
      produto_id: string;
      quantidade: number;
      observacoes?: string | null;
      opcoes?: Array<{ opcao_id: string }>;
    },
  ) =>
    requisicao<ResumoPedidoIa>("/publico/carrinho/itens", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),

  atualizarItem: (
    token: string,
    linhaId: string,
    body: { quantidade?: number; observacoes?: string | null },
  ) =>
    requisicao<ResumoPedidoIa>(`/publico/carrinho/itens/${linhaId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    }),

  removerItem: (token: string, linhaId: string) =>
    requisicao<ResumoPedidoIa>(`/publico/carrinho/itens/${linhaId}`, {
      method: "DELETE",
      token,
    }),

  definirEntrega: (
    token: string,
    body: {
      tipo_entrega: TipoEntrega | null;
      endereco: EnderecoEntrega | null;
    },
  ) =>
    requisicao<ResumoPedidoIa>("/publico/carrinho/entrega", {
      method: "PUT",
      token,
      body: JSON.stringify(body),
    }),

  definirPagamento: (token: string, forma_pagamento: FormaPagamento | null) =>
    requisicao<ResumoPedidoIa>("/publico/carrinho/pagamento", {
      method: "PUT",
      token,
      body: JSON.stringify({ forma_pagamento }),
    }),

  revisarPedido: (token: string) =>
    requisicao<{
      hash: string;
      expira_em: string;
      subtotal: number;
      carrinho: ResumoPedidoIa;
    }>("/publico/pedido/revisao", { method: "POST", token }),

  confirmarPedido: (token: string, hash: string) =>
    requisicao<{ pedido: PedidoPublicoResumo; idempotente?: boolean }>(
      "/publico/pedido",
      {
        method: "POST",
        token,
        body: JSON.stringify({ hash }),
      },
    ),

  pedidoAtual: (token: string) =>
    requisicao<PedidoPublicoResumo>("/publico/pedido", { token }),

  encerrarSessao: (token: string) =>
    requisicao<void>("/publico/sessao/encerrar", { method: "POST", token }),
};

/** Código da API → frase pro CLIENTE FINAL. Deliberadamente diferente do mapa
 * do painel (pages/kanban/acoes.ts): quem lê aqui não sabe o que é handoff,
 * atendimento ou linha de carrinho, e nunca pode ver um identificador
 * técnico. Erros com sufixo (`produto_indisponivel:<uuid>`) são normalizados
 * antes da busca. */
const MENSAGENS: Record<string, string> = {
  loja_nao_encontrada: "Esta loja não está disponível no momento.",
  telefone_invalido: "Confira o número — precisa ser um celular com DDD.",
  aguarde_para_reenviar:
    "Espere alguns segundos antes de pedir um novo código.",
  muitas_tentativas:
    "Muitas tentativas seguidas. Aguarde um pouco e tente de novo.",
  codigo_invalido: "Código inválido. Peça um novo código.",
  codigo_incorreto: "Código incorreto. Confira a mensagem no WhatsApp.",
  codigo_expirado: "Esse código expirou. Peça um novo.",
  codigo_bloqueado: "Muitas tentativas com esse código. Peça um novo.",
  sessao_ausente: "Sua sessão terminou. Informe seu telefone de novo.",
  sessao_invalida: "Sua sessão terminou. Informe seu telefone de novo.",
  sessao_expirada: "Sua sessão terminou. Informe seu telefone de novo.",
  produto_indisponivel: "Esse item acabou de ficar indisponível.",
  produto_fora_do_horario: "Esse item não está sendo servido neste horário.",
  quantidade_abaixo_do_minimo: "A quantidade está abaixo do mínimo desse item.",
  quantidade_acima_do_maximo:
    "A quantidade passa do máximo permitido para esse item.",
  opcao_invalida: "Uma das opções escolhidas não está mais disponível.",
  grupo_obrigatorio_nao_preenchido: "Falta escolher uma opção obrigatória.",
  grupo_abaixo_do_minimo: "Escolha mais opções nesse grupo.",
  grupo_acima_do_maximo: "Você escolheu opções demais nesse grupo.",
  linha_nao_encontrada: "Esse item já não está no seu carrinho.",
  carrinho_vazio: "Seu carrinho está vazio.",
  carrinho_mudou:
    "Seu carrinho mudou. Confira o resumo atualizado antes de confirmar.",
  pedido_ja_em_andamento: "Você já tem um pedido em andamento.",
  pedido_incompleto: "Ainda falta alguma informação para fechar o pedido.",
  confirmacao_expirada_ou_invalida:
    "O resumo expirou. Confira de novo antes de confirmar.",
  confirmacao_nao_registrada:
    "Não conseguimos registrar sua confirmação. Tente de novo.",
  tipo_entrega_nao_oferecido: "Esta loja não oferece essa forma de entrega.",
  forma_pagamento_nao_aceita: "Esta loja não aceita essa forma de pagamento.",
  nome_invalido: "Informe um nome válido.",
};

export function mensagemDeErro(e: unknown): string {
  const codigo = e instanceof ErroApiPublica ? e.codigo.split(":")[0]! : "";
  return MENSAGENS[codigo] ?? "Algo deu errado. Tente novamente em instantes.";
}
