// Tipos espelham 1:1 o schema de supabase/migrations/0005_fase1_atendimento.sql.
// Qualquer mudança de schema deve atualizar este arquivo na mesma alteração.

import type { EnderecoEntrega } from "./pedidos.js";

export type Segmento =
  | "hamburgueria"
  | "pizzaria"
  | "acaiteria"
  | "restaurante"
  | "sushi"
  | "marmitaria"
  | "lanchonete"
  | "delivery"
  | "outro";

export type StatusEmpresa = "trial" | "ativo" | "suspenso" | "cancelado";

export interface Empresa {
  id: string;
  nome: string;
  slug: string;
  segmento: Segmento | null;
  telefone_whatsapp: string | null;
  status: StatusEmpresa;
  criado_em: string;
  atualizado_em: string;
}

export type PapelUsuario = "owner" | "admin" | "atendente";

export interface Usuario {
  id: string;
  empresa_id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  status: "ativo" | "inativo";
  criado_em: string;
  atualizado_em: string;
}

export interface Cliente {
  id: string;
  empresa_id: string;
  nome: string | null;
  telefone: string;
  whatsapp_id: string | null;
  primeiro_contato_em: string;
  ultima_interacao_em: string;
  tags: string[];
  preferencias_json: Record<string, unknown>;
  /** Último endereço de entrega usado (tarefa 0020) — um único campo, não
   * múltiplos endereços salvos: nenhuma necessidade real de mais de um
   * ainda apareceu. Usado pra "entregar no mesmo endereço de sempre?" na
   * próxima conversa, em vez de pedir tudo de novo. */
  endereco_json: EnderecoEntrega | null;
  criado_em: string;
  atualizado_em: string;
}

export type CategoriaConhecimento =
  | "faq"
  | "politica"
  | "procedimento"
  | "entrega"
  | "pagamento"
  | "cancelamento"
  | "promocao"
  | "horario"
  | "regiao"
  | "outro";

export interface ConhecimentoItem {
  id: string;
  empresa_id: string;
  categoria: CategoriaConhecimento;
  titulo: string;
  conteudo: string;
  status: "ativo" | "rascunho" | "arquivado";
  criado_em: string;
  atualizado_em: string;
}

export interface IaConfiguracao {
  empresa_id: string;
  tom_de_voz: "formal" | "neutro" | "amigavel" | "descontraido";
  usa_emoji: boolean;
  /** Shape validado por ComportamentoJsonSchema (ver ia-config.ts) — pode
   * estar vazio/desatualizado em linhas antigas, sempre parsear com o schema
   * (nunca confiar no shape do banco sem validar) antes de usar. */
  comportamento_json: import("./ia-config.js").ComportamentoJson;
  /** Ver docs/ROADMAP.md §3 "Modo teste com whitelist de números" — enquanto
   * true, o whatsapp-worker só ingere mensagens de telefones presentes em
   * `numeros_whitelist` (ativo=true) para esta empresa. */
  modo_teste: boolean;
  /** Nome/persona da IA pra se apresentar quando perguntada quem é — ver
   * docs/ROADMAP.md §1 "Identidade da IA". null = usa o texto genérico
   * padrão (nunca inventa um nome, ver agent/deteccao.ts). */
  nome_assistente: string | null;
  atualizado_em: string;
}

/** Ver supabase/migrations/0011_modo_teste_whitelist.sql. Telefone no mesmo
 * formato usado em `clientes.telefone` (JID sem sufixo, ex. "5511999999999"). */
export interface NumeroWhitelist {
  id: string;
  empresa_id: string;
  telefone: string;
  ativo: boolean;
  criado_em: string;
}

/** Permissões da IA vivem na tabela `ia_permissoes` (uma linha por
 * empresa+ferramenta), não mais em ia_configuracoes — ver ia-permissoes.ts.
 * Ausência de linha para uma ferramenta = negado, sempre. */
export interface IaPermissao {
  id: string;
  empresa_id: string;
  ferramenta: import("./ia-config.js").NomeFerramenta;
  permitido: boolean;
  exige_confirmacao_humana: boolean | null;
  valor_maximo_sem_handoff: number | null;
  condicoes_json: { status_permitidos?: string[] } | null;
  campos_permitidos: string[] | null;
  criado_em: string;
  atualizado_em: string;
}

/** Estados conceituais do Kanban — ver docs/product/03-atendimento-e-crm.md §3.2. */
export type StatusAtendimento =
  | "ia_atendendo"
  | "solicitou_humano"
  | "humano_atendendo"
  | "resolvido";

export type Prioridade = "baixa" | "normal" | "alta";

export interface Atendimento {
  id: string;
  empresa_id: string;
  cliente_id: string;
  status: StatusAtendimento;
  responsavel_usuario_id: string | null;
  intencao: string | null;
  prioridade: Prioridade;
  ultima_mensagem_em: string;
  criado_em: string;
  atualizado_em: string;
}

export type RemetenteMensagem = "cliente" | "ia" | "humano";

export interface Mensagem {
  id: string;
  empresa_id: string;
  atendimento_id: string;
  remetente: RemetenteMensagem;
  conteudo: string;
  metadata_json: Record<string, unknown>;
  criado_em: string;
}

/** Ver docs/ROADMAP.md §1 "Cliente manda imagem/áudio" — nunca gravado no
 * banco (é `metadata_json.midia`), só o formato esperado por quem grava. */
export interface MidiaMensagem {
  tipo: "imagem" | "audio" | "video" | "documento";
  mimetype: string;
  storage_path: string;
  tamanho_bytes: number;
}

/** `metadata_json.midia_falha` — download da mídia falhou (ver
 * apps/whatsapp-worker/src/lib/media.ts, depende de API interna do
 * WhatsApp Web que pode quebrar sem aviso). Só o tipo, sem storage_path —
 * a UI usa isso pra mostrar um indicativo visual de "chegou mídia" mesmo
 * sem conseguir exibir o conteúdo. */
export interface MidiaFalhaMensagem {
  tipo: "imagem" | "audio" | "video" | "documento";
}

/** Resposta de `GET /atendimentos/:id/mensagens` — `midia_url` é computado
 * na hora (signed URL de curta duração pro objeto no Storage), nunca
 * persistido; `null`/ausente quando a mensagem não tem mídia. */
export interface MensagemComMidia extends Mensagem {
  midia_url?: string | null;
}

export type OrigemHandoff =
  | "cliente_solicitou"
  | "ia_solicitou"
  | "regra_operacional"
  | "falha_conhecimento"
  | "acao_sem_permissao"
  | "alto_risco";

export type StatusHandoff = "aberto" | "assumido" | "resolvido";

export interface Handoff {
  id: string;
  empresa_id: string;
  atendimento_id: string;
  origem: OrigemHandoff;
  motivo: string;
  resumo: string;
  acao_sugerida: string | null;
  prioridade: Prioridade;
  status: StatusHandoff;
  assumido_por_usuario_id: string | null;
  criado_em: string;
  resolvido_em: string | null;
}

/** Estágio derivado do board operacional unificado (tarefa 0066) — combina
 * `atendimentos.status` + `pedidos.status` sem ser uma terceira fonte de
 * verdade gravada em disco; calculado a cada leitura em `paraContexto`
 * (apps/api/src/routes/atendimentos.ts). Inclui `resolvido` só como valor
 * de trânsito pra filtragem (um atendimento resolvido sem pedido some do
 * board sozinho) — nunca é uma coluna do Kanban (`KANBAN_COLUNAS` não o
 * lista, ver apps/web/src/components/statusMeta.tsx). */
export type EstagioOperacional =
  | "ia_atendendo"
  | "solicitou_humano"
  | "humano_atendendo"
  | "resolvido"
  | "aberto"
  | "em_preparacao"
  | "pronto"
  | "entregue"
  | "cancelado";

/** Atendimento com os dados relacionados que a tela de Kanban e a tela de
 * conversa precisam, já compostos numa única consulta (ver apps/api). */
export interface AtendimentoComContexto extends Atendimento {
  cliente: Cliente;
  handoff_aberto: Handoff | null;
  /** Pedido mais recente não cancelado deste atendimento — alimenta o valor
   * mostrado no card do Kanban (ver docs/product/03-atendimento-e-crm.md §3.2). */
  pedido_aberto: import("./pedidos.js").Pedido | null;
  estagio_operacional: EstagioOperacional;
  /** Pedido que efetivamente determinou `estagio_operacional` (tarefa 0066)
   * — igual a `pedido_aberto` na maioria dos casos, mas é o pedido
   * cancelado mais recente quando o estágio é `cancelado` (`pedido_aberto`
   * nunca aponta pra um pedido cancelado). Usado pelo card do Kanban pra
   * saber qual pedido arquivar na coluna "Cancelado". */
  pedido_estagio: import("./pedidos.js").Pedido | null;
}
