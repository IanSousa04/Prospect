// Página pública de pedido (tarefa 0043) — canal de venda por link direto,
// sem WhatsApp. Só tipos e funções puras aqui: a validação de telefone e as
// constantes de expiração precisam valer IGUAL no navegador (feedback
// imediato no formulário) e na API (fonte de verdade), e a única forma de
// não terem duas implementações que divergem é morarem em `shared`.

import type { EnderecoEntrega, FormaPagamento, StatusPedido, TipoEntrega } from "./pedidos.js";
import type { Categoria, GrupoOpcoesComOpcoes, Ingrediente, Produto } from "./catalogo.js";
import type { FluxoPedidoConfig } from "./ia-config.js";
import type { ResumoPedidoIa } from "./pedido-ia.js";
import type { PublicoConfig } from "./publico-config.js";

export const TAMANHO_CODIGO_VERIFICACAO = 6;
/** Curto de propósito: o cliente está com o WhatsApp aberto na outra aba do
 * celular, não vai levar 10 minutos. Janela menor = menos código válido
 * circulando por aí. */
export const VALIDADE_CODIGO_MINUTOS = 5;
/** Depois disso o código morre mesmo com o texto certo — impede força bruta
 * de 6 dígitos por tentativa e erro. */
export const MAX_TENTATIVAS_CODIGO = 5;
/** Intervalo mínimo entre dois envios pro mesmo telefone. Cada envio é uma
 * mensagem real de WhatsApp, com custo e risco reputacional (CLAUDE.md
 * regra 7) — reenvio precisa ser uma decisão do cliente, nunca um loop. */
export const INTERVALO_REENVIO_SEGUNDOS = 60;
/** Sessão do cliente final. Longa o bastante pra ele montar o pedido com
 * calma e voltar depois, curta o bastante pra não virar login permanente num
 * celular emprestado. */
export const VALIDADE_SESSAO_HORAS = 12;

/**
 * Normaliza um telefone brasileiro digitado à mão pro mesmo formato que
 * `clientes.telefone` usa (só dígitos, com DDI: "5511999999999") — é essa
 * igualdade que faz o cliente da página pública ser reconhecido como o MESMO
 * cliente que já conversa pelo WhatsApp, em vez de virar um cadastro
 * paralelo.
 *
 * Aceita as formas que uma pessoa realmente digita: "(11) 91234-5678",
 * "11 91234 5678", "+55 11 91234-5678", "5511912345678", e também com 8
 * dígitos locais, sem o nono dígito ("(11) 1234-5678") — existem números
 * reais em uso sem o 9, e o cliente sabe o próprio número melhor do que
 * qualquer heurística. Esta função NUNCA insere, remove ou corrige um
 * dígito: só reformata o que a pessoa digitou pro formato de
 * armazenamento. Um episódio real: uma versão anterior tentava "consertar"
 * um número de 8 dígitos locais inserindo o 9 automaticamente — e produziu
 * um número que não existe no WhatsApp, então o código nunca chegou. Quem
 * decide se o número é entregável é o próprio envio pelo WhatsApp (que já
 * falha honestamente, sem inventar sucesso — CLAUDE.md regra 7), nunca uma
 * suposição feita aqui.
 *
 * Retorna null só quando a entrada claramente não tem a forma de um
 * telefone brasileiro (DDI errado, DDD fora da faixa 11–99, quantidade de
 * dígitos que não bate com DDD + 8 ou DDD + 9).
 */
export function normalizarTelefoneBr(entrada: string): string | null {
  const digitos = entrada.replace(/\D/g, "");
  if (!digitos) return null;

  const semDdi = digitos.startsWith("55") && digitos.length >= 12 ? digitos.slice(2) : digitos;
  if (semDdi.length !== 10 && semDdi.length !== 11) return null;

  const ddd = semDdi.slice(0, 2);
  if (Number(ddd) < 11 || Number(ddd) > 99) return null;

  return `55${semDdi}`;
}

/** Telefone normalizado → "(11) 91234-5678" (ou "(11) 1234-5678", sem o
 * nono dígito), pro cliente conferir na tela que o código vai pro número
 * certo antes de mandar. */
export function formatarTelefoneBr(telefone: string): string {
  const semDdi = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const ddd = semDdi.slice(0, 2);
  const local = semDdi.slice(2);
  if (local.length === 9) return `(${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
  if (local.length === 8) return `(${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
  return telefone;
}

/** "5511912345678" -> "(11) 9****-5678" (ou "(11) 1***-5678" sem o nono
 * dígito). A tela de código precisa mostrar pra qual número o código foi,
 * sem imprimir o telefone inteiro numa tela que pode estar sendo vista por
 * outra pessoa. */
export function mascararTelefoneBr(telefone: string): string {
  const semDdi = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const ddd = semDdi.slice(0, 2);
  const local = semDdi.slice(2);
  if (local.length === 9) return `(${ddd}) ${local.slice(0, 1)}****-${local.slice(5)}`;
  if (local.length === 8) return `(${ddd}) ${local.slice(0, 1)}***-${local.slice(4)}`;
  return telefone;
}

export function codigoVerificacaoValido(codigo: string): boolean {
  return new RegExp(`^\\d{${TAMANHO_CODIGO_VERIFICACAO}}$`).test(codigo.trim());
}

/** Texto da mensagem de verificação. Vive aqui (e não no worker) porque é a
 * ÚNICA mensagem que o sistema manda fora de `mensagens` — deixar o texto
 * junto das regras do fluxo evita que ele vire uma string solta perdida no
 * poller. Sem link e sem nada clicável de propósito: código de acesso em
 * mensagem com link é o formato que golpe usa. */
export function textoMensagemVerificacao(nomeEmpresa: string, codigo: string): string {
  return (
    `Seu código para fazer o pedido em *${nomeEmpresa}* é *${codigo}*.\n\n` +
    `Ele vale por ${VALIDADE_CODIGO_MINUTOS} minutos. ` +
    `Se não foi você que pediu, é só ignorar esta mensagem.`
  );
}

/** Dados da loja que a página pública precisa antes de qualquer login —
 * subconjunto deliberado de `Empresa` (nada de status de assinatura,
 * telefone interno ou id de outros tenants). */
export interface LojaPublica {
  slug: string;
  nome: string;
  segmento: string | null;
  fluxo_pedido: FluxoPedidoConfig;
  /** Texto de prazo cadastrado pela empresa, quando houver — nunca calculado
   * aqui (CLAUDE.md regra 1). */
  prazo_entrega_texto: string | null;
  /** Aparência configurada na aba "Página pública" — cor de destaque, fonte e
   * organização dos produtos. Sempre presente (defaults se nunca configurou),
   * pra página aplicar as variáveis sem tratar estado ausente. */
  aparencia: PublicoConfig;
}

/** Produto como o cliente final vê. Sem `empresa_id`, sem `status`, sem
 * campos internos de curadoria — o que sai numa rota sem autenticação é
 * sempre uma lista explícita de campos, nunca `select *`. */
export type ProdutoPublico = Pick<
  Produto,
  | "id"
  | "categoria_id"
  | "tipo"
  | "nome"
  | "descricao"
  | "descricao_comercial"
  | "imagem_url"
  | "tags"
  | "preco"
  | "preco_promocional"
  | "quantidade_minima"
  | "quantidade_maxima"
  | "restricoes"
> & {
  /** COMPUTADO na API: o flag `disponivel` do catálogo combinado com a janela
   * `horario_inicio`/`horario_fim` do produto — a mesma regra que
   * `montarItensComSnapshot` aplica ao aceitar o item. A vitrine nunca pode
   * dizer "disponível" pra algo que o backend vai recusar, e os horários
   * crus não saem numa rota pública. */
  disponivel: boolean;
};

export interface CatalogoPublico {
  categorias: Pick<Categoria, "id" | "nome" | "ordem">[];
  produtos: ProdutoPublico[];
}

export interface ProdutoPublicoDetalhado extends ProdutoPublico {
  ingredientes: Pick<Ingrediente, "id" | "nome" | "alergeno" | "ordem">[];
  grupos_opcoes: GrupoOpcoesComOpcoes[];
}

/** Resposta de `POST /publico/:slug/verificacao` — nunca inclui o código.
 * O cliente volta com `verificacao_id`, não com o telefone: dado pessoal não
 * anda em URL nem circula mais do que precisa, e amarrar as tentativas a um
 * registro específico impede que um código novo "conserte" as tentativas
 * gastas de um antigo. `reenviar_em_segundos` existe pra UI mostrar o
 * contador do botão de reenvio com o mesmo valor que a API vai cobrar. */
export interface VerificacaoSolicitada {
  verificacao_id: string;
  telefone_mascarado: string;
  expira_em: string;
  reenviar_em_segundos: number;
}

/** `GET /publico/verificacao/:id/status` — a página só diz "enviado" depois
 * que o whatsapp-worker confirmou o envio com a API do WhatsApp (CLAUDE.md
 * regra 7: nunca simular sucesso de envio). Enquanto `enviado` for false e
 * não houver erro, o estado honesto é "enviando". */
export interface StatusVerificacao {
  enviado: boolean;
  erro_envio: string | null;
  expira_em: string;
  tentativas_restantes: number;
}

/** Resposta de `POST /publico/:slug/verificacao/confirmar` — a sessão do
 * cliente final. `atendimento_id` é a conversa a que este pedido vai ficar
 * associado: a conversa ATIVA que ele já tem (com IA ou humano), se existir,
 * ou uma nova criada na hora. */
export interface SessaoPublicaCriada {
  token: string;
  expira_em: string;
  cliente: ClientePublico;
  /** A conversa ativa que o cliente já tem (com IA ou humano), quando
   * existe. `null` significa "ainda não há conversa": uma é criada no
   * primeiro item que ele põe no carrinho, não no login — senão todo mundo
   * que só abre o cardápio viraria um card vazio no Kanban. */
  atendimento_id: string | null;
}

/** Só o que a página pública precisa saber do cliente — nunca `empresa_id`,
 * tags internas ou preferências usadas pela IA. */
export interface ClientePublico {
  id: string;
  nome: string | null;
  telefone: string;
  endereco_json: EnderecoEntrega | null;
}

/** Estado completo que a página pública carrega ao (re)abrir com uma sessão
 * válida — cliente, carrinho e o pedido já criado, se houver. Uma chamada só:
 * a página é usada em rede de celular, e três round-trips pra montar a tela
 * inicial se notam. */
export interface EstadoSessaoPublica {
  cliente: ClientePublico;
  atendimento_id: string | null;
  carrinho: ResumoPedidoIa;
  /** Pedido ativo desta conversa, quando já existe — é o que impede a página
   * de oferecer "confirmar pedido" pra quem acabou de confirmar um. */
  pedido_ativo: PedidoPublicoResumo | null;
}

/** O que o cliente pode saber do próprio pedido depois de confirmar. Nunca
 * expõe `empresa_id`, `cliente_id` nem o `id` interno usado pelo painel. */
export interface PedidoPublicoResumo {
  numero: number;
  status: StatusPedido;
  tipo_entrega: TipoEntrega;
  forma_pagamento: FormaPagamento | null;
  subtotal: number;
  taxa_entrega: number;
  total: number;
  criado_em: string;
}
