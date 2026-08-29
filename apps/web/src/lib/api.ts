import type {
  AnalyticsComercial,
  AtendimentoComContexto,
  Categoria,
  ClienteComMetricas,
  ComportamentoJson,
  EnderecoEntrega,
  FluxoPedidoConfig,
  FormaPagamento,
  GrupoOpcoesComOpcoes,
  Handoff,
  IaPermissao,
  Ingrediente,
  Mensagem,
  MensagemComMidia,
  NomeFerramenta,
  NumeroWhitelist,
  Pedido,
  PedidoDetalhado,
  PrazoEntregaModo,
  Produto,
  ProdutoDetalhado,
  ResumoPedidoIa,
  StatusAtendimento,
  StatusPagamento,
  StatusPedido,
  TipoEntrega,
  TipoRelacao,
  TomDeVoz,
  WhatsappConexao,
} from "@prospect/shared";
import { supabase } from "./supabase.js";

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Erro ${response.status} em ${path}`);
  }

  return response;
}

export const api = {
  async listarAtendimentos(): Promise<AtendimentoComContexto[]> {
    const res = await authedFetch("/atendimentos");
    return res.json();
  },

  async buscarAtendimento(id: string): Promise<AtendimentoComContexto> {
    const res = await authedFetch(`/atendimentos/${id}`);
    return res.json();
  },

  async assumirAtendimento(id: string): Promise<AtendimentoComContexto> {
    const res = await authedFetch(`/atendimentos/${id}/assumir`, { method: "POST" });
    return res.json();
  },

  async devolverParaIa(id: string): Promise<AtendimentoComContexto> {
    const res = await authedFetch(`/atendimentos/${id}/devolver-ia`, { method: "POST" });
    return res.json();
  },

  async atualizarStatus(id: string, status: StatusAtendimento): Promise<AtendimentoComContexto> {
    const res = await authedFetch(`/atendimentos/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    return res.json();
  },

  async listarMensagens(atendimentoId: string): Promise<MensagemComMidia[]> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/mensagens`);
    return res.json();
  },

  async enviarMensagem(atendimentoId: string, conteudo: string): Promise<Mensagem> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/mensagens`, {
      method: "POST",
      body: JSON.stringify({ conteudo }),
    });
    return res.json();
  },

  async buscarCarrinhoIa(atendimentoId: string): Promise<ResumoPedidoIa> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/carrinho`);
    return res.json();
  },

  async adicionarItemCarrinhoIa(
    atendimentoId: string,
    body: { produto_id: string; quantidade: number; observacoes?: string | null; opcoes?: Array<{ opcao_id: string }> },
  ): Promise<ResumoPedidoIa> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/carrinho/itens`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async atualizarItemCarrinhoIa(
    atendimentoId: string,
    linhaId: string,
    body: { quantidade?: number; observacoes?: string | null },
  ): Promise<ResumoPedidoIa> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/carrinho/itens/${linhaId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async removerItemCarrinhoIa(atendimentoId: string, linhaId: string): Promise<ResumoPedidoIa> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/carrinho/itens/${linhaId}`, { method: "DELETE" });
    return res.json();
  },

  async definirEntregaCarrinhoIa(
    atendimentoId: string,
    body: { tipo_entrega: TipoEntrega | null; endereco: EnderecoEntrega | null },
  ): Promise<ResumoPedidoIa> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/carrinho/entrega`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return res.json();
  },

  async definirPagamentoCarrinhoIa(atendimentoId: string, forma_pagamento: FormaPagamento | null): Promise<ResumoPedidoIa> {
    const res = await authedFetch(`/atendimentos/${atendimentoId}/carrinho/pagamento`, {
      method: "PUT",
      body: JSON.stringify({ forma_pagamento }),
    });
    return res.json();
  },

  async assumirHandoff(id: string): Promise<Handoff> {
    const res = await authedFetch(`/handoffs/${id}/assumir`, { method: "POST" });
    return res.json();
  },

  async listarCategorias(): Promise<Categoria[]> {
    const res = await authedFetch("/categorias");
    return res.json();
  },

  async criarCategoria(nome: string): Promise<Categoria> {
    const res = await authedFetch("/categorias", { method: "POST", body: JSON.stringify({ nome }) });
    return res.json();
  },

  async listarProdutos(): Promise<(Produto & { categoria: Pick<Categoria, "id" | "nome"> | null })[]> {
    const res = await authedFetch("/produtos");
    return res.json();
  },

  async buscarProduto(id: string): Promise<ProdutoDetalhado> {
    const res = await authedFetch(`/produtos/${id}`);
    return res.json();
  },

  async criarProduto(body: ProdutoFormBase): Promise<Produto> {
    const res = await authedFetch("/produtos", { method: "POST", body: JSON.stringify(body) });
    return res.json();
  },

  async atualizarProduto(id: string, body: Partial<ProdutoFormBase & { status: string }>): Promise<Produto> {
    const res = await authedFetch(`/produtos/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    return res.json();
  },

  async arquivarProduto(id: string): Promise<Produto> {
    const res = await authedFetch(`/produtos/${id}/arquivar`, { method: "POST" });
    return res.json();
  },

  async salvarComposicao(
    id: string,
    ingredientes: Array<Pick<Ingrediente, "nome" | "alergeno" | "ordem">>,
    grupos_opcoes: Array<
      Omit<GrupoOpcoesComOpcoes, "id" | "empresa_id" | "produto_id" | "opcoes"> & {
        opcoes: Array<Omit<GrupoOpcoesComOpcoes["opcoes"][number], "id" | "empresa_id" | "grupo_opcoes_id">>;
      }
    >,
  ): Promise<void> {
    await authedFetch(`/produtos/${id}/composicao`, {
      method: "PUT",
      body: JSON.stringify({ ingredientes, grupos_opcoes }),
    });
  },

  async salvarRelacionados(
    id: string,
    relacionados: Array<{ relacionado_id: string; tipo: TipoRelacao }>,
  ): Promise<void> {
    await authedFetch(`/produtos/${id}/relacionados`, {
      method: "PUT",
      body: JSON.stringify({ relacionados }),
    });
  },

  async listarPedidos(filtro: { cliente_id?: string; atendimento_id?: string } = {}): Promise<Pedido[]> {
    const qs = new URLSearchParams(filtro as Record<string, string>).toString();
    const res = await authedFetch(`/pedidos${qs ? `?${qs}` : ""}`);
    return res.json();
  },

  async buscarPedido(id: string): Promise<PedidoDetalhado> {
    const res = await authedFetch(`/pedidos/${id}`);
    return res.json();
  },

  async criarPedido(body: CriarPedidoBody): Promise<Pedido> {
    const res = await authedFetch("/pedidos", { method: "POST", body: JSON.stringify(body) });
    return res.json();
  },

  async atualizarStatusPedido(id: string, status: StatusPedido): Promise<Pedido> {
    const res = await authedFetch(`/pedidos/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
    return res.json();
  },

  async atualizarPagamentoPedido(id: string, status_pagamento: StatusPagamento): Promise<Pedido> {
    const res = await authedFetch(`/pedidos/${id}/pagamento`, {
      method: "POST",
      body: JSON.stringify({ status_pagamento }),
    });
    return res.json();
  },

  async listarClientes(): Promise<ClienteComMetricas[]> {
    const res = await authedFetch("/clientes");
    return res.json();
  },

  async analyticsComercial(): Promise<AnalyticsComercial> {
    const res = await authedFetch("/analytics/comercial");
    return res.json();
  },

  async listarIaPermissoes(): Promise<IaPermissaoOuPadrao[]> {
    const res = await authedFetch("/ia-permissoes");
    return res.json();
  },

  async salvarIaPermissao(body: {
    ferramenta: NomeFerramenta;
    permitido: boolean;
    exige_confirmacao_humana?: boolean | null;
    valor_maximo_sem_handoff?: number | null;
  }): Promise<IaPermissao> {
    const res = await authedFetch("/ia-permissoes", { method: "PUT", body: JSON.stringify(body) });
    return res.json();
  },

  async buscarModoTeste(): Promise<{ modo_teste: boolean; numeros: NumeroWhitelist[] }> {
    const res = await authedFetch("/modo-teste");
    return res.json();
  },

  async atualizarModoTeste(modo_teste: boolean): Promise<{ modo_teste: boolean }> {
    const res = await authedFetch("/modo-teste", { method: "PUT", body: JSON.stringify({ modo_teste }) });
    return res.json();
  },

  async criarNumeroWhitelist(telefone: string): Promise<NumeroWhitelist> {
    const res = await authedFetch("/modo-teste/numeros", { method: "POST", body: JSON.stringify({ telefone }) });
    return res.json();
  },

  async atualizarNumeroWhitelist(id: string, ativo: boolean): Promise<NumeroWhitelist> {
    const res = await authedFetch(`/modo-teste/numeros/${id}`, { method: "PATCH", body: JSON.stringify({ ativo }) });
    return res.json();
  },

  async removerNumeroWhitelist(id: string): Promise<void> {
    await authedFetch(`/modo-teste/numeros/${id}`, { method: "DELETE" });
  },

  async buscarIaConfiguracao(): Promise<IaConfiguracaoResposta> {
    const res = await authedFetch("/ia-configuracoes");
    return res.json();
  },

  async salvarIaConfiguracao(body: IaConfiguracaoResposta): Promise<IaConfiguracaoResposta> {
    const res = await authedFetch("/ia-configuracoes", { method: "PUT", body: JSON.stringify(body) });
    return res.json();
  },

  async buscarStatusWhatsapp(): Promise<Omit<WhatsappConexao, "empresa_id">> {
    const res = await authedFetch("/whatsapp/status");
    return res.json();
  },

  async desconectarWhatsapp(): Promise<void> {
    await authedFetch("/whatsapp/desconectar", { method: "POST" });
  },

  async reconectarWhatsapp(): Promise<void> {
    await authedFetch("/whatsapp/reconectar", { method: "POST" });
  },
};

/** GET /ia-permissoes sempre retorna as ~19 ferramentas, mesmo sem linha
 * ainda criada (id/criado_em/atualizado_em nulos nesse caso). */
export type IaPermissaoOuPadrao = Omit<IaPermissao, "id" | "criado_em" | "atualizado_em"> & {
  id: string | null;
  criado_em: string | null;
  atualizado_em: string | null;
};

export interface IaConfiguracaoResposta {
  tom_de_voz: TomDeVoz;
  usa_emoji: boolean;
  nome_assistente: string | null;
  comportamento_json: ComportamentoJson;
  prazo_entrega_modo: PrazoEntregaModo;
  prazo_entrega_texto: string | null;
  fluxo_pedido: FluxoPedidoConfig;
}

export interface CriarPedidoBody {
  cliente_id: string;
  atendimento_id: string | null;
  tipo_entrega: TipoEntrega;
  endereco_json: EnderecoEntrega | null;
  taxa_entrega: number;
  forma_pagamento: FormaPagamento | null;
  observacoes: string | null;
  itens: Array<{
    produto_id: string;
    quantidade: number;
    observacoes: string | null;
    opcoes: Array<{ opcao_id: string }>;
  }>;
}

export interface ProdutoFormBase {
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
